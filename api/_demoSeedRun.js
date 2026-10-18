// The sandbox demo seed's work (api/procore/demo-seed.js): runs one task of api/_demoSeedData.js tasks() per
// request, keeps the seed map (which Procore ids each task made) in server-only Firestore, and undoes only what it
// made. Every Procore call is paced (api/_seedSteps.js) and a 429 stops the task, which then resumes where it was.
//   sitesnapDemoSeed/state               { companyId, lastRunAt, invites { key: { at, ok, detail } } }
//   sitesnapDemoSeed/state/tasks/{id}    { id, status: not_started | done | partial | failed, made {…}, notes[], error, at }
// Threads it writes: procoreProjects/{c}_{p}/conversations/seed-{id} (seed: true), messages seed-{id}-{n}.
// Procore paths (developers.procore.com, via withone.ai's mirror 2026-10-18; the ones marked * are new to SiteSnap and
// unconfirmed in the sandbox, so each one's answer goes into the task's notes):
//   POST /rest/v1.0/projects {company_id, project}; GET /rest/v1.0/settings/permissions?project_id= (tools on)
//   * GET/POST /rest/v1.0/companies/{c}/trades {trade: {name, active}}
//   vendors, users, permission templates, project roles: api/_seedSteps.js
//   GET/POST /rest/v1.0/image_categories?project_id= ; POST /rest/v1.0/images?project_id= {upload_uuid, image_name, image}
//   * DELETE /rest/v1.0/images/{id}?project_id=
//   Observations / Punch Items: api/_demoImport.js (create, PATCH, response_logs, comments, delete).
//   * punch_item: punch_item_manager_id, final_approver_id, mt_location, workflow_status (work_required / ready_for_review)
//   Daily Log: api/_dailyLog.js (POST / DELETE …/{section}_logs)
//   * POST /rest/v1.0/companies/{c}/checklist/list_templates {list_template: {name, description}}
//   * POST …/list_templates/{t}/sections {section: {name, position, items_attributes[]}} (+ item paths tried in turn)
//   * POST /rest/v1.0/projects/{p}/checklist/list_templates/create_from_company_template {source_template_id}
//   * POST /rest/v1.0/checklist/lists {project_id, template_id, list: {name, due_at, inspector_ids, personal}}
//   * POST /rest/v1.0/checklist/lists/{l}/sections {project_id, section: {…, items_attributes}} (deprecated; fallback)
//   answers and notes: api/_inspections.js PATHS; * DELETE /rest/v1.0/checklist/lists/{l}?project_id=
//   * PATCH /rest/v1.0/companies/{c}/users/{id}/invite (else POST): Procore's invite email
import { HttpError } from "./_procore.js";
import { uploadFile } from "./_procoreWrite.js";
import { firestore } from "./_firestore.js";
import { recordUrl } from "./_records.js";
import { readPath } from "./_recordStatus.js";
import { addCompany, addPerson, api, brief, lower, pages, waitTurn } from "./_seedSteps.js";
import { pickObservationType } from "./_demoScenarios.js";
import { procoreFields, delayTypeName, delayTypeKey, delayTypePaths, SECTIONS } from "./_dailyLog.js";
import { PATHS, inspectionDetail, responseBody } from "./_inspections.js";
import {
  ALBUMS, COMPANIES, DAILY_LOGS, DELAY_KIND_WORDS, INSPECTIONS, INSPECTION_TEMPLATES, KY, MESSAGES, PHOTOS,
  PROJECTS, RECORDS, SEED_TAG, TRADES, addDays, dayOf, directoryUser, emailFor, fullName, isSeedTitle, nameOf, personByKey,
  recipientsOf, recordById, taskById, tasks, workDays,
} from "./_demoSeedData.js";
import { SEED_PHOTOS } from "./_demoSeedPhotos.js";

export const REQUIRED_TOOLS = { observations: "Observations", punch_list: "Punch List", checklists: "Inspections", daily_log: "Daily Log", images: "Photos", directory: "Directory" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const said = (r) => {
  const e = r?.json?.errors ?? r?.json?.message ?? r?.json?.error;
  if (!e) return `Procore answered ${r?.status}.`;
  return `Procore answered ${r.status}: ${typeof e === "string" ? e : JSON.stringify(e).slice(0, 240)}`;
};

// ---------- the store (Firestore; tests replace it with setSeedStore) ----------

let seedStore = null;
export const setSeedStore = (s) => { seedStore = s; };

export async function store() {
  if (seedStore) return seedStore;
  const db = await firestore();
  const rows = () => db.collection("sitesnapDemoSeed/state/tasks");
  const conv = (key, cid) => db.doc(`procoreProjects/${key}/conversations/${cid}`);
  return {
    async rows() { return Object.fromEntries((await rows().get()).docs.map((d) => [d.id, d.data()])); },
    async row(id) { return (await rows().doc(id).get()).data() ?? null; },
    async saveRow(id, row) { await rows().doc(id).set(row); },
    async meta() { return (await db.doc("sitesnapDemoSeed/state").get()).data() ?? {}; },
    async saveMeta(patch) { await db.doc("sitesnapDemoSeed/state").set(patch, { merge: true }); },
    async putThread(key, cid, data) { await conv(key, cid).set(data); },
    async putMessage(key, cid, mid, data) { await conv(key, cid).collection("messages").doc(mid).set(data); },
    async messageExists(key, cid, mid) { return (await conv(key, cid).collection("messages").doc(mid).get()).exists; },
    async putPhotoLink(key, imageId, data) { await db.doc(`procoreProjects/${key}/photoLinks/${imageId}`).set(data); },
    async deletePhotoLink(key, imageId) { await db.doc(`procoreProjects/${key}/photoLinks/${imageId}`).delete(); },
    async deleteThread(key, cid) {
      const ref = conv(key, cid);
      const refs = [...(await ref.collection("messages").get()).docs.map((d) => d.ref),
        ...(await db.collection(`procoreProjects/${key}/members`).get()).docs.map((m) => m.ref.collection("reads").doc(cid)), ref];
      for (let i = 0; i < refs.length; i += 400) { const b = db.batch(); refs.slice(i, i + 400).forEach((r) => b.delete(r)); await b.commit(); }
    },
  };
}

let wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const setSeedWait = (fn) => { wait = fn; };

const fresh = (id) => ({ id, status: "not_started", made: {}, notes: [], error: null, at: null });
const madeSomething = (made) => Object.values(made ?? {}).some((v) => v != null && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length));
/** Every task with its row (unsaved rows read as not started) */
export async function allRows(st) {
  const saved = await st.rows();
  return tasks().map((t) => ({ ...t, row: saved[t.id] ?? fresh(t.id) }));
}

