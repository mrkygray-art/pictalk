// Inspections (sitesnap-inspections-spec.md), with the signed-in person's own Procore sign-in. Always reads first;
// Procore decides what each person may do (a 403 becomes a plain message, never a raw code).
// GET  ?companyId=&projectId=           : the Inspections list, grouped: assigned to me (I'm an inspector), my
//      company's work (responsible contractor = my company), open on this project. 401/403 = { access: false }.
// GET  ?companyId=&projectId=&id=       : one inspection with its sections and items ("2.3" numbers, answers, who).
// POST (same-origin JSON) { companyId, projectId, listId, action, opId, ... }:
//   answer     { itemId, answer, known, force } : save one answer. Re-reads the item first: answered by someone
//              else since the phone last saw it (known) and not force -> 409 already_answered { by, answer }.
//   note       { itemId, text }                 : a note on the item (Procore comment; not_saved if refused).
//   photo      { itemId, photo: { type, data } }: attach a photo to the item.
//   section_na { sectionId, na }                : set a section N/A (or back), only when it differs.
//   fail       { itemId, card, files, contractor }: the failed item becomes an Observation, linked to the item
//              (inspection_item_failed), through Report an issue's code path; if Procore won't link it, it's made
//              unlinked with the inspection and item number in the description and the item is marked failed.
//   close      {}                               : submit (close). 403 -> { closed: false, reason: "role" }.
// opId (8-64 letters, digits, - _) is remembered for photo and fail at procoreProjects/{key}/inspectionOps/{opId},
// so a retry after a lost answer never attaches twice or makes a second Observation.
import { config, HttpError, procoreId, queryOf, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { firestore } from "../_firestore.js";
import { cleanCard } from "../_records.js";
import { cleanFiles, createRecord, procoreError } from "../_createRecord.js";
import { demoCodeOf, demoMode, withTag } from "../_demoScenarios.js";
import { countsFor, failContextHtml, findItem, friendlyRefusal, groupInspections, inspectionDetail, inspectionSummary, oldAnswerBody, PATHS, responseBody, sameAnswer } from "../_inspections.js";

const OP = /^[A-Za-z0-9_-]{8,64}$/;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PER_PAGE = 100;
const NO_ACCESS = "Your Procore role can't see Inspections on this project. Ask your project manager for access.";

const fail = (r, doing) => { const e = friendlyRefusal(r, doing); return new HttpError(e.status, e.code, e.message); };
const log = (what, data) => console.log(`SiteSnap inspections ${what}`, JSON.stringify(data));

let db = null;
// Procore's inspection read doesn't say which sections are N/A (sandbox, 2026-10-16), and its N/A call is a toggle.
// So SiteSnap remembers what it set: procoreProjects/{key}/inspectionSections/{listId}_{sectionId} = { na, at }.
async function naLog(key) {
  try { db = await firestore(); return db.collection("procoreProjects").doc(key).collection("inspectionSections"); }
  catch (err) { log("no section log", { error: err.message }); return null; }
}
async function withSavedNa(key, inspection) {
  const unknown = inspection.sections.filter((s) => !s.naKnown);
  if (!unknown.length) return inspection;
  const store = await naLog(key);
  if (!store) return inspection;
  const docs = await Promise.all(unknown.map((s) => store.doc(`${inspection.id}_${s.id}`).get().catch(() => null)));
  unknown.forEach((s, i) => { if (docs[i]?.exists) s.na = docs[i].data()?.na === true; });
  return inspection;
}

async function opsLog(key) {
  try { db = await firestore(); return db.collection("procoreProjects").doc(key).collection("inspectionOps"); }
  catch (err) { log("no op log", { error: err.message }); return null; }
}

async function whoAmI(send, companyId, projectId) {
  const me = await send("GET", "/rest/v1.0/me", { query: { company_id: companyId } });
  const users = await send("GET", `/rest/v1.0/projects/${projectId}/users`, { query: { per_page: 300 } });
  const mine = (users.ok && Array.isArray(users.json) ? users.json : []).find((u) => String(u.id) === String(me.json?.id));
  return { myId: me.json?.id != null ? String(me.json.id) : null, myName: me.json?.name ?? null, myCompany: mine?.vendor?.id ? { id: String(mine.vendor.id), name: mine.vendor.name ?? null } : null };
}

async function list(send, companyId, projectId) {
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    const r = await send("GET", PATHS.lists(projectId), { query: { page, per_page: PER_PAGE, sort: "number" } });
    if (r.status === 401 || r.status === 403) return { access: false, reason: NO_ACCESS };
    if (r.status === 404) return { access: false, reason: "Inspections aren't turned on for this project in Procore. Ask your project manager." };
    if (!r.ok) throw fail(r, "see inspections");
    const batch = Array.isArray(r.json) ? r.json : [];
    rows.push(...batch.map(inspectionSummary));
    if (batch.length < PER_PAGE) break;
  }
  const who = await whoAmI(send, companyId, projectId);
  return { access: true, myCompany: who.myCompany, groups: groupInspections(rows, { myId: who.myId, myCompanyId: who.myCompany?.id }) };
}

