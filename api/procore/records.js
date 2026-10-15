// POST /api/procore/records : create the confirmed record in Procore (Step 3 of
// SPEC_voice-photo-to-procore-record), with the signed-in person's own Procore sign-in (decision A).
// Body (same-origin JSON): { companyId, projectId, card, files: [{ name, type, data (base64) }], link }
//  1. checks they're on the project; 2. uploads each photo and the voice file (upload_ids);
//  3. creates the Observation or Punch Item (api/_records.js builds it: not private, HTML description,
//     "Reported by … via SiteSnap AI", transcript); if Procore refuses the assignees it creates it
//     without them and says so; 4. emails the assignees only (decision C).
// Answers { recordType, id, number, url, warnings[] }. Never logs or returns a token.
// Demo projects (DEMO_MODE=true and the project in DEMO_PROJECT_IDS): the title starts with [SS-DEMO], so the
// Demo staging page's reset finds live test captures too.
import { config, HttpError, procoreGet, procoreId, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend, uploadFile } from "../_procoreWrite.js";
import { assigneeEmail, cleanCard, observationBody, punchBody, recordUrl } from "../_records.js";
import { demoCodeOf, demoMode, withTag } from "../_demoScenarios.js";

const MAX_FILES = 6;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

const procoreError = (r) => {
  const e = r.json?.errors ?? r.json?.message ?? r.json?.error;
  if (!e) return `Procore answered ${r.status}.`;
  return typeof e === "string" ? e : Object.entries(e).map(([k, v]) => `${k} ${[].concat(v).join(", ")}`).join("; ");
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const cfg = config();
    const body = await readBody(req);
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    let card;
    try { card = cleanCard(body.card); } catch (err) { throw new HttpError(400, "bad_card", err.message); }
    if (demoMode() && demoCodeOf(projectId)) card = { ...card, title: withTag(card.title) };
    const files = (Array.isArray(body.files) ? body.files : []).slice(0, MAX_FILES).map((f) => ({
      name: String(f?.name ?? "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80),
      type: String(f?.type ?? ""),
      bytes: Buffer.from(String(f?.data ?? ""), "base64"),
    }));
    for (const f of files) {
      if (!/^(image|audio)\//.test(f.type) || !f.bytes.length || f.bytes.length > MAX_FILE_BYTES) throw new HttpError(400, "bad_file", "Only photos and voice notes up to 3 MB each.");
    }
    const link = typeof body.link === "string" && body.link.startsWith("https://") ? body.link.slice(0, 300) : null;

    // Only a project this person can open in Procore
    const { projects } = await listProjects(req, res, cfg);
    if (!projects.some((p) => p.companyId === companyId && p.projectId === projectId)) throw new HttpError(403, "no_access", "You're not on that project in Procore.");
    const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
    const reporterName = me?.name || me?.login?.split("@")[0] || null;

    const warnings = [];
    const uploadIds = [];
    for (const f of files) {
      const u = await uploadFile(req, res, cfg, { companyId, projectId, name: f.name, type: f.type, bytes: f.bytes });
      if (u.ok) uploadIds.push(u.uuid);
      else warnings.push(`${f.type.startsWith("audio") ? "The voice note" : "A photo"} didn't attach (Procore answered ${u.status}).`);
    }

    const isObs = card.recordType === "observation";
    const path = isObs ? "/rest/v1.0/observations/items" : "/rest/v1.1/punch_items";
    const build = (c) => (isObs ? observationBody : punchBody)(c, projectId, { reporterName, uploadIds, link });
    let made = await procoreSend(req, res, cfg, "POST", path, { companyId, body: build(card) });
    // A typed place Procore won't let this person add as a new location: send it without the location,
    // with the place written in the description, and say so
    if (!made.ok && card.locationText && !card.locationId && [403, 422].includes(made.status) && /location/i.test(procoreError(made) ?? "")) {
      const where = card.locationText;
      const retry = await procoreSend(req, res, cfg, "POST", path, { companyId, body: build({ ...card, locationText: null, whereText: where }) });
      if (retry.ok || !/location/i.test(procoreError(retry) ?? "")) {
        made = retry;
        card = { ...card, locationText: null, whereText: where };
        if (retry.ok) warnings.push(`Procore doesn't let you add new locations, so "${where}" is written in the description. Next time pick one of the project's locations, or ask a Procore admin to add it.`);
      }
    }
    // Someone Procore won't let this person assign: create it anyway, unassigned, and say so
    if (!made.ok && card.assigneeIds.length && [403, 422].includes(made.status)) {
      const first = procoreError(made);
      const retry = await procoreSend(req, res, cfg, "POST", path, { companyId, body: build({ ...card, assigneeIds: [] }) });
      if (retry.ok) {
        made = retry;
        warnings.push(`Created without an assignee: Procore said "${first}". Assign it in Procore.`);
        card = { ...card, assigneeIds: [] };
      }
    }
    if (!made.ok) {
      const status = made.status === 403 ? 403 : made.status === 401 ? 401 : 422;
      throw new HttpError(status, "procore_refused", `Procore didn't create it: ${procoreError(made)}`);
    }
    const id = made.json?.id;
    const number = isObs ? made.json?.number ?? null : made.json?.position ?? null;

    // Decision C: Procore emails the assignees only
    if (card.assigneeIds.length) {
      const mail = await procoreSend(req, res, cfg, "POST", `${path}/${id}/send_email`, { companyId, query: { project_id: projectId }, body: assigneeEmail(card, reporterName, number) });
      if (!mail.ok) warnings.push(`Created, but Procore didn't send the email (${procoreError(mail)}).`);
    }

    console.log("SiteSnap record created", JSON.stringify({ recordType: card.recordType, id, files: uploadIds.length, warnings: warnings.length }));
    sendJson(res, 201, { recordType: card.recordType, id, number, url: recordUrl(cfg.apiUrl, projectId, card.recordType, id), warnings, reporterName });
  } catch (err) {
    sendError(res, err);
  }
}