// ---------- context ----------

class Stop extends Error { constructor(message, rateLimited = false) { super(message); this.rateLimited = rateLimited; } }

/** One request's context: the company, the saved project ids, and a paced Procore caller that stops on a 429 */
export function context(req, res, cfg, { companyId, me, rows, projects }) {
  const call = async (method, path, opts = {}) => {
    const r = await api(req, res, cfg, method, path, { companyId, retry429: false, ...opts });
    if (r.status === 429) throw new Stop("Procore said slow down (429). Wait a minute; the task resumes where it stopped.", true);
    if (r.status === 401) throw new HttpError(401, "not_connected", "Your Procore sign-in ran out. Sign in with Procore again.");
    return r;
  };
  const projectId = (code) => rows[`project:${code}`]?.made?.projectId ?? projects?.[code] ?? null;
  const usersCache = new Map();
  return {
    req, res, cfg, companyId, me, rows, call, projectId,
    key: (code) => `${companyId}_${projectId(code)}`,
    needProject(code) { const id = projectId(code); if (!id) throw new Stop(`Run "Project ${PROJECTS[code].name}" first.`); return id; },
    vendorId(co, code) { return rows[`company:${co}:${code}`]?.made?.vendorId ?? Object.entries(rows).find(([k, r]) => k.startsWith(`company:${co}:`) && r.made?.vendorId)?.[1].made.vendorId ?? null; },
    // The project's people by email (one read per project per request)
    async users(code) {
      if (!usersCache.has(code)) usersCache.set(code, (await pages(req, res, cfg, `/rest/v1.0/projects/${this.needProject(code)}/users`, { companyId, retry429: false })) ?? []);
      return usersCache.get(code);
    },
    /** { procoreUserId, name, company, title } for a seed person key (or KY = the signed-in admin), else null */
    async who(code, k) {
      if (k === KY) return { procoreUserId: String(me.id), name: me.name, company: COMPANIES.harborline.name, title: "Project Manager" };
      const p = personByKey(k);
      const email = emailFor(p);
      const u = email ? (await this.users(code)).find((x) => lower(x.email_address) === lower(email)) : null;
      return u ? { procoreUserId: String(u.id), name: fullName(p), company: u.vendor?.name || COMPANIES[p.company].name, title: p.job_title } : null;
    },
  };
}

// ---------- running one task ----------

/** Runs a task (resuming its row). Returns the saved row. */
export async function runTask(ctx, taskId) {
  const t = taskById(taskId);
  if (!t) throw new HttpError(400, "bad_request", "Unknown task.");
  const st = await store();
  const row = { ...fresh(t.id), ...(ctx.rows[t.id] ?? {}) };
  row.made = { ...(row.made ?? {}) };
  row.notes = [];
  row.error = null;
  const note = (s) => row.notes.push(s);
  let rateLimited = false;
  try {
    const out = await RUN[t.kind](ctx, t, row.made, note);
    row.status = out === "partial" ? "partial" : "done";
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    rateLimited = err.rateLimited;
    row.status = madeSomething(row.made) ? "partial" : "failed";
    row.error = err.message;
  }
  row.at = Date.now();
  await st.saveRow(t.id, row);
  ctx.rows[t.id] = row;
  return { row, rateLimited };
}