async function readOne(send, projectId, listId) {
  const r = await send("GET", PATHS.list(listId), { query: { project_id: projectId } });
  if (r.status === 401 || r.status === 403) return { access: false, reason: NO_ACCESS };
  if (!r.ok) throw fail(r, "open this inspection");
  return { access: true, inspection: inspectionDetail(r.json) };
}

async function mustRead(send, projectId, listId) {
  const one = await readOne(send, projectId, listId);
  if (!one.access) throw new HttpError(403, "no_access", one.reason);
  return one.inspection;
}

async function answer(send, projectId, listId, body) {
  const inspection = await mustRead(send, projectId, listId);
  const hit = findItem(inspection, body.itemId);
  if (!hit) throw new HttpError(404, "gone", "This item isn't on the inspection anymore. Go back and open it again.");
  const { item } = hit;
  let reqBody;
  try { reqBody = responseBody(item, body.answer); } catch (err) { throw new HttpError(400, "bad_answer", err.message); }
  const current = item.answer;
  const known = body.known && typeof body.known === "object" ? body.known : null;
  // Someone else answered since this phone last looked: ask first, never overwrite quietly
  const changedSince = current && current.by && !(known && String(known.byId ?? "") === String(current.by.id) && String(known.at ?? "") === String(current.at ?? ""));
  if (changedSince && body.myId !== current.by.id && !body.force && !sameAnswer(item, current, body.answer)) {
    return { status: 409, out: { error: "already_answered", message: `Already answered by ${current.by.name}.`, by: current.by, answer: current, item } };
  }
  let r = await send("POST", PATHS.respond(projectId, item.id), { body: reqBody });
  let way = "item_response";
  if (r.status === 404) {
    const old = oldAnswerBody(item, body.answer, projectId);
    if (old) { r = await send("PATCH", PATHS.item(listId, item.id), { body: old }); way = "item_patch"; }
  }
  if (!r.ok) { log("answer refused", { status: r.status, way }); throw fail(r, "answer items"); }
  const counts = countsFor(item, body.answer);
  log("answer saved", { listId, itemId: item.id, counts, way });
  const after = await readOne(send, projectId, listId).catch(() => null);
  const fresh = after?.inspection ? findItem(after.inspection, item.id)?.item : null;
  return { status: 200, out: { ok: true, way, item: fresh ?? { ...item, answer: { counts, optionId: body.answer?.optionId ?? null, value: body.answer?.value ?? null, by: null, at: new Date().toISOString() } }, counts: after?.inspection?.counts ?? null } };
}

async function note(send, projectId, listId, body) {
  const t = String(body.text ?? "").trim().slice(0, 4000);
  if (!t) throw new HttpError(400, "bad_note", "Say or type the note first.");
  const r = await send("POST", PATHS.comment(projectId, body.itemId), { body: { comment: { body: t } } });
  if (!r.ok) { log("note refused", { status: r.status }); return { ok: false, saved: false, reason: r.status === 403 ? "no_permission" : "not_supported" }; }
  return { ok: true, saved: true };
}

