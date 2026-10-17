// Daily log by voice (docs/closeout-and-daily-log-spec.md, Feature B), with the signed-in person's own Procore sign-in.
// GET  /api/procore/daily-log?companyId=&projectId=&date= : can this person use the Daily Log here (B7: a light read
//      of the day's manpower; 403 = no), plus what the review screen needs: the project's date and time zone, the
//      person's own company (B6 default), the project's companies, locations and delay types, and the manpower
//      already logged that day (B6 "You already logged X today").
// POST /api/procore/daily-log : one entry (same-origin JSON) { companyId, projectId, date, section, entryId, entry,
//      photos: [{ type, data (base64) }] }. The phone sends entries one at a time so each one succeeds or fails on its
//      own (B5). entryId is remembered (procoreProjects/{key}/dailyLogEntries/{entryId}), so a retry after a lost
//      answer never makes a second copy. Answers { id, section, status, duplicate }.
// GET  ?view=past&from=&to= : Past logs. Every entry in that span (max 31 days, never after the project's today) in
//      the four sections, who made it, and whether it's this person's own ({ entries: [{ ..., mine }] }).
// POST { action: "update" | "delete", section, id, entry? } : change or delete one of the person's OWN entries.
//      The server reads the entry first and refuses anyone else's. Procore refuses a Completed (locked) day with
//      403; that comes back as day_locked. Never sends a status: approval stays Procore's / the GC's.
// Never logs what was said, a token, or a photo.
import { config, HttpError, procoreId, queryOf, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { allPages } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { firestore } from "../_firestore.js";
import { cleanEntry, delayTypeName, delayTypePaths, entryFromProcore, friendlyError, ianaZone, manpowerLine, procoreFields, projectDay, requestFor, SECTION_KEYS, SECTIONS } from "../_dailyLog.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAX_SPAN_DAYS = 31;
const dayNumber = (iso) => Date.parse(`${iso}T12:00:00Z`) / 86400000;
const listOf = (r) => (r.ok && Array.isArray(r.json) ? r.json : []);
async function pages(req, res, cfg, path, opts) {
  try { return await allPages(req, res, cfg, path, opts); } catch (err) { if ([403, 404].includes(err?.status)) return []; throw err; }
}

// The name of the person's Procore permission template here, so the "no access" screen can say what to change
async function myTemplate(send, companyId, projectId) {
  const me = await send("/rest/v1.0/me", { company_id: companyId });
  const users = await send(`/rest/v1.0/projects/${projectId}/users`, { per_page: 300 });
  const mine = listOf(users).find((u) => String(u.id) === String(me.json?.id));
  return mine?.permission_template?.name ?? null;
}

async function options(req, res, cfg, companyId, projectId, askedDate) {
  const send = (path, query) => procoreSend(req, res, cfg, "GET", path, { companyId, query });
  const proj = await send(`/rest/v1.0/projects/${projectId}`, { company_id: companyId });
  if (proj.status === 401) throw new HttpError(401, "not_connected", "Connect Procore again.");
  if (proj.status === 403 || proj.status === 404) throw new HttpError(403, "no_access", "You're not on that project in Procore.");
  const timeZone = ianaZone(proj.json?.time_zone);
  const today = projectDay(proj.json?.time_zone);
  const date = askedDate && DATE.test(askedDate) && askedDate <= today ? askedDate : today;

  // B7: a light read of the day's manpower. 403 = this person's template can't use the Daily Log here.
  const probe = await send(`/rest/v1.0/projects/${projectId}/manpower_logs`, { log_date: date });
  if (probe.status === 403) return { access: false, reason: "You don't have permission to use the Daily Log on this project.", template: await myTemplate(send, companyId, projectId), timeZone, today, date };
  if (probe.status === 404) return { access: false, reason: "The Daily Log isn't turned on for this project in Procore.", timeZone, today, date };
  if (probe.status === 429) throw new HttpError(429, "busy", "Procore is busy. Try again in a moment.");

  const me = await send("/rest/v1.0/me", { company_id: companyId });
  const users = await send(`/rest/v1.0/projects/${projectId}/users`, { per_page: 300 });
  const mine = listOf(users).find((u) => String(u.id) === String(me.json?.id));
  const myCompany = mine?.vendor?.id ? { id: mine.vendor.id, name: mine.vendor.name } : null;
  const vendors = await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/vendors`, { companyId, query: {} });
  const companies = vendors.filter((v) => v.is_active !== false && v.name).map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
  if (myCompany && !companies.some((c) => c.id === myCompany.id)) companies.unshift(myCompany);
  const locations = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/locations`, { companyId, query: {} }))
    .slice(0, 500).map((l) => ({ id: l.id, name: l.node_name || l.name })).filter((l) => l.name);
  let delayTypes = [];
  for (const path of delayTypePaths(companyId, projectId)) {
    const r = await send(path, { project_id: projectId });
    if (r.ok && Array.isArray(r.json)) {
      delayTypes = r.json.filter((t) => t.active !== false && t.visible !== false && delayTypeName(t)).map((t) => ({ id: t.id ?? null, name: delayTypeName(t), key: t.translation_key ?? null }));
      break;
    }
  }
  return {
    access: true, timeZone, today, date, myCompany, companies, locations, delayTypes,
    existing: { manpower: listOf(probe).map(manpowerLine) },
  };
}