const RUN = {
  // The project: found by its exact name in the company, else made
  async project(ctx, t, made, note) {
    const name = PROJECTS[t.project].name;
    if (made.projectId) {
      const r = await ctx.call("GET", `/rest/v1.0/projects/${made.projectId}`, { query: { company_id: ctx.companyId } });
      if (r.ok && lower(r.json?.name) === lower(name)) return toolsCheck(ctx, made, note);
    }
    const list = (await pages(ctx.req, ctx.res, ctx.cfg, "/rest/v1.0/projects", { companyId: ctx.companyId, query: { company_id: ctx.companyId }, retry429: false })) ?? [];
    const hit = list.find((p) => lower(p.name) === lower(name));
    if (hit) made.projectId = String(hit.id);
    else {
      const r = await ctx.call("POST", "/rest/v1.0/projects", { body: { company_id: Number(ctx.companyId), project: { name, active: true } } });
      if (!r.ok || !r.json?.id) throw new Stop(`Couldn't make the project. ${said(r)}`);
      made.projectId = String(r.json.id);
      made.created = true;
    }
    return toolsCheck(ctx, made, note);
  },

  // Trades for the punch list: only the ones missing; refused = trades just stay in the description
  async trades(ctx, t, made, note) {
    made.ids ??= {};
    const list = (await pages(ctx.req, ctx.res, ctx.cfg, `/rest/v1.0/companies/${ctx.companyId}/trades`, { companyId: ctx.companyId, retry429: false })) ?? null;
    if (!list) { note("Procore didn't let us read the company's trades; trades go in each punch item's description instead."); return "done"; }
    let refused = null;
    for (const name of TRADES) {
      const hit = list.find((x) => lower(x.name) === lower(name));
      if (hit) { made.ids[name] = hit.id; continue; }
      if (refused) continue;
      const r = await ctx.call("POST", `/rest/v1.0/companies/${ctx.companyId}/trades`, { body: { trade: { name, active: true } } });
      if (r.ok && r.json?.id) { made.ids[name] = r.json.id; (made.created ??= []).push(name); } else refused = said(r);
    }
    if (refused) note(`Couldn't add trades (${refused}); the missing ones go in the description instead.`);
    return "done";
  },

  async company(ctx, t, made, note) {
    const projectId = ctx.needProject(t.project);
    const out = await addCompany(ctx.req, ctx.res, ctx.cfg, ctx.companyId, projectId, { vendor: COMPANIES[t.company] });
    out.steps.forEach((s) => note(`${s.ok ? "✓" : "✗"} ${s.name}: ${s.detail}`));
    if (!out.vendorId) throw new Stop(`Couldn't make ${COMPANIES[t.company].name}.`);
    made.vendorId = out.vendorId;
    return out.steps.every((s) => s.ok) ? "done" : "partial";
  },

  // Ky (the signed-in admin) as the project's Project Manager (cosmetic: Procore's new projects often have no roles)
  async pm(ctx, t, made, note) {
    const projectId = ctx.needProject(t.project);
    const roles = (await pages(ctx.req, ctx.res, ctx.cfg, "/rest/v1.0/project_roles", { companyId: ctx.companyId, query: { project_id: projectId }, retry429: false })) ?? [];
    const pm = roles.find((r) => lower(r.role) === "project manager");
    if (!pm) { note("This project has no Project Manager role in Procore (new projects often have none). Ky still has full access as an admin."); return "done"; }
    if (String(pm.user_id) === String(ctx.me.id)) { note("Already set."); return "done"; }
    const r = await ctx.call("POST", "/rest/v1.0/project_roles", { body: { project_id: Number(projectId), project_role: { role: pm.role, user_id: Number(ctx.me.id) } } });
    note(`${r.ok ? "✓" : "✗"} Project Manager role: ${brief(r)}`);
    return r.ok ? "done" : "partial";
  },

  async person(ctx, t, made, note) {
    const projectId = ctx.needProject(t.project);
    const p = personByKey(t.person);
    const u = directoryUser(p);
    if (!u.email_address) throw new Stop("Set DEMO_SEED_EMAIL in Vercel (or DEMO_ADMIN_EMAILS): the people's emails are plus-addresses of it.");
    const vendorId = ctx.vendorId(p.company, t.project);
    if (!vendorId) throw new Stop(`Run "${COMPANIES[p.company].name} on ${t.project}" first.`);
    const steps = await addPerson(ctx.req, ctx.res, ctx.cfg, ctx.companyId, projectId, { vendor: COMPANIES[p.company] }, u, vendorId, (_s, x) => x.templates);
    steps.forEach((s) => note(`${s.ok ? "✓" : "✗"} ${s.name}: ${s.detail}`));
    if (steps.some((s) => /429/.test(s.detail))) throw new Stop("Procore said slow down (429). Run it again in a minute.", true);
    made.email = u.email_address;
    return steps.every((s) => s.ok) ? "done" : "partial";
  },

  // The project's four albums (public), made only when missing
  async albums(ctx, t, made) {
    const projectId = ctx.needProject(t.project);
    const list = await ctx.call("GET", "/rest/v1.0/image_categories", { query: { project_id: projectId, per_page: 100 } });
    if (!list.ok) throw new Stop(`Couldn't read the project's albums (is the Photos tool on?). ${said(list)}`);
    made.ids ??= {};
    for (const name of ALBUMS) {
      const hit = (list.json ?? []).find((a) => a.name === name && !a.private);
      if (hit) { made.ids[name] = hit.id; continue; }
      if (made.ids[name]) continue;
      const r = await ctx.call("POST", "/rest/v1.0/image_categories", { query: { project_id: projectId }, body: { image_category: { name, private: false } } });
      if (!r.ok || !r.json?.id) throw new Stop(`Couldn't make the ${name} album. ${said(r)}`);
      made.ids[name] = r.json.id;
    }
    return "done";
  },

  record: (ctx, t, made, note) => runRecord(ctx, recordById(t.record), made, note),

  // One photo into its album (Procore's Photos tool), linked to its record for SiteSnap's "Linked to" badge
  async photo(ctx, t, made, note) {
    const ph = PHOTOS[t.photo];
    const projectId = ctx.needProject(ph.project);
    const albumId = ctx.rows[`albums:${ph.project}`]?.made?.ids?.[ph.album];
    if (!albumId) throw new Stop(`Run "Photo albums on ${ph.project}" first.`);
    if (!SEED_PHOTOS[t.photo]) throw new Stop("This photo isn't built (npm run build:seed-photos).");
    const rec = RECORDS.find((r) => r.photo === t.photo) ?? null;
    const recRow = rec ? ctx.rows[`record:${rec.id}`] : null;
    if (made.imageId) {
      const r = await ctx.call("GET", `/rest/v1.0/images/${made.imageId}`, { query: { project_id: projectId } });
      if (r.ok) return "done";
      if (r.status !== 404) throw new Stop(`Couldn't check the photo. ${said(r)}`);
      delete made.imageId;
    }
    await waitTurn();
    const up = await uploadFile(ctx.req, ctx.res, ctx.cfg, { companyId: ctx.companyId, projectId, name: `${t.photo}.jpg`, type: "image/jpeg", bytes: Buffer.from(SEED_PHOTOS[t.photo], "base64") });
    if (up.status === 429) throw new Stop("Procore said slow down (429).", true);
    if (!up.ok) throw new Stop(`Upload failed (${up.step}, ${up.status}).`);
    const description = `${ph.caption}. Illustration, SiteSnap demo data ${SEED_TAG}.${rec ? ` See ${rec.recordType === "observation" ? "Observation" : "Punch Item"} ${recRow?.made?.number ? `#${recRow.made.number}` : rec.id}.` : ""}`;
    const r = await ctx.call("POST", "/rest/v1.0/images", { query: { project_id: projectId }, body: { upload_uuid: up.uuid, image_name: `SiteSnap-demo-${t.photo}.jpg`, image: { image_category_id: albumId, private: false, source: "SiteSnap", description } } });
    if (!r.ok || !r.json?.id) throw new Stop(`Couldn't add the photo. ${said(r)}`);
    made.imageId = String(r.json.id);
    if (rec && recRow?.made?.procoreId) {
      await (await store()).putPhotoLink(ctx.key(ph.project), made.imageId, { type: rec.recordType, id: Number(recRow.made.procoreId), number: String(recRow.made.number ?? ""), seed: true, savedAt: Date.now() });
    } else if (rec) note(`${rec.id} isn't made yet, so the photo isn't linked to it in SiteSnap (run the photo again after it).`);
    return "done";
  },

  async dailylog(ctx, t, made, note) {
    const projectId = ctx.needProject(t.project);
    const plan = DAILY_LOGS[t.project];
    const d = plan.days[t.day];
    const date = workDays(dayOf())[t.day];
    made.date = date;
    made.entries ??= {};
    const by = plan.by === KY ? `${ctx.me.name} (Project Manager)` : `${nameOf(plan.by)} (${personByKey(plan.by).job_title})`;
    const send = async (slot, section, entry) => {
      if (made.entries[slot]) return;
      const fields = procoreFields(section, entry, { date });
      const r = await ctx.call("POST", `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}`, { body: { [SECTIONS[section].root]: fields } });
      if (r.status === 403 || r.status === 404) throw new Stop(`Procore answered ${r.status} for the Daily Log: turn the Daily Log tool on for this project.`);
      if (!r.ok || !r.json?.id) throw new Stop(`${SECTIONS[section].label}: ${said(r)}`);
      made.entries[slot] = { section, id: String(r.json.id) };
    };
    for (const [i, [co, workers, hours]] of d.manpower.entries()) {
      const vendorId = ctx.vendorId(co, t.project);
      if (!vendorId) throw new Stop(`Run "${COMPANIES[co].name} on ${t.project}" first.`);
      await send(`manpower:${i}`, "manpower", { company: Number(vendorId), workers, hours, location: null, trade: "", comment: "" });
    }
    if (d.delay) {
      const type = made.entries.delay ? null : await delayType(ctx, projectId, d.delay.kind);
      if (!made.entries.delay && !type) note(`No matching delay type in this project; the delay is logged without one ("${d.delay.text}").`);
      await send("delay", "delays", { type: type ? delayTypeKey(type.translation_key ?? delayTypeName(type)) : "", start: d.delay.start, end: d.delay.end, company: null, location: null, comment: d.delay.text });
    }
    if (d.delivery) await send("delivery", "deliveries", { what: d.delivery.what, time: d.delivery.time, from: d.delivery.from, comment: "" });
    await send("notes", "notes", { text: `${d.note} Weather: ${d.weather}. Logged by ${by}. SiteSnap demo data ${SEED_TAG}`, location: null });
    return "done";
  },

  template: (ctx, t, made, note) => runTemplate(ctx, t.template, made, note),
  inspection: (ctx, t, made, note) => runInspection(ctx, INSPECTIONS.find((i) => i.id === t.inspection), made, note),
  message: (ctx, t, made, note) => runMessage(ctx, MESSAGES.find((m) => m.id === t.message), made, note),
};

