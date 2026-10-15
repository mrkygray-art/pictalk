// The Demo staging page's work (api/procore/demo-staging.js): import demo scenarios into Procore in small
// batches that resume, reset the demo projects, and the delete check. Every Procore call is paced
// (api/_seedSteps.js) and a 429 stops the batch instead of retrying.
// SiteSnap's own copy: Firestore, server only (no client rule matches it), written with firebase-admin:
//   sitesnapDemo/state                    { lastImportAt, deleteCheck }
//   sitesnapDemo/state/scenarios/{ID}     { import_status, procore_id, record_type, number, url, project_code,
//                                           project_id, steps_completed[], last_error, last_attempt_at, manual }
// The rows are the seed manifest: which Procore record each scenario made. Threads the import writes:
//   procoreProjects/{c}_{p}/conversations/demo-{id}  (demo: true, demoScenario) and its messages demo-{id}-{n}.
// Procore endpoints (reference via developers.procore.com, checked 2026-10-15; the delete and comment ones
// against a mirror of it, so the Delete check button confirms them in the sandbox):
//   POST /rest/v1.0/observations/items, PATCH /rest/v1.0/observations/items/{id}, GET …/{id}?project_id=
//   POST /rest/v1.0/observations/items/{id}/response_logs {project_id, response_log: {comment}, status}
//   DELETE /rest/v1.0/projects/{p}/observations/items/{id}   (to the recycle bin; 204)
//   POST /rest/v1.1/punch_items, PATCH /rest/v1.1/punch_items/{id}, DELETE /rest/v1.1/punch_items/{id}?project_id=
//   POST /rest/v1.0/punch_items/{id}/comments?project_id= {comment: {body}}
//   GET /rest/v1.0/observations/items?project_id=, GET /rest/v1.1/punch_items?project_id=  (lists, for reset)
import { HttpError } from "./_procore.js";
import { uploadFile } from "./_procoreWrite.js";
import { firestore } from "./_firestore.js";
import { observationBody, punchBody, recordUrl } from "./_records.js";
import { readPath } from "./_recordStatus.js";
import { api, lower, pages, waitTurn } from "./_seedSteps.js";
import {
  SCENARIOS, archivedTitle, cardFor, fullName, isArchivedTitle, isDemoTitle, personByKey, pickObservationType,
  scenarioById, statusFrom, stepError, stepsFor, DEMO_COMPANIES,
} from "./_demoScenarios.js";
import { DEMO_PHOTOS } from "./_demoPhotos.js";

const DAY = 24 * 60 * 60 * 1000;
export const cidFor = (id) => `demo-${id.toLowerCase()}`;
export const procoreError = (r) => {
  const e = r.json?.errors ?? r.json?.message ?? r.json?.error;
  if (!e) return `Procore answered ${r.status}.`;
  return typeof e === "string" ? e : Object.entries(e).map(([k, v]) => `${k} ${[].concat(v).join(", ")}`).join("; ");
};

// ---------- the store (Firestore; tests replace it with setDemoStore) ----------

let demoStore = null;
export const setDemoStore = (s) => { demoStore = s; };

export async function store() {
  if (demoStore) return demoStore;
  const db = await firestore();
  const rowsCol = () => db.collection("sitesnapDemo/state/scenarios");
  const conv = (key, cid) => db.doc(`procoreProjects/${key}/conversations/${cid}`);
  return {
    async rows() { return Object.fromEntries((await rowsCol().get()).docs.map((d) => [d.id, d.data()])); },
    async saveRow(id, row) { await rowsCol().doc(id).set(row); },
    async meta() { return (await db.doc("sitesnapDemo/state").get()).data() ?? {}; },
    async saveMeta(patch) { await db.doc("sitesnapDemo/state").set(patch, { merge: true }); },
    async threadExists(key, cid) { return (await conv(key, cid).get()).exists; },
    async putThread(key, cid, data) { await conv(key, cid).set(data); },
    async messageExists(key, cid, mid) { return (await conv(key, cid).collection("messages").doc(mid).get()).exists; },
    async putMessage(key, cid, mid, data) { await conv(key, cid).collection("messages").doc(mid).set(data); },
    // Threads to clear: the import's own (demo: true) and any that follow one of these Procore records
    async threadsFor(key, procoreIds) {
      const col = db.collection(`procoreProjects/${key}/conversations`);
      const cids = new Set((await col.where("demo", "==", true).get()).docs.map((d) => d.id));
      const ids = [...new Set(procoreIds.map(Number).filter(Boolean))];
      for (let i = 0; i < ids.length; i += 30) {
        for (const d of (await col.where("procore.id", "in", ids.slice(i, i + 30)).get()).docs) cids.add(d.id);
      }
      return [...cids];
    },
    // A thread, its messages, and everyone's read marks for it
    async deleteThread(key, cid) {
      const ref = conv(key, cid);
      const batchDelete = async (refs) => { for (let i = 0; i < refs.length; i += 400) { const b = db.batch(); refs.slice(i, i + 400).forEach((r) => b.delete(r)); await b.commit(); } };
      await batchDelete((await ref.collection("messages").get()).docs.map((d) => d.ref));
      const members = (await db.collection(`procoreProjects/${key}/members`).get()).docs;
      await batchDelete(members.map((m) => m.ref.collection("reads").doc(cid)));
      await ref.delete();
    },
  };
}