// Past logs: every entry from `from` to `to` (one day: log_date, which the sandbox confirmed; a span: start_date and
// end_date), newest day first. Entries outside the span are dropped in case Procore ignores the span.
async function past(req, res, cfg, companyId, projectId, from, to) {
  const send = (path, query) => procoreSend(req, res, cfg, "GET", path, { companyId, query });
  const proj = await send(`/rest/v1.0/projects/${projectId}`, { company_id: companyId });
  if (proj.status === 401) throw new HttpError(401, "not_connected", "Connect Procore again.");
  if (proj.status === 403 || proj.status === 404) throw new HttpError(403, "no_access", "You're not on that project in Procore.");
  const timeZone = ianaZone(proj.json?.time_zone);
  const today = projectDay(proj.json?.time_zone);
  if (!DATE.test(from ?? "") || !DATE.test(to ?? "")) throw new HttpError(400, "bad_date", "Pick the days to show.");
  if (to > today) to = today;
  if (from > to) throw new HttpError(400, "bad_date", "Pick the days to show.");
  if (dayNumber(to) - dayNumber(from) >= MAX_SPAN_DAYS) throw new HttpError(400, "bad_date", "Pick a month or less at a time.");
  const me = await send("/rest/v1.0/me", { company_id: companyId });
  const myId = me.json?.id ?? null;
  const query = from === to ? { log_date: from } : { start_date: from, end_date: to };
  const entries = [];
  for (const section of SECTION_KEYS) {
    let list;
    try {
      list = await allPages(req, res, cfg, `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}`, { companyId, query });
    } catch (err) {
      if (err?.status === 403) return { access: false, reason: "You don't have permission to see the Daily Log on this project.", template: await myTemplate(send, companyId, projectId), timeZone, today, from, to };
      if (err?.status === 404) return { access: false, reason: "The Daily Log isn't turned on for this project in Procore.", timeZone, today, from, to };
      throw err;
    }
    for (const raw of list) {
      const e = entryFromProcore(section, raw);
      if (!e.date || e.date < from || e.date > to) continue;
      entries.push({ ...e, mine: myId != null && String(e.by.id) === String(myId) });
    }
  }
  entries.sort((a, b) => (a.date === b.date ? String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) : a.date < b.date ? 1 : -1));
  return { access: true, timeZone, today, from, to, entries };
}