// Which of the required tools are on (Procore's permission manifest lists only the tools on for the project)
async function toolsCheck(ctx, made, note) {
  note(`Procore project ${made.projectId}${made.created ? " (made by this page)" : ""}.`);
  const r = await ctx.call("GET", "/rest/v1.0/settings/permissions", { query: { project_id: made.projectId } });
  if (!r.ok) { made.toolsOff = null; note(`Couldn't read which tools are on (${said(r)}).`); return "done"; }
  const on = new Set((r.json?.tools ?? []).map((x) => lower(x.name)));
  made.toolsOff = Object.entries(REQUIRED_TOOLS).filter(([k]) => !on.has(k)).map(([, label]) => label);
  if (made.toolsOff.length) note(`Tools off: ${made.toolsOff.join(", ")}. Turn them on in Procore (the project's Admin tool, Active Tools); nothing else runs in this project until then.`);
  return made.toolsOff.length ? "partial" : "done";
}

async function delayType(ctx, projectId, kind) {
  for (const path of delayTypePaths(ctx.companyId, projectId)) {
    const r = await ctx.call("GET", path, { query: { project_id: projectId } });
    if (!r.ok || !Array.isArray(r.json)) continue;
    const types = r.json.filter((x) => x && x.visible !== false);
    for (const w of DELAY_KIND_WORDS[kind] ?? []) { const hit = types.find((x) => lower(delayTypeName(x)).includes(w)); if (hit) return hit; }
    return null;
  }
  return null;
}

// ---------- Observations and Punch Items ----------

function descriptionFor(rec, reporter, extra = []) {
  const parts = [`<p>${esc(rec.text)}</p>`];
  for (const x of extra) parts.push(`<p>${esc(x)}</p>`);
  parts.push(`<p>Reported by ${esc(reporter)} via SiteSnap AI. SiteSnap demo data ${SEED_TAG}.</p>`);
  return parts.join("");
}