/** Every scenario's row (the ones never imported get a fresh "not imported" row, saved: SiteSnap's copy first) */
export async function allRows(st, projects) {
  const saved = await st.rows();
  const out = [];
  for (const s of SCENARIOS) {
    let row = saved[s.id];
    if (!row) {
      row = { id: s.id, import_status: "not_imported", procore_id: null, steps_completed: [], last_error: null, last_attempt_at: null };
      await st.saveRow(s.id, row);
    }
    out.push({ ...row, id: s.id, project_code: s.project, project_id: projects?.[s.project] ?? row.project_id ?? null, import_status: statusFrom(s, row) });
  }
  return out;
}

// ---------- one project's context (looked up once per request) ----------

class StepFailed extends Error {
  constructor(step, message, rateLimited = false) { super(message); this.step = step; this.rateLimited = rateLimited; }
}

export async function projectContext(req, res, cfg, { companyId, projectId, me }) {
  const users = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId, retry429: false })) ?? [];
  const types = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/observation_types`, { companyId, retry429: false });
  if (types.status === 429) throw new HttpError(429, "rate_limited", "429 rate limited, retry later.");
  const vendorName = (u) => u.vendor?.name ?? "";
  return {
    req, res, cfg, companyId, projectId, me, key: `${companyId}_${projectId}`,
    usersByEmail: new Map(users.map((u) => [lower(u.email_address), u])),
    observationTypes: types.ok && Array.isArray(types.json) ? types.json : [],
    observationTypesStatus: types.status,
    personOf(key) {
      const p = personByKey(key);
      const u = p && this.usersByEmail.get(lower(p.email_address));
      return u ? { procoreUserId: String(u.id), name: fullName(p), company: vendorName(u) || DEMO_COMPANIES[p.company].name, title: p.job_title } : null;
    },
  };
}

// ---------- importing one scenario (resumes: only the steps not done yet) ----------

export async function importScenario(ctx, s, row) {
  const { req, res, cfg, companyId, projectId } = ctx;
  const done = new Set(row.steps_completed ?? []);
  let procoreIdNow = row.procore_id ?? null;
  let number = row.number ?? null;
  const errors = [];
  const isObs = s.recordType === "observation";
  const call = async (step, method, path, opts = {}) => {
    const r = await api(req, res, cfg, method, path, { companyId, retry429: false, ...opts });
    if (r.status === 429) throw new StepFailed(step, "429 rate limited, retry later", true);
    if (r.status === 401) throw new HttpError(401, "not_connected", "Your Procore sign-in ran out. Sign in with Procore again.");
    return r;
  };
  const save = async () => {
    const next = { ...row, id: s.id, record_type: s.recordType, project_code: s.project, project_id: projectId, procore_id: procoreIdNow, number,
      url: procoreIdNow ? recordUrl(cfg.apiUrl, projectId, s.recordType, procoreIdNow) : null,
      steps_completed: stepsFor(s).filter((x) => done.has(x)), last_error: errors[0] ?? null, last_attempt_at: Date.now() };
    next.import_status = statusFrom(s, next);
    await (await store()).saveRow(s.id, next);
    return next;
  };
  const photo = async () => {
    const b64 = DEMO_PHOTOS[s.id];
    if (!b64) return { ok: false, why: "no photo for this scenario" };
    await waitTurn();
    const u = await uploadFile(req, res, cfg, { companyId, projectId, name: `${s.id}.jpg`, type: "image/jpeg", bytes: Buffer.from(b64, "base64") });
    if (u.status === 429) throw new StepFailed("photo", "429 rate limited, retry later", true);
    return u.ok ? { ok: true, uuid: u.uuid } : { ok: false, why: `${u.step}: Procore answered ${u.status}` };
  };
  const assignee = () => {
    const p = personByKey(s.assignee);
    const who = ctx.personOf(s.assignee);
    return who ? { id: Number(who.procoreUserId) } : { why: `could not assign ${fullName(p)} (not in the project directory; run Add Demo People first)` };
  };
  const patch = (fields) => call("assignee", "PATCH", `${readPath(s.recordType)}/${procoreIdNow}`, { body: { project_id: Number(projectId), [isObs ? "observation" : "punch_item"]: fields } });

  try {
    // A record made earlier that's gone from Procore: start over
    if (procoreIdNow) {
      const r = await call("create", "GET", `${readPath(s.recordType)}/${procoreIdNow}`, { query: { project_id: projectId } });
      if (r.status === 404) { procoreIdNow = null; number = null; done.clear(); }
    }

    // 1. Create (with the photo and the assignee when they work)
    if (!procoreIdNow) {
      const type = isObs ? pickObservationType(ctx.observationTypes, s.typeHints) : null;
      if (isObs && !type) throw new StepFailed("create", ctx.observationTypesStatus === 200
        ? "this project has no Observation types in Procore"
        : `Procore answered ${ctx.observationTypesStatus} for Observation types: the Observations tool is probably off in this project (Procore: the project's Admin tool, Active Tools, turn on Observations and Punch List)`);
      const pic = await photo();
      const a = assignee();
      const speaker = personByKey(s.speaker);
      const card = cardFor(s, { observationTypeId: type?.id ?? null, assigneeIds: a.id ? [a.id] : [] });
      const build = (c) => (isObs ? observationBody : punchBody)(c, projectId, { reporterName: `${fullName(speaker)} (demo)`, uploadIds: pic.ok ? [pic.uuid] : [] });
      const path = isObs ? "/rest/v1.0/observations/items" : "/rest/v1.1/punch_items";
      let made = await call("create", "POST", path, { body: build(card) });
      let assignWhy = a.why ?? null;
      if (!made.ok && a.id && [403, 422].includes(made.status)) {
        assignWhy = `Procore wouldn't take ${fullName(personByKey(s.assignee))} as the assignee (${procoreError(made)})`;
        made = await call("create", "POST", path, { body: build({ ...card, assigneeIds: [] }) });
      }
      if (!made.ok || !made.json?.id) throw new StepFailed("create", procoreError(made));
      procoreIdNow = String(made.json.id);
      number = String((isObs ? made.json.number : made.json.position) ?? "") || null;
      done.add("create");
      if (pic.ok) done.add("photo"); else errors.push(stepError(s, "photo", pic.why));
      if (!assignWhy) done.add("assignee"); else errors.push(stepError(s, "assignee", assignWhy));
      await save();
    }

    // 2. Photo, when it didn't go with the record
    if (!done.has("photo") && errors.every((e) => !e.includes("(attach the photo)"))) {
      const pic = await photo();
      const r = pic.ok ? await call("photo", "PATCH", `${readPath(s.recordType)}/${procoreIdNow}`, { body: { project_id: Number(projectId), [isObs ? "observation" : "punch_item"]: { upload_ids: [pic.uuid] } } }) : null;
      if (r?.ok) done.add("photo"); else errors.push(stepError(s, "photo", r ? procoreError(r) : pic.why));
    }

    // 3. Assignee, when it didn't go with the record
    if (!done.has("assignee") && errors.every((e) => !e.includes("(assign)"))) {
      const a = assignee();
      const r = a.id ? await patch(isObs ? { assignee_ids: [a.id] } : { login_information_ids: [a.id] }) : null;
      if (r?.ok) done.add("assignee"); else errors.push(stepError(s, "assignee", r ? procoreError(r) : a.why));
    }

    // 4. Close, with the closing comment (Observations: a response that closes it; Punch Items: a comment, then closed)
    if (s.planned === "closed" && !done.has("close")) {
      let ok;
      if (isObs) {
        const r = await call("close", "POST", `/rest/v1.0/observations/items/${procoreIdNow}/response_logs`, { body: { project_id: Number(projectId), response_log: { comment: s.closingComment }, status: "closed" } });
        ok = r.ok || (await call("close", "PATCH", `/rest/v1.0/observations/items/${procoreIdNow}`, { body: { project_id: Number(projectId), observation: { status: "closed" } } })).ok;
      } else {
        await call("close", "POST", `/rest/v1.0/punch_items/${procoreIdNow}/comments`, { query: { project_id: projectId }, body: { comment: { body: s.closingComment } } });
        const r = await call("close", "PATCH", `/rest/v1.1/punch_items/${procoreIdNow}`, { body: { project_id: Number(projectId), punch_item: { status: "closed" } } });
        ok = r.ok;
        if (!ok) errors.push(stepError(s, "close", procoreError(r)));
      }
      if (ok) done.add("close"); else if (isObs) errors.push(stepError(s, "close", "Procore refused both the closing response and the status change"));
    }

    // 5. SiteSnap's thread for it, so the app shows the same thing
    if (!done.has("thread")) {
      await writeThread(ctx, s, { procoreId: procoreIdNow, number });
      done.add("thread");
    }
  } catch (err) {
    if (!(err instanceof StepFailed)) throw err;
    errors.unshift(err.rateLimited ? `429 rate limited, retry later (stopped at: ${err.step})` : stepError(s, err.step, err.message));
    const saved = await save();
    return { row: saved, rateLimited: err.rateLimited };
  }
  return { row: await save(), rateLimited: false };
}