// Change or delete one of the person's own entries. Read first: only the person who made it may change it.
async function change(req, res, cfg, companyId, projectId, body) {
  const action = String(body.action);
  const section = String(body.section ?? "");
  if (!SECTIONS[section]) throw new HttpError(400, "bad_section", "Unknown part of the Daily Log.");
  const id = procoreId(String(body.id ?? ""));
  if (!id) throw new HttpError(400, "bad_entry", "That entry can't be found.");
  const path = `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}/${id}`;
  let cleaned = null;
  if (action === "update") {
    try { cleaned = cleanEntry(section, body.entry); } catch (err) { throw new HttpError(400, "bad_entry", err.message); }
  }
  const was = await procoreSend(req, res, cfg, "GET", path, { companyId });
  if (was.status === 401) throw new HttpError(401, "not_connected", "Sign in to Procore again.");
  if (was.status === 404) throw new HttpError(404, "gone", "This entry isn't in Procore anymore. Refresh the day.");
  if (was.status === 403) throw new HttpError(403, "no_access", "You don't have permission to see this entry.");
  if (!was.ok) throw new HttpError(502, "procore_failed", "Procore didn't answer. Try again.");
  const me = await procoreSend(req, res, cfg, "GET", "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
  if (!me.json?.id || String(was.json?.created_by?.id) !== String(me.json.id)) throw new HttpError(403, "not_yours", "You can only change entries you made.");
  const date = String(was.json?.date ?? "").slice(0, 10);
  const r = action === "update"
    ? await procoreSend(req, res, cfg, "PATCH", path, { companyId, body: { [SECTIONS[section].root]: procoreFields(section, cleaned, { date, clear: true }) } })
    : await procoreSend(req, res, cfg, "DELETE", path, { companyId });
  if (r.status === 403) {
    console.log("SiteSnap daily log change refused", JSON.stringify({ action, section, status: 403 }));
    throw new HttpError(403, "day_locked", "Procore has locked this day. Once a day is marked Completed, nobody can change it. Ask your superintendent to reopen it in Procore.");
  }
  if (!r.ok) {
    const e = friendlyError(section, r);
    const message = e.code === "procore_failed" ? `Procore didn't ${action === "delete" ? "delete" : "save"} it. Try again.` : e.message.replace(" and tap Retry.", " and save again.").replace(" tap Retry.", " try again.");
    return sendJson(res, e.status, { error: e.code, message, retryAfter: e.retryAfter ?? null });
  }
  console.log("SiteSnap daily log entry changed", JSON.stringify({ action, section, id }));
  const after = action === "update" ? entryFromProcore(section, { ...was.json, ...(r.json ?? {}) }) : null;
  sendJson(res, 200, { ok: true, action, section, id, entry: after ? { ...after, mine: true } : null });
}

function cleanPhotos(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_PHOTOS).map((p) => {
    const type = String(p?.type ?? "").split(";")[0];
    const bytes = Buffer.from(String(p?.data ?? ""), "base64");
    if (!TYPES.has(type) || !bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new HttpError(400, "bad_photo", "A photo is too big or not a photo. Take it again.");
    return { type, bytes };
  });
}

let db = null;
async function entryLog(key) {
  try { db = await firestore(); return db.collection("procoreProjects").doc(key).collection("dailyLogEntries"); }
  catch (err) { console.log("SiteSnap daily log: no entry log", err.message); return null; }
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (req.method === "GET") {
      const q = queryOf(req);
      const companyId = procoreId(q.get("companyId"));
      const projectId = procoreId(q.get("projectId"));
      if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
      if (q.get("view") === "past") return sendJson(res, 200, await past(req, res, cfg, companyId, projectId, q.get("from"), q.get("to")));
      return sendJson(res, 200, await options(req, res, cfg, companyId, projectId, q.get("date")));
    }
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const body = await readBody(req);
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    if (body.action === "update" || body.action === "delete") return await change(req, res, cfg, companyId, projectId, body);
    const section = String(body.section ?? "");
    if (!SECTIONS[section]) throw new HttpError(400, "bad_section", "Unknown part of the Daily Log.");
    const date = String(body.date ?? "");
    if (!DATE.test(date)) throw new HttpError(400, "bad_date", "Pick the day for this log.");
    const entryId = String(body.entryId ?? "");
    if (!ENTRY.test(entryId)) throw new HttpError(400, "bad_entry", "This entry can't be sent. Organize the log again.");
    let entry;
    try { entry = cleanEntry(section, body.entry); } catch (err) { throw new HttpError(400, "bad_entry", err.message); }
    const photos = cleanPhotos(body.photos);

    // Already sent (an earlier try whose answer was lost)? Answer with that one.
    const log = await entryLog(`${companyId}_${projectId}`);
    const seen = log ? await log.doc(entryId).get().catch(() => null) : null;
    if (seen?.exists) { const was = seen.data() ?? {}; return sendJson(res, 200, { id: was.procoreId ?? null, section, status: was.status ?? null, duplicate: true }); }

    const r = await procoreSend(req, res, cfg, "POST", `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}`, {
      companyId, ...requestFor(section, procoreFields(section, entry, { date }), photos),
    });
    if (!r.ok) {
      const e = friendlyError(section, r);
      console.log("SiteSnap daily log refused", JSON.stringify({ section, status: r.status }));
      return sendJson(res, e.status, { error: e.code, message: e.message, retryAfter: e.retryAfter ?? null });
    }
    const out = { id: r.json?.id ?? null, section, status: r.json?.status ?? null, duplicate: false };
    if (log) await log.doc(entryId).set({ section, procoreId: out.id, status: out.status, date, photos: photos.length, at: Date.now() }).catch(() => {});
    console.log("SiteSnap daily log entry created", JSON.stringify({ section, id: out.id, photos: photos.length }));
    sendJson(res, 201, out);
  } catch (err) {
    sendError(res, err);
  }
}