async function runRecord(ctx, rec, made, note) {
  const projectId = ctx.needProject(rec.project);
  const isObs = rec.recordType === "observation";
  const path = isObs ? "/rest/v1.0/observations/items" : "/rest/v1.1/punch_items";
  const root = isObs ? "observation" : "punch_item";
  const patch = (fields) => ctx.call("PATCH", `${readPath(rec.recordType)}/${made.procoreId}`, { body: { project_id: Number(projectId), [root]: fields } });
  made.done ??= [];
  const done = new Set(made.done);
  const mark = (s) => { done.add(s); made.done = [...done]; };

  // A record made earlier that's gone from Procore: start over
  if (made.procoreId) {
    const r = await ctx.call("GET", `${readPath(rec.recordType)}/${made.procoreId}`, { query: { project_id: projectId } });
    if (r.status === 404) { for (const k of Object.keys(made)) delete made[k]; made.done = []; done.clear(); }
  }

  if (!made.procoreId) {
    const assignees = [];
    for (const k of isObs ? rec.assignees : [rec.assignee]) {
      const w = await ctx.who(rec.project, k);
      if (w) assignees.push(Number(w.procoreUserId)); else note(`${nameOf(k)} isn't in the project's directory yet (run the people first); not assigned.`);
    }
    const reporterKey = isObs ? rec.by : rec.reviewer;
    const reporter = reporterKey === KY ? ctx.me.name : `${nameOf(reporterKey)} (${personByKey(reporterKey).job_title})`;
    const pic = rec.photo ? await uploadPhoto(ctx, projectId, rec.photo) : null;
    if (pic && !pic.ok) note(`Photo not attached: ${pic.why}.`);
    const uploadIds = pic?.ok ? [pic.uuid] : [];
    let body;
    let fallback;
    if (isObs) {
      const types = await ctx.call("GET", `/rest/v1.0/projects/${projectId}/observation_types`);
      const type = types.ok ? pickObservationType(Array.isArray(types.json) ? types.json : [], rec.typeHints) : null;
      if (!type) throw new Stop(types.ok ? "This project has no Observation types." : `Procore answered ${types.status} for Observation types: turn the Observations tool on for this project.`);
      if (lower(type.category) !== lower(rec.type) && lower(type.name) !== lower(rec.type)) note(`No "${rec.type}" type here; used "${type.name}" (${type.category ?? "no category"}).`);
      const obsFields = {
        name: rec.title, type_id: type.id, description: descriptionFor(rec, reporter, [`Type: ${rec.type} · Priority: ${rec.priority}`]),
        status: "initiated", personal: false, priority: rec.priority, due_date: addDays(dayOf(), rec.due), ...(uploadIds.length ? { upload_ids: uploadIds } : {}),
      };
      body = { project_id: Number(projectId), observation: { ...obsFields, ...(assignees.length ? { assignee_ids: assignees } : {}) } };
      // Procore may refuse "Urgent" or an assignee: try High, then without assignees (patched in after)
      fallback = [
        { project_id: Number(projectId), observation: { ...body.observation, priority: rec.priority === "Urgent" ? "High" : rec.priority } },
        { project_id: Number(projectId), observation: { ...obsFields, priority: rec.priority === "Urgent" ? "High" : rec.priority } },
      ];
    } else {
      const reviewer = await ctx.who(rec.project, rec.reviewer);
      const tradeId = ctx.rows.trades?.made?.ids?.[rec.trade] ?? null;
      const base = {
        name: rec.title, description: descriptionFor(rec, reporter, [`Trade: ${rec.trade} · Location: ${rec.location}${reviewer ? ` · Reviewer: ${reviewer.name}` : ""}`]),
        private: false, reference: `SiteSnap demo seed ${rec.id}`, ...(uploadIds.length ? { upload_ids: uploadIds } : {}),
      };
      const full = { ...base, ...(assignees.length ? { login_information_ids: assignees } : {}), ...(reviewer ? { punch_item_manager_id: Number(reviewer.procoreUserId), final_approver_id: Number(reviewer.procoreUserId) } : {}), ...(tradeId ? { trade_id: Number(tradeId) } : {}), mt_location: [rec.location] };
      body = { project_id: Number(projectId), punch_item: full };
      fallback = [
        { project_id: Number(projectId), punch_item: { ...full, mt_location: undefined, trade_id: undefined } },
        { project_id: Number(projectId), punch_item: { ...base, ...(assignees.length ? { login_information_ids: assignees } : {}) } },
        { project_id: Number(projectId), punch_item: base },
      ];
    }
    let r = await ctx.call("POST", path, { body });
    for (const [i, b] of fallback.entries()) {
      if (r.ok || ![400, 403, 422].includes(r.status)) break;
      note(`Procore refused the full record (${said(r)}); trying again with less (step ${i + 1}).`);
      r = await ctx.call("POST", path, { body: JSON.parse(JSON.stringify(b)) });
    }
    if (!r.ok || !r.json?.id) throw new Stop(`Couldn't create it. ${said(r)}`);
    made.procoreId = String(r.json.id);
    made.number = String((isObs ? r.json.number : r.json.position) ?? "") || null;
    made.url = recordUrl(ctx.cfg.apiUrl, projectId, rec.recordType, made.procoreId);
    made.createdStatus = isObs ? r.json.status ?? "initiated" : r.json.workflow_status ?? r.json.status ?? null;
    mark("create");
  }

  // Assignees that didn't go with the record (a fallback create, or Procore dropped them)
  if (!done.has("assign")) {
    const want = [];
    for (const k of isObs ? rec.assignees : [rec.assignee]) { const w = await ctx.who(rec.project, k); if (w) want.push(Number(w.procoreUserId)); }
    const cur = await ctx.call("GET", `${readPath(rec.recordType)}/${made.procoreId}`, { query: { project_id: projectId } });
    const have = isObs ? (cur.json?.assignees ?? []).map((a) => Number(a.id)) : (cur.json?.assignments ?? []).map((a) => Number(a.login_information?.id ?? a.login_information_id ?? a.assignee?.id ?? a.id));
    const missing = want.filter((a) => !have.includes(a));
    if (missing.length) {
      const p = await patch(isObs ? { assignee_ids: want } : { login_information_ids: want });
      if (!p.ok) note(`Couldn't assign: ${said(p)}`);
    }
    if (want.length) mark("assign");
  }

  // Comments (OBS-04's thread)
  if (rec.comments && !done.has("comments")) {
    made.comments ??= 0;
    for (const [k, words] of rec.comments.slice(made.comments)) {
      const text = `${nameOf(k)}: ${words}`;
      const r = await ctx.call("POST", `/rest/v1.0/observations/items/${made.procoreId}/response_logs`, { body: { project_id: Number(projectId), response_log: { comment: text }, status: "initiated" } });
      if (!r.ok) { note(`Comment refused: ${said(r)}`); break; }
      made.comments++;
    }
    if (made.comments >= rec.comments.length) mark("comments");
  }

  // The planned status
  if (!done.has("status")) {
    const ok = await setStatus(ctx, rec, projectId, made, note);
    if (ok) mark("status");
  }
  return ["create", "assign", "status", ...(rec.comments ? ["comments"] : [])].every((s) => done.has(s)) ? "done" : "partial";
}

async function uploadPhoto(ctx, projectId, key) {
  const b64 = SEED_PHOTOS[key];
  if (!b64) return { ok: false, why: "no photo built" };
  await waitTurn();
  const u = await uploadFile(ctx.req, ctx.res, ctx.cfg, { companyId: ctx.companyId, projectId, name: `${key}.jpg`, type: "image/jpeg", bytes: Buffer.from(b64, "base64") });
  if (u.status === 429) throw new Stop("Procore said slow down (429).", true);
  return u.ok ? { ok: true, uuid: u.uuid } : { ok: false, why: `${u.step}: Procore answered ${u.status}` };
}