// The thread a foreman's capture would have started: createdBy the speaker, everyone tagged, the record linked,
// the words as said. Closed ones also get the closing comment and a "Closed" line. Backdated to match the story.
export async function writeThread(ctx, s, { procoreId, number }) {
  const st = await store();
  const cid = cidFor(s.id);
  const now = Date.now();
  const closedAt = s.planned === "closed" ? now - (s.closedDaysAgo ?? 0) * DAY : null;
  const createdAt = closedAt ? closedAt - DAY : s.planned === "overdue" ? now + (s.due - 2) * DAY : now - 2 * 60 * 60 * 1000;
  const me = { procoreUserId: String(ctx.me.id), name: ctx.me.name, company: "", title: "" };
  const speaker = ctx.personOf(s.speaker) ?? me;
  const tagged = s.tagged.map((k) => ctx.personOf(k)).filter(Boolean);
  const card = cardFor(s);
  if (!(await st.threadExists(ctx.key, cid))) {
    const closer = ctx.personOf(s.assignee) ?? me;
    await st.putThread(ctx.key, cid, {
      createdBy: speaker, tagged, taggedIds: tagged.map((t) => t.procoreUserId),
      status: closedAt ? "closed" : "open", createdAt, lastActivityAt: closedAt ?? createdAt,
      procore: { recordType: s.recordType, id: Number(procoreId), number: number ?? "", url: recordUrl(ctx.cfg.apiUrl, ctx.projectId, s.recordType, procoreId), projectId: ctx.projectId, title: s.title.slice(0, 120), due: card.dueDate },
      demo: true, demoScenario: s.id,
      ...(closedAt ? { statusBy: closer.procoreUserId, statusAt: closedAt, procoreStatus: { value: "closed", label: "Closed", closed: true, at: closedAt } } : {}),
    });
  }
  const msg = (author, extra, at) => ({
    authorId: author.procoreUserId, authorName: author.name, text: "", transcript: "", transcriptStatus: "none", photos: [],
    voicePath: null, voiceType: null, aiDescription: null, clientCreatedAt: at, createdAt: at, ...extra,
  });
  const messages = [[`${cid}-1`, msg(speaker, { text: card.description, transcript: s.words, transcriptStatus: "done" }, createdAt)]];
  if (closedAt) {
    const closer = ctx.personOf(s.assignee) ?? me;
    messages.push([`${cid}-2`, msg(closer, { text: s.closingComment, status: { code: "done", label: "Marked done" } }, closedAt - 60_000)]);
    messages.push([`${cid}-3`, msg(closer, { event: "closed" }, closedAt)]);
  }
  for (const [mid, data] of messages) if (!(await st.messageExists(ctx.key, cid, mid))) await st.putMessage(ctx.key, cid, mid, data);
}

