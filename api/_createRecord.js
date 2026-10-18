// Creating an Observation or Punch Item in Procore: the one code path shared by Report an issue
// (api/procore/records.js) and a failed inspection item (api/procore/inspections.js, action "fail").
//  1. checks they're on the project; 2. uploads each photo and the voice file (upload_ids);
//  3. creates the record (api/_records.js builds it); if Procore refuses a typed location or the assignees it
//     tries again without them and says so; 4. emails the assignees only (decision C).
// extra(body) may add fields to Procore's request (an inspection's failed-item link). Never logs a token.
import { HttpError, procoreGet } from "./_procore.js";
import { listProjects } from "./_projects.js";
import { procoreSend, uploadFile } from "./_procoreWrite.js";
import { assigneeEmail, observationBody, punchBody, recordUrl } from "./_records.js";

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

export const procoreError = (r) => {
  const e = r.json?.errors ?? r.json?.message ?? r.json?.error;
  if (!e) return `Procore answered ${r.status}.`;
  return typeof e === "string" ? e : Object.entries(e).map(([k, v]) => `${k} ${[].concat(v).join(", ")}`).join("; ");
};

/** [{ name, type, data (base64) }] from the phone -> [{ name, type, bytes }]; photos and voice only, 3 MB each */
export function cleanFiles(list) {
  const files = (Array.isArray(list) ? list : []).slice(0, MAX_FILES).map((f) => ({
    name: String(f?.name ?? "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80),
    type: String(f?.type ?? ""),
    bytes: Buffer.from(String(f?.data ?? ""), "base64"),
  }));
  for (const f of files) {
    if (!/^(image|audio)\//.test(f.type) || !f.bytes.length || f.bytes.length > MAX_FILE_BYTES) throw new HttpError(400, "bad_file", "Only photos and voice notes up to 3 MB each.");
  }
  return files;
}

/** Create the record. Answers { recordType, id, number, url, warnings, reporterName, reporterId, card } (card as finally sent).
 *  retry429: wait out a 429 on each Procore call (the full-loop demo). */
export async function createRecord(req, res, cfg, { companyId, projectId, card, files = [], link = null, extra = null, checkedProject = false, retry429 = false }) {
  if (!checkedProject) {
    const { projects } = await listProjects(req, res, cfg);
    if (!projects.some((p) => p.companyId === companyId && p.projectId === projectId)) throw new HttpError(403, "no_access", "You're not on that project in Procore.");
  }
  const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
  const reporterName = me?.name || me?.login?.split("@")[0] || null;

  const warnings = [];
  const uploadIds = [];
  for (const f of files) {
    const u = await uploadFile(req, res, cfg, { companyId, projectId, name: f.name, type: f.type, bytes: f.bytes, retry429 });
    if (u.ok) uploadIds.push(u.uuid);
    else warnings.push(`${f.type.startsWith("audio") ? "The voice note" : "A photo"} didn't attach (Procore answered ${u.status}).`);
  }

  const isObs = card.recordType === "observation";
  const path = isObs ? "/rest/v1.0/observations/items" : "/rest/v1.1/punch_items";
  const build = (c) => {
    const body = (isObs ? observationBody : punchBody)(c, projectId, { reporterName, uploadIds, link });
    return extra ? extra(body) : body;
  };
  let made = await procoreSend(req, res, cfg, "POST", path, { companyId, body: build(card), retry429 });
  // A typed place Procore won't let this person add as a new location: send it without the location,
  // with the place written in the description, and say so
  if (!made.ok && card.locationText && !card.locationId && [403, 422].includes(made.status) && /location/i.test(procoreError(made) ?? "")) {
    const where = card.locationText;
    const retry = await procoreSend(req, res, cfg, "POST", path, { companyId, body: build({ ...card, locationText: null, whereText: where }), retry429 });
    if (retry.ok || !/location/i.test(procoreError(retry) ?? "")) {
      made = retry;
      card = { ...card, locationText: null, whereText: where };
      if (retry.ok) warnings.push(`Procore doesn't let you add new locations, so "${where}" is written in the description. Next time pick one of the project's locations, or ask a Procore admin to add it.`);
    }
  }
  // Someone Procore won't let this person assign: create it anyway, unassigned, and say so
  if (!made.ok && card.assigneeIds.length && [403, 422].includes(made.status)) {
    const first = procoreError(made);
    const retry = await procoreSend(req, res, cfg, "POST", path, { companyId, body: build({ ...card, assigneeIds: [] }), retry429 });
    if (retry.ok) {
      made = retry;
      warnings.push(`Created without an assignee: Procore said "${first}". Assign it in Procore.`);
      card = { ...card, assigneeIds: [] };
    }
  }
  if (!made.ok) {
    const status = made.status === 403 ? 403 : made.status === 401 ? 401 : made.status === 429 ? 429 : 422;
    throw Object.assign(new HttpError(status, "procore_refused", `Procore didn't create it: ${procoreError(made)}`), { procore: made });
  }
  const id = made.json?.id;
  const number = isObs ? made.json?.number ?? null : made.json?.position ?? null;

  // Decision C: Procore emails the assignees only
  if (card.assigneeIds.length) {
    const mail = await procoreSend(req, res, cfg, "POST", `${path}/${id}/send_email`, { companyId, query: { project_id: projectId }, body: assigneeEmail(card, reporterName, number), retry429 });
    if (!mail.ok) warnings.push(`Created, but Procore didn't send the email (${procoreError(mail)}).`);
  }
  return { recordType: card.recordType, id, number, url: recordUrl(cfg.apiUrl, projectId, card.recordType, id), warnings, reporterName, reporterId: me?.id == null ? null : String(me.id), card, uploads: uploadIds.length };
}