/** Moves a record to its planned status (also used by Restore starting statuses). True when it's there. */
export async function setStatus(ctx, rec, projectId, made, note) {
  const isObs = rec.recordType === "observation";
  const cur = await ctx.call("GET", `${readPath(rec.recordType)}/${made.procoreId}`, { query: { project_id: projectId } });
  if (!cur.ok) { note(`Couldn't read it back: ${said(cur)}`); return false; }
  const now = isObs ? lower(cur.json?.status) : lower(cur.json?.status) === "closed" ? "closed" : lower(cur.json?.workflow_status) || "open";
  const want = rec.status;
  // "Open" punch items: whatever Procore gave the new record (draft / initiated / work required), as long as it isn't closed
  const there = want === "open" ? now !== "closed" && (now === made.createdStatus || !["work_required", "ready_for_review", "ready_to_close"].includes(now)) : now === want;
  if (there) return true;
  const patch = (fields) => ctx.call("PATCH", `${readPath(rec.recordType)}/${made.procoreId}`, { body: { project_id: Number(projectId), [isObs ? "observation" : "punch_item"]: fields } });
  let r;
  if (isObs) {
    if (want === "closed") {
      r = await ctx.call("POST", `/rest/v1.0/observations/items/${made.procoreId}/response_logs`, { body: { project_id: Number(projectId), response_log: { comment: rec.closing ?? "Closed." }, status: "closed" } });
      if (!r.ok) r = await patch({ status: "closed" });
    } else r = await patch({ status: want });
  } else if (want === "closed") {
    await ctx.call("POST", `/rest/v1.0/punch_items/${made.procoreId}/comments`, { query: { project_id: projectId }, body: { comment: { body: rec.closing ?? "Closed." } } });
    r = await patch({ status: "closed" });
  } else if (want === "open") {
    r = await patch({ status: "open", ...(made.createdStatus && made.createdStatus !== "closed" ? { workflow_status: made.createdStatus } : {}) });
  } else {
    r = await patch({ ...(now === "closed" ? { status: "open" } : {}), workflow_status: want });
  }
  if (!r.ok) note(`Couldn't set it to ${want.replace(/_/g, " ")}: ${said(r)}`);
  return r.ok;
}

// ---------- inspections ----------

// Questions in a template or inspection (Procore's show answers nest them under sections)
const itemCount = (json) => (json?.sections ?? []).reduce((n, s) => n + (Array.isArray(s.items) ? s.items.length : 0), 0);

async function runTemplate(ctx, key, made, note) {
  const tpl = INSPECTION_TEMPLATES[key];
  const base = `/rest/v1.0/companies/${ctx.companyId}/checklist/list_templates`;
  if (!made.templateId) {
    const list = (await pages(ctx.req, ctx.res, ctx.cfg, base, { companyId: ctx.companyId, retry429: false })) ?? null;
    if (list === null) throw new Stop("Procore didn't let us read the company's inspection templates (403/404). Check the company Inspections tool and your permission on it.");
    const hit = list.find((x) => lower(x.name) === lower(tpl.name));
    if (hit) made.templateId = String(hit.id);
    else {
      const r = await ctx.call("POST", base, { body: { list_template: { name: tpl.name, description: "SiteSnap demo seed. Pass / Fail / N/A for every question." } } });
      if (!r.ok || !r.json?.id) throw new Stop(`Couldn't make the template. ${said(r)}`);
      made.templateId = String(r.json.id);
    }
  }
  const show = async () => ctx.call("GET", `${base}/${made.templateId}`);
  let s = await show();
  if (itemCount(s.json) >= tpl.items.length) { made.items = itemCount(s.json); return "done"; }
  // A section with its questions in one call; then, if the questions didn't come along, the item paths in turn
  let section = (s.json?.sections ?? [])[0];
  if (!section) {
    const r = await ctx.call("POST", `${base}/${made.templateId}/sections`, { body: { section: { name: tpl.section, position: 1, items_attributes: tpl.items.map((name, i) => ({ name, position: i + 1 })) } } });
    note(`Section: ${brief(r)}`);
    if (!r.ok) throw new Stop(`Couldn't add the section. ${said(r)}`);
    section = r.json;
    s = await show();
    if (itemCount(s.json) >= tpl.items.length) { made.items = itemCount(s.json); made.itemPath = "items_attributes"; return "done"; }
  }
  const have = (s.json?.sections ?? []).flatMap((x) => x.items ?? []).map((i) => lower(i.name));
  const candidates = [
    [`${base}/${made.templateId}/sections/${section.id}/items`, (name, i) => ({ item: { name, position: i + 1 } })],
    [`${base}/${made.templateId}/items`, (name, i) => ({ item: { name, position: i + 1, section_id: Number(section.id) } })],
    [`${base}/${made.templateId}/item_templates`, (name, i) => ({ item_template: { name, position: i + 1, section_id: Number(section.id) } })],
  ];
  const order = made.itemPath ? candidates.filter(([p]) => p === made.itemPath) : candidates;
  for (const [i, name] of tpl.items.entries()) {
    if (have.includes(lower(name))) continue;
    let ok = false;
    for (const [p, b] of order) {
      const r = await ctx.call("POST", p, { body: b(name, i) });
      if (r.ok) { made.itemPath = p; ok = true; break; }
      if (!made.itemPath) note(`Item path ${p.replace(/\d{3,}/g, "…")}: ${r.status}`);
    }
    if (!ok) {
      note("Procore wouldn't add questions to the template through the API. The inspection gets them added directly instead (or add them in Procore: Company → Inspections → Templates).");
      made.items = itemCount(s.json);
      return "partial";
    }
  }
  made.items = itemCount((await show()).json);
  return "done";
}