// ---------- reset (one project at a time) ----------

const deletePaths = (recordType, projectId, id) => (recordType === "observation"
  ? [[`/rest/v1.0/projects/${projectId}/observations/items/${id}`, {}], [`/rest/v1.0/observations/items/${id}`, { project_id: projectId }]]
  : [[`/rest/v1.1/punch_items/${id}`, { project_id: projectId }], [`/rest/v1.0/punch_items/${id}`, { project_id: projectId }]]);

/** Tagged records in this project: from Procore's lists, plus the rows' records (manifest) */
export async function findDemoRecords(req, res, cfg, { companyId, projectId, code, rows }) {
  const list = async (recordType, path) => ((await pages(req, res, cfg, path, { companyId, query: { project_id: projectId }, retry429: false })) ?? [])
    .map((r) => ({ recordType, id: String(r.id), name: r.name ?? r.title ?? "", status: r.status }));
  const found = [...await list("observation", "/rest/v1.0/observations/items"), ...await list("punch_item", "/rest/v1.1/punch_items")];
  const out = [];
  const skipped = [];
  for (const r of found) if (isDemoTitle(r.name)) out.push({ ...r, source: "title" });
  for (const row of rows.filter((x) => x.project_code === code && x.procore_id)) {
    if (out.some((r) => r.id === String(row.procore_id) && r.recordType === row.record_type)) { out.find((r) => r.id === String(row.procore_id)).source = "manifest and title"; continue; }
    const hit = found.find((r) => r.id === String(row.procore_id) && r.recordType === row.record_type);
    if (hit) skipped.push({ ...hit, why: "in the manifest but its title isn't tagged [SS-DEMO], so reset leaves it alone" });
  }
  return { records: out, skipped };
}