async function photo(req, res, cfg, companyId, projectId, listId, body, send) {
  const type = String(body.photo?.type ?? "").split(";")[0];
  const bytes = Buffer.from(String(body.photo?.data ?? ""), "base64");
  if (!PHOTO_TYPES.has(type) || !bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new HttpError(400, "bad_photo", "The photo is too big or not a photo. Take it again.");
  const inspection = await mustRead(send, projectId, listId);
  const hit = findItem(inspection, body.itemId);
  if (!hit) throw new HttpError(404, "gone", "This item isn't on the inspection anymore.");
  const OLD = { pass: "yes", fail: "no", na: "n/a" };
  const form = () => {
    const f = new FormData();
    f.append("project_id", String(projectId));
    f.append("section_id", hit.section.id);
    f.append("item[status]", OLD[hit.item.answer?.counts] ?? "none"); // unchanged: the item's answer stays as it is
    f.append("attachments[]", new Blob([bytes], { type }), `SiteSnap-item-${hit.item.number}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`);
    return f;
  };
  const r = await procoreSend(req, res, cfg, "PATCH", PATHS.item(listId, hit.item.id), { companyId, form });
  if (!r.ok) { log("photo refused", { status: r.status }); throw fail(r, "add photos"); }
  return { ok: true, photos: Array.isArray(r.json?.attachments) ? r.json.attachments.length : hit.item.photos + 1 };
}

async function sectionNa(send, key, projectId, listId, body) {
  const inspection = await withSavedNa(key, await mustRead(send, projectId, listId));
  const s = inspection.sections.find((x) => x.id === String(body.sectionId));
  if (!s) throw new HttpError(404, "gone", "This section isn't on the inspection anymore.");
  const want = body.na !== false;
  if (s.na === want) return { ok: true, na: want, changed: false };
  let r = await send("PATCH", PATHS.sectionToggle(listId, s.id), { body: { project_id: Number(projectId) } });
  if (r.status === 404 || r.status === 405) r = await send("PATCH", PATHS.section(listId, s.id), { body: { project_id: Number(projectId), section: { name: s.name, position: s.position, not_applicable: want } } });
  if (!r.ok) { log("section refused", { status: r.status }); throw fail(r, "set sections N/A"); }
  // Procore's answer says where it landed, when it says; else it's what was asked for
  const now = typeof r.json?.not_applicable === "boolean" ? r.json.not_applicable : want;
  const store = await naLog(key);
  if (store) await store.doc(`${listId}_${s.id}`).set({ na: now, at: Date.now() }).catch(() => {});
  return { ok: true, na: now, changed: true };
}

async function failItem(req, res, cfg, companyId, projectId, listId, body, send) {
  const inspection = await mustRead(send, projectId, listId);
  const hit = findItem(inspection, body.itemId);
  if (!hit) throw new HttpError(404, "gone", "This item isn't on the inspection anymore.");
  let card;
  try { card = cleanCard({ ...body.card, recordType: "observation" }); } catch (err) { throw new HttpError(400, "bad_card", err.message); }
  if (demoMode() && demoCodeOf(projectId)) card = { ...card, title: withTag(card.title) };
  if (!card.locationId && !card.locationText && inspection.locationId) card = { ...card, locationId: inspection.locationId };
  if (!card.tradeId && inspection.trade?.id) card = { ...card, tradeId: inspection.trade.id };
  const contractor = body.contractor?.name ? { name: String(body.contractor.name).slice(0, 200) } : inspection.responsibleContractor;
  const context = failContextHtml({ inspection, item: hit.item, contractor });
  const files = cleanFiles(body.files);
  const linked = (b) => ({ ...b, inspection_item_failed: 1, observation: { ...b.observation, checklist_item_id: Number(hit.item.id), description: `${context}${b.observation.description}` } });
  const unlinked = (b) => ({ ...b, observation: { ...b.observation, description: `${context}${b.observation.description}` } });
  let made;
  let link = true;
  try {
    made = await createRecord(req, res, cfg, { companyId, projectId, card, files, extra: linked, checkedProject: true });
  } catch (err) {
    // Procore won't link it to the item: make it unlinked (inspection + item number in the description), then fail the item
    if (err?.status !== 422 || !/checklist|inspection|item/i.test(procoreError(err.procore ?? {}) ?? "")) throw err;
    link = false;
    made = await createRecord(req, res, cfg, { companyId, projectId, card, files, extra: unlinked, checkedProject: true });
  }
  let itemFailed = link;
  if (!link) {
    const r = await answer(send, projectId, listId, { itemId: hit.item.id, answer: { counts: "fail" }, force: true, myId: body.myId }).catch(() => null);
    itemFailed = r?.status === 200;
  }
  log("observation made", { listId, itemId: hit.item.id, id: made.id, linked: link, files: made.uploads });
  return { recordType: "observation", id: made.id, number: made.number, url: made.url, warnings: made.warnings, linked: link, itemFailed };
}

async function close(send, projectId, listId) {
  const r = await send("PATCH", PATHS.close(projectId, listId), {});
  if (r.status === 403) return { closed: false, reason: "role", message: "Saved. Your project manager will review it." };
  if (!r.ok) { log("close refused", { status: r.status }); throw fail(r, "close it"); }
  return { closed: true };
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (req.method === "GET") {
      const q = queryOf(req);
      const companyId = procoreId(q.get("companyId"));
      const projectId = procoreId(q.get("projectId"));
      if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
      const send = (method, path, opts = {}) => procoreSend(req, res, cfg, method, path, { companyId, ...opts });
      const id = q.get("id");
      if (id) {
        const listId = procoreId(id);
        if (!listId) throw new HttpError(400, "bad_id", "That inspection can't be found.");
        const one = await readOne(send, projectId, listId);
        if (one.access) await withSavedNa(`${companyId}_${projectId}`, one.inspection);
        if (one.access) { const who = await send("GET", "/rest/v1.0/me", { query: { company_id: companyId } }); one.myId = who.json?.id != null ? String(who.json.id) : null; }
        return sendJson(res, 200, one);
      }
      return sendJson(res, 200, await list(send, companyId, projectId));
    }
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const body = await readBody(req);
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    const listId = procoreId(String(body.listId ?? ""));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    if (!listId) throw new HttpError(400, "bad_id", "That inspection can't be found.");
    const action = String(body.action ?? "");
    const send = (method, path, opts = {}) => procoreSend(req, res, cfg, method, path, { companyId, ...opts });

    // Only a project this person can open in Procore
    const { projects } = await listProjects(req, res, cfg);
    if (!projects.some((p) => p.companyId === companyId && p.projectId === projectId)) throw new HttpError(403, "no_access", "You're not on that project in Procore.");

    if (action === "answer") {
      const me = await send("GET", "/rest/v1.0/me", { query: { company_id: companyId } });
      const r = await answer(send, projectId, listId, { ...body, myId: me.json?.id != null ? String(me.json.id) : null });
      return sendJson(res, r.status, r.out);
    }
    if (action === "note") return sendJson(res, 200, await note(send, projectId, listId, body));
    if (action === "section_na") return sendJson(res, 200, await sectionNa(send, `${companyId}_${projectId}`, projectId, listId, body));
    if (action === "close") return sendJson(res, 200, await close(send, projectId, listId));
    if (action !== "photo" && action !== "fail") throw new HttpError(400, "bad_action", "Unknown action.");

    // photo / fail: once only, even when the phone retries after a lost answer
    const opId = String(body.opId ?? "");
    if (!OP.test(opId)) throw new HttpError(400, "bad_op", "Try again.");
    const ops = await opsLog(`${companyId}_${projectId}`);
    const seen = ops ? await ops.doc(opId).get().catch(() => null) : null;
    if (seen?.exists) return sendJson(res, 200, { ...(seen.data()?.out ?? {}), duplicate: true });
    let out;
    if (action === "photo") out = await photo(req, res, cfg, companyId, projectId, listId, body, send);
    else {
      const me = await send("GET", "/rest/v1.0/me", { query: { company_id: companyId } });
      out = await failItem(req, res, cfg, companyId, projectId, listId, { ...body, myId: me.json?.id != null ? String(me.json.id) : null }, send);
    }
    if (ops) await ops.doc(opId).set({ action, listId, itemId: String(body.itemId ?? ""), out, at: Date.now() }).catch(() => {});
    sendJson(res, action === "fail" ? 201 : 200, out);
  } catch (err) {
    sendError(res, err);
  }
}