async function runInspection(ctx, insp, made, note) {
  const projectId = ctx.needProject(insp.project);
  const tpl = INSPECTION_TEMPLATES[insp.template];
  const companyTemplateId = ctx.rows[`template:${insp.template}`]?.made?.templateId;
  if (!companyTemplateId) throw new Stop(`Run "Inspection template ${tpl.name}" first.`);
  if (made.listId) {
    const r = await ctx.call("GET", PATHS.list(made.listId), { query: { project_id: projectId } });
    if (r.status === 404) for (const k of Object.keys(made)) delete made[k];
  }
  // The project's copy of the company template (Procore keeps one per company template per project)
  if (!made.listId && !made.templateId) {
    const ptBase = `/rest/v1.0/projects/${projectId}/checklist/list_templates`;
    const list = (await pages(ctx.req, ctx.res, ctx.cfg, ptBase, { companyId: ctx.companyId, retry429: false })) ?? [];
    const hit = list.find((x) => lower(x.name) === lower(tpl.name));
    if (hit) made.templateId = String(hit.id);
    else {
      const r = await ctx.call("POST", `${ptBase}/create_from_company_template`, { body: { source_template_id: Number(companyTemplateId) } });
      note(`Project template from the company one: ${brief(r)}`);
      made.templateId = r.ok && r.json?.id ? String(r.json.id) : companyTemplateId;
    }
  }
  if (!made.listId) {
    const inspector = await ctx.who(insp.project, insp.inspector);
    if (!inspector) note(`${nameOf(insp.inspector)} isn't in the directory yet; no inspector set.`);
    const list = { name: insp.name, description: `SiteSnap demo seed ${SEED_TAG}`, due_at: `${addDays(dayOf(), insp.due)}T23:00:00Z`, personal: false, ...(inspector ? { inspector_ids: [Number(inspector.procoreUserId)] } : {}) };
    let r = await ctx.call("POST", "/rest/v1.0/checklist/lists", { body: { project_id: Number(projectId), template_id: Number(made.templateId), list } });
    if (!r.ok && made.templateId !== companyTemplateId) {
      note(`From the project template: ${said(r)}. Trying the company template.`);
      r = await ctx.call("POST", "/rest/v1.0/checklist/lists", { body: { project_id: Number(projectId), template_id: Number(companyTemplateId), list } });
    }
    if (!r.ok && list.inspector_ids) {
      note(`With the inspector: ${said(r)}. Trying without.`);
      const rest = { ...list };
      delete rest.inspector_ids;
      r = await ctx.call("POST", "/rest/v1.0/checklist/lists", { body: { project_id: Number(projectId), template_id: Number(made.templateId), list: rest } });
    }
    if (!r.ok || !r.json?.id) throw new Stop(`Couldn't create the inspection. ${said(r)}`);
    made.listId = String(r.json.id);
  }
  let read = await ctx.call("GET", PATHS.list(made.listId), { query: { project_id: projectId } });
  if (!read.ok) throw new Stop(`Couldn't read the inspection back. ${said(read)}`);
  // No questions came with the template: add them to this inspection directly
  if (itemCount(read.json) === 0) {
    const r = await ctx.call("POST", `/rest/v1.0/checklist/lists/${made.listId}/sections`, { body: { project_id: Number(projectId), section: { name: tpl.section, position: 1, not_applicable: false, items_attributes: tpl.items.map((name, i) => ({ name, position: i + 1, status: "none" })) } } });
    note(`Questions added to the inspection itself: ${brief(r)}`);
    read = await ctx.call("GET", PATHS.list(made.listId), { query: { project_id: projectId } });
  }
  const detail = inspectionDetail(read.json);
  const items = detail.sections.flatMap((s) => s.items);
  if (items.length < tpl.items.length) note(`The inspection has ${items.length} of ${tpl.items.length} questions.`);
  // The pre-seeded answers (the rest stay open for the live demo)
  made.answered ??= [];
  for (const [n, counts] of Object.entries(insp.answers)) {
    if (made.answered.includes(Number(n))) continue;
    const item = items[Number(n) - 1];
    if (!item) continue;
    const r = await ctx.call("POST", PATHS.respond(projectId, item.id), { body: responseBody(item, { counts }) });
    if (!r.ok) { note(`Answer to question ${n}: ${said(r)}`); continue; }
    made.answered.push(Number(n));
    const link = insp.failNote[n];
    if (counts === "fail" && link) {
      const recRow = ctx.rows[`record:${link}`];
      const ref = recRow?.made?.number ? `Observation #${recRow.made.number}` : link;
      const c = await ctx.call("POST", PATHS.comment(made.listId), { body: { project_id: Number(projectId), item_id: Number(item.id), comment: { body: `Failed. See ${ref}: ${recordById(link).title.replace(SEED_TAG, "").trim()}.` } } });
      if (!c.ok) note(`Note on question ${n}: ${said(c)}`);
    }
  }
  made.url = `${String(ctx.cfg.apiUrl).replace(/\/+$/, "")}/${projectId}/project/checklists/lists/${made.listId}`;
  return made.answered.length >= Object.keys(insp.answers).length && items.length >= tpl.items.length ? "done" : "partial";
}

// ---------- SiteSnap messages ----------

async function runMessage(ctx, m, made, note) {
  ctx.needProject(m.project);
  const st = await store();
  const key = ctx.key(m.project);
  const cid = `seed-${m.id}`;
  const keys = [m.from, ...recipientsOf(m), ...m.msgs.map((x) => x[0])];
  const people = {};
  for (const k of new Set(keys)) people[k] = await ctx.who(m.project, k);
  const missing = [...new Set(keys)].filter((k) => !people[k]);
  if (missing.length) throw new Stop(`Not in the project's directory yet: ${missing.map(nameOf).join(", ")}. Run the people first.`);
  const tagged = recipientsOf(m).map((k) => people[k]);
  const start = Date.now() - m.msgs[0][2] * 60_000;
  const rec = m.link ? recordById(m.link) : null;
  const recRow = rec ? ctx.rows[`record:${rec.id}`] : null;
  if (rec && !recRow?.made?.procoreId) note(`${rec.id} isn't made yet, so the thread isn't linked to it (run this again after it).`);
  const procore = rec && recRow?.made?.procoreId ? {
    recordType: rec.recordType, id: Number(recRow.made.procoreId), number: recRow.made.number ?? "", url: recRow.made.url ?? "",
    projectId: ctx.projectId(m.project), title: rec.title.slice(0, 120), due: rec.due != null ? addDays(dayOf(), rec.due) : null,
  } : null;
  if (!made.thread) {
    await st.putThread(key, cid, {
      createdBy: people[m.from], tagged, taggedIds: tagged.map((x) => x.procoreUserId), cc: [], ccIds: [],
      status: "open", createdAt: start, lastActivityAt: start, seed: true, ...(procore ? { procore } : {}),
    });
    made.thread = cid;
  }
  for (const [i, [k, text, ago]] of m.msgs.entries()) {
    const mid = `${cid}-${i + 1}`;
    if (await st.messageExists(key, cid, mid)) continue;
    const at = Date.now() - ago * 60_000;
    await st.putMessage(key, cid, mid, {
      authorId: people[k].procoreUserId, authorName: people[k].name, text, transcript: text, transcriptStatus: "done", photos: [],
      voicePath: null, voiceType: null, aiDescription: null, clientCreatedAt: at, createdAt: at,
    });
    await wait(400); // oldest first, so the message function sees them in order
  }
  made.messages = m.msgs.length;
  return "done";
}