export async function resetProject(req, res, cfg, { companyId, projectId, code, dryRun }) {
  const st = await store();
  const rows = Object.values(await st.rows());
  const { records, skipped } = await findDemoRecords(req, res, cfg, { companyId, projectId, code, rows });
  const key = `${companyId}_${projectId}`;
  if (dryRun) {
    const threads = await st.threadsFor(key, records.map((r) => r.id));
    return { dryRun: true, records, skipped, threads: threads.length };
  }
  const result = { deleted: [], archived: [], failed: [], skipped, rateLimited: false };
  const call = (method, path, opts) => api(req, res, cfg, method, path, { companyId, retry429: false, ...opts });
  for (const r of records) {
    let gone = false;
    let last = null;
    for (const [path, query] of deletePaths(r.recordType, projectId, r.id)) {
      last = await call("DELETE", path, { query });
      if (last.status === 429) break;
      if (last.ok) { gone = true; break; }
    }
    if (last?.status === 429) { result.rateLimited = true; break; }
    if (gone) { result.deleted.push(r); continue; }
    if (isArchivedTitle(r.name)) { result.archived.push({ ...r, why: "already archived" }); continue; }
    // Procore won't delete it: close it and rename it out of the way
    const isObs = r.recordType === "observation";
    const fields = { name: archivedTitle(r.name), status: "closed" };
    const a = await call("PATCH", `${readPath(r.recordType)}/${r.id}`, { body: { project_id: Number(projectId), [isObs ? "observation" : "punch_item"]: fields } });
    if (a.status === 429) { result.rateLimited = true; break; }
    if (a.ok) result.archived.push({ ...r, why: `delete refused (${last?.status}); closed and renamed` });
    else result.failed.push({ ...r, why: `delete refused (${last?.status}), archive refused: ${procoreError(a)}` });
  }
  // SiteSnap's side: threads for what's gone or archived, and the rows go back to "not imported"
  const cleared = [...result.deleted, ...result.archived].map((r) => r.id);
  const threads = await st.threadsFor(key, cleared);
  for (const cid of threads) await st.deleteThread(key, cid);
  if (!result.rateLimited && !result.failed.length) {
    for (const s of SCENARIOS.filter((x) => x.project === code)) {
      await st.saveRow(s.id, { id: s.id, import_status: "not_imported", procore_id: null, steps_completed: [], last_error: null, last_attempt_at: null });
    }
  } else {
    for (const row of rows.filter((x) => x.project_code === code && cleared.includes(String(x.procore_id)))) {
      await st.saveRow(row.id, { id: row.id, import_status: "not_imported", procore_id: null, steps_completed: [], last_error: null, last_attempt_at: null });
    }
  }
  return { ...result, threads: threads.length };
}