// ---------- undo (reset and Redo) ----------

const deletePaths = (recordType, projectId, id) => (recordType === "observation"
  ? [[`/rest/v1.0/projects/${projectId}/observations/items/${id}`, {}], [`/rest/v1.0/observations/items/${id}`, { project_id: projectId }]]
  : [[`/rest/v1.1/punch_items/${id}`, { project_id: projectId }], [`/rest/v1.0/punch_items/${id}`, { project_id: projectId }]]);

// Kinds whose data reset removes (setup stays: projects, companies, people, albums, trades, templates)
export const UNDOABLE = ["message", "inspection", "photo", "dailylog", "record"];

/** What undoing a task would remove, in words (the dry run) */
export function undoPlan(t, row) {
  const m = row?.made ?? {};
  if (t.kind === "record") return m.procoreId ? [`${t.record} (Procore ${recordById(t.record).recordType === "observation" ? "Observation" : "Punch Item"} ${m.procoreId})`] : [];
  if (t.kind === "photo") return m.imageId ? [`photo ${m.imageId}`] : [];
  if (t.kind === "dailylog") return Object.values(m.entries ?? {}).map((e) => `${SECTIONS[e.section].label} entry ${e.id} (${m.date})`);
  if (t.kind === "inspection") return m.listId ? [`inspection ${m.listId}`] : [];
  if (t.kind === "message") return m.thread ? [`SiteSnap thread ${m.thread}`] : [];
  return [];
}

/** Undoes one task's data. Records are deleted only when their title still carries [DEMO]. Returns { removed, kept[] }. */
export async function undoTask(ctx, t) {
  const st = await store();
  const row = ctx.rows[t.id] ?? fresh(t.id);
  const m = row.made ?? {};
  const projectId = t.project ? ctx.projectId(t.project) : null;
  const kept = [];
  let removed = 0;
  const del = async (path, query) => { const r = await ctx.call("DELETE", path, { query }); return r.ok || r.status === 404; };
  if (t.kind === "record" && m.procoreId) {
    const rec = recordById(t.record);
    const cur = await ctx.call("GET", `${readPath(rec.recordType)}/${m.procoreId}`, { query: { project_id: projectId } });
    if (cur.ok && !isSeedTitle(cur.json?.name)) kept.push(`${t.record}: its title in Procore no longer starts with ${SEED_TAG}, so it's left alone`);
    else if (cur.ok) {
      let gone = false;
      for (const [p, q] of deletePaths(rec.recordType, projectId, m.procoreId)) if (await del(p, q)) { gone = true; break; }
      if (gone) removed++; else kept.push(`${t.record}: Procore refused the delete`);
    }
  } else if (t.kind === "photo" && m.imageId) {
    if (await del(`/rest/v1.0/images/${m.imageId}`, { project_id: projectId })) { removed++; await st.deletePhotoLink(ctx.key(t.project), m.imageId).catch(() => {}); } else kept.push(`photo ${m.imageId}: Procore refused the delete`);
  } else if (t.kind === "dailylog") {
    for (const e of Object.values(m.entries ?? {})) {
      if (await del(`/rest/v1.0/projects/${projectId}/${SECTIONS[e.section].path}/${e.id}`, {})) removed++; else kept.push(`${SECTIONS[e.section].label} ${e.id}: refused (a day marked Completed is locked)`);
    }
  } else if (t.kind === "inspection" && m.listId) {
    if (await del(PATHS.list(m.listId), { project_id: projectId }) || await del(`/rest/v1.1/projects/${projectId}/checklist/lists/${m.listId}`, {})) removed++;
    else kept.push(`inspection ${m.listId}: Procore refused the delete`);
  } else if (t.kind === "message" && m.thread) {
    await st.deleteThread(ctx.key(t.project), m.thread);
    removed++;
  }
  if (!kept.length) { const f = fresh(t.id); await st.saveRow(t.id, f); ctx.rows[t.id] = f; }
  return { removed, kept };
}

// ---------- restore starting statuses (between demos) ----------

export async function restoreStatuses(ctx) {
  const out = [];
  for (const t of tasks().filter((x) => x.kind === "record")) {
    const row = ctx.rows[t.id];
    if (!row?.made?.procoreId) continue;
    const rec = recordById(t.record);
    const notes = [];
    const ok = await setStatus(ctx, rec, ctx.projectId(rec.project), row.made, (s) => notes.push(s));
    out.push({ id: rec.id, ok, detail: ok ? `at ${rec.status.replace(/_/g, " ")}` : notes.join(" ") });
  }
  return out;
}

// ---------- Procore invites (one person at a time: each is an email) ----------

export async function invite(ctx, key) {
  const p = personByKey(key);
  const email = emailFor(p);
  if (!email) throw new HttpError(409, "no_email", "Set DEMO_SEED_EMAIL first.");
  const list = (await pages(ctx.req, ctx.res, ctx.cfg, `/rest/v1.3/companies/${ctx.companyId}/users`, { companyId: ctx.companyId, query: { "filters[search]": email }, retry429: false })) ?? [];
  const u = list.find((x) => lower(x.email_address) === lower(email));
  if (!u) return { ok: false, detail: `${fullName(p)} isn't in the company directory yet. Run the people first.` };
  const path = `/rest/v1.0/companies/${ctx.companyId}/users/${u.id}/invite`;
  let r = await ctx.call("PATCH", path, { body: {} });
  if (r.status === 404 || r.status === 405) r = await ctx.call("POST", path, { body: {} });
  return { ok: r.ok, detail: r.ok ? `invite sent to ${email}` : said(r) };
}