/** Re-import one scenario: remove its old record (same rules as reset: tagged, this project), then import fresh */
export async function removeOne(req, res, cfg, { companyId, projectId, row }) {
  const s = scenarioById(row.id);
  if (!row.procore_id) return { removed: false };
  const call = (method, path, opts) => api(req, res, cfg, method, path, { companyId, retry429: false, ...opts });
  const now = await call("GET", `${readPath(s.recordType)}/${row.procore_id}`, { query: { project_id: projectId } });
  if (now.status === 429) throw new HttpError(429, "rate_limited", "429 rate limited, retry later.");
  if (now.ok && !isDemoTitle(now.json?.name)) throw new HttpError(409, "not_tagged", `Procore record ${row.procore_id} isn't tagged [SS-DEMO], so it's left alone. Rename it in Procore or mark another id.`);
  let how = "gone already";
  if (now.ok) {
    how = null;
    for (const [path, query] of deletePaths(s.recordType, projectId, row.procore_id)) {
      const r = await call("DELETE", path, { query });
      if (r.ok) { how = "deleted"; break; }
    }
    if (!how) {
      const isObs = s.recordType === "observation";
      const a = await call("PATCH", `${readPath(s.recordType)}/${row.procore_id}`, { body: { project_id: Number(projectId), [isObs ? "observation" : "punch_item"]: { name: archivedTitle(now.json?.name), status: "closed" } } });
      if (!a.ok) throw new HttpError(422, "not_removed", `Couldn't delete or archive Procore record ${row.procore_id}: ${procoreError(a)}`);
      how = "archived";
    }
  }
  const st = await store();
  const key = `${companyId}_${projectId}`;
  for (const cid of await st.threadsFor(key, [row.procore_id])) await st.deleteThread(key, cid);
  await st.deleteThread(key, cidFor(s.id));
  return { removed: true, how };
}

// ---------- the delete check (the spec's 15-minute spike) ----------

export async function deleteCheck(req, res, cfg, { companyId, projectId }) {
  const steps = [];
  const call = (method, path, opts) => api(req, res, cfg, method, path, { companyId, ...opts });
  const note = (name, r, extra = "") => { steps.push({ name, ok: r.ok, detail: `${r.ok ? `ok (${r.status})` : `Procore answered ${r.status}: ${procoreError(r)}`}${extra}` }); return r; };
  const types = await call("GET", `/rest/v1.0/projects/${projectId}/observation_types`, {});
  const type = pickObservationType(Array.isArray(types.json) ? types.json : []);
  const made = {};
  if (type) {
    const o = note("Create test Observation", await call("POST", "/rest/v1.0/observations/items", { body: { project_id: Number(projectId), observation: { name: "[SS-DEMO] Delete check observation", type_id: type.id, status: "initiated", personal: false } } }));
    if (o.ok) made.observation = String(o.json.id);
  } else steps.push({ name: "Create test Observation", ok: false, detail: "this project has no Observation types" });
  const p = note("Create test Punch Item", await call("POST", "/rest/v1.1/punch_items", { body: { project_id: Number(projectId), punch_item: { name: "[SS-DEMO] Delete check punch item", private: false } } }));
  if (p.ok) made.punch_item = String(p.json.id);

  for (const [recordType, id] of Object.entries(made)) {
    const isObs = recordType === "observation";
    const label = isObs ? "Observation" : "Punch Item";
    const item = isObs ? "observation" : "punch_item";
    note(`${label}: close`, await call("PATCH", `${readPath(recordType)}/${id}`, { body: { project_id: Number(projectId), [item]: { status: "closed" } } }));
    note(`${label}: rename after closing`, await call("PATCH", `${readPath(recordType)}/${id}`, { body: { project_id: Number(projectId), [item]: { name: `[SS-DEMO] Delete check ${isObs ? "observation" : "punch item"} (renamed after close)` } } }));
    note(`${label}: change due date after closing`, await call("PATCH", `${readPath(recordType)}/${id}`, { body: { project_id: Number(projectId), [item]: { [isObs ? "due_date" : "due"]: new Date().toISOString().slice(0, 10) } } }));
    let deleted = false;
    for (const [path, query] of deletePaths(recordType, projectId, id)) {
      const r = note(`${label}: delete (${path.replace(/\d{3,}/g, "…")})`, await call("DELETE", path, { query }));
      if (r.ok) { deleted = true; break; }
    }
    const after = await call("GET", `${readPath(recordType)}/${id}`, { query: { project_id: projectId } });
    steps.push({ name: `${label}: gone afterwards`, ok: deleted && !after.ok, detail: after.ok ? `still readable (status ${after.json?.status ?? "?"})${deleted ? "" : "; reset will close and rename instead"}` : `Procore answers ${after.status} (deleted / in the recycle bin)` });
  }
  const summary = {
    observationDelete: steps.find((s) => s.name === "Observation: gone afterwards")?.ok ?? null,
    punchDelete: steps.find((s) => s.name === "Punch Item: gone afterwards")?.ok ?? null,
    at: Date.now(),
  };
  await (await store()).saveMeta({ deleteCheck: { ...summary, steps } });
  return { steps, summary };
}
