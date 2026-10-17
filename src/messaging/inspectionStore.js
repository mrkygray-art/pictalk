// Inspections on the phone (sitesnap-inspections-spec.md sections 5, 6 and 10). Every answer is saved on this phone
// first (IndexedDB), shown at once, then sent to Procore by /api/procore/inspections in the order it was given.
// Signal problems wait and retry (5 s … 5 min, and at once when signal returns); a refusal waits for the person;
// "already answered by someone else" (409) waits for Keep theirs / Use mine. Answers are never lost.
// One record per inspection: sitesnap-inspection-run:{companyId}_{projectId}:{listId}
//   { snapshot (the last read, so it opens without signal), myId, local {itemId: answer}, notes {itemId: {text, saved}},
//     sectionNa {sectionId: na}, observations {itemId: {id, number, url} | {skipped} | {queued}}, photos {itemId: n}, ops [] }
import { del, get, keys, set } from "idb-keyval";
import { shrinkPhoto } from "./recordStore";

const PREFIX = "sitesnap-inspection-run:";
const PHOTO_SIDE = 1600;
const listeners = new Set();
let running = false;

const changed = (runKey) => listeners.forEach((fn) => { try { fn(runKey); } catch { /* a screen that went away */ } });
export const onInspectionChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const runKeyOf = (project, listId) => `${PREFIX}${project.companyId}_${project.projectId}:${listId}`;
export const newOpId = () => crypto.randomUUID().replace(/-/g, "");

const base64 = (blob) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => bad(r.error);
  r.readAsDataURL(blob);
});
const backoff = (attempts) => Math.min(5 * 60_000, 5000 * 2 ** Math.max(0, attempts - 1));
const json = async (r) => (r.headers.get("content-type") ?? "").includes("application/json") ? r.json().catch(() => ({})) : {};

// ---------- reading ----------

/** The Inspections list: { access, reason?, myCompany, groups: { mine, company, open } } */
export async function listInspections(project) {
  const r = await fetch(`/api/procore/inspections?${new URLSearchParams({ companyId: project.companyId, projectId: project.projectId })}`, { headers: { Accept: "application/json" } });
  const body = await json(r);
  if (!r.ok) throw Object.assign(new Error(body.message || "Couldn't load inspections. Try again."), { status: r.status });
  return body;
}

/** Open an inspection: Procore's latest when there's signal (kept on the phone), else the copy on this phone. */
export async function openInspection(project, listId) {
  const k = runKeyOf(project, listId);
  const saved = await get(k);
  try {
    const r = await fetch(`/api/procore/inspections?${new URLSearchParams({ companyId: project.companyId, projectId: project.projectId, id: listId })}`, { headers: { Accept: "application/json" } });
    const body = await json(r);
    if (r.ok && body.access === false) return { access: false, reason: body.reason };
    if (!r.ok) throw Object.assign(new Error(body.message || "Couldn't open the inspection."), { status: r.status });
    const run = { ...emptyRun(project, listId), ...(saved ?? {}), snapshot: body.inspection, myId: body.myId ?? saved?.myId ?? null, readAt: Date.now() };
    // Answers Procore now has, that this phone already sent, no longer need the local copy
    for (const [itemId, a] of Object.entries(run.local)) if (a.synced) delete run.local[itemId];
    await set(k, run);
    return { access: true, run, offline: false };
  } catch (err) {
    if (saved?.snapshot) return { access: true, run: saved, offline: true };
    throw err;
  }
}

function emptyRun(project, listId) {
  return { key: `${project.companyId}_${project.projectId}`, companyId: project.companyId, projectId: project.projectId, listId: String(listId), snapshot: null, myId: null, local: {}, notes: {}, sectionNa: {}, observations: {}, photos: {}, ops: [] };
}

export const loadRun = (project, listId) => get(runKeyOf(project, listId));

async function update(runKey, fn) {
  const run = await get(runKey);
  if (!run) return null;
  const next = fn(structuredClone(run)) ?? run;
  await set(runKey, next);
  changed(runKey);
  return next;
}

// ---------- what the screens show ----------

/** The answer to show for an item: this phone's (sent or not) first, else Procore's */
export const answerFor = (run, item) => run.local[item.id] ?? item.answer ?? null;

/** Sections with each item's current answer, counts per section and overall */
export function viewOf(run) {
  const sections = (run.snapshot?.sections ?? []).map((s) => {
    const na = run.sectionNa[s.id] ?? s.na;
    const items = s.items.map((it) => ({ ...it, current: answerFor(run, it) }));
    const c = { total: items.length, answered: 0, pass: 0, fail: 0, na: 0, neutral: 0 };
    for (const it of items) {
      if (it.current?.counts) { c.answered++; c[it.current.counts]++; } else if (na) { c.answered++; c.na++; }
    }
    return { ...s, na, items, counts: c };
  });
  const all = sections.flatMap((s) => s.items.map((it) => ({ ...it, section: s })));
  const counts = sections.reduce((t, s) => { for (const k of Object.keys(t)) t[k] += s.counts[k]; return t; }, { total: 0, answered: 0, pass: 0, fail: 0, na: 0, neutral: 0 });
  return { sections, all, counts };
}

/** The first item still to answer (in an N/A section nothing is left), else null */
export function firstOpen(view, sectionId = null) {
  return view.all.find((it) => (!sectionId || it.section.id === sectionId) && !it.section.na && !it.current?.counts) ?? null;
}

/** Waiting to reach Procore: { waiting, failed, conflicts } */
export function syncState(run) {
  const ops = run?.ops ?? [];
  return { waiting: ops.filter((o) => o.status === "waiting").length, failed: ops.filter((o) => o.status === "failed"), conflicts: ops.filter((o) => o.status === "conflict") };
}

// ---------- saving (all go through the queue) ----------

async function enqueue(runKey, op, fn) {
  const opId = newOpId();
  await update(runKey, (run) => { fn?.(run, opId); run.ops.push({ opId, status: "waiting", attempts: 0, nextTry: 0, error: "", at: Date.now(), ...op }); return run; });
  syncInspections();
}

/** Save an answer: { counts } for Pass / Fail / N/A, { optionId, counts } for the template's options, { value } for text, number, date */
export function saveAnswer(runKey, item, answer) {
  const known = item.answer?.by ? { byId: item.answer.by.id, at: item.answer.at } : null; // what this phone saw: "Already answered" is only asked for a newer answer
  return enqueue(runKey, { action: "answer", itemId: item.id, answer, known }, (run, opId) => {
    run.local[item.id] = { ...answer, by: null, at: new Date().toISOString(), synced: false, opId };
    run.ops = run.ops.filter((o) => !(o.action === "answer" && o.itemId === item.id)); // the newest answer wins (one already on its way is ignored when it lands)
  });
}

export function saveNote(runKey, item, text) {
  const t = String(text ?? "").trim();
  if (!t) return Promise.resolve();
  return enqueue(runKey, { action: "note", itemId: item.id, text: t }, (run) => { run.notes[item.id] = { text: t, saved: false }; });
}

export async function savePhoto(runKey, item, blob) {
  const small = await shrinkPhoto(blob, PHOTO_SIDE, 0.75);
  return enqueue(runKey, { action: "photo", itemId: item.id, photo: small }, (run) => { run.photos[item.id] = (run.photos[item.id] ?? 0) + 1; });
}

export function setSectionNa(runKey, section, na) {
  return enqueue(runKey, { action: "section_na", sectionId: section.id, na }, (run) => { run.sectionNa[section.id] = na; });
}

/** Fail -> Observation (Report an issue's card, photos as Blobs). Procore marks the item failed when it links them. */
export async function failToObservation(runKey, item, { card, photos = [], contractor = null }) {
  const small = [];
  for (const p of photos.slice(0, 4)) small.push(await shrinkPhoto(p, PHOTO_SIDE, 0.72));
  return enqueue(runKey, { action: "fail", itemId: item.id, card, photos: small, contractor }, (run, opId) => {
    run.local[item.id] = { counts: "fail", by: null, at: new Date().toISOString(), synced: false, opId };
    run.observations[item.id] = { queued: true };
  });
}

/** Fail without an Observation: the item is marked failed and flagged on the summary */
export function skipObservation(runKey, item) {
  return enqueue(runKey, { action: "answer", itemId: item.id, answer: { counts: "fail" }, known: item.answer?.by ? { byId: item.answer.by.id, at: item.answer.at } : null }, (run, opId) => {
    run.local[item.id] = { counts: "fail", by: null, at: new Date().toISOString(), synced: false, opId };
    run.observations[item.id] = { skipped: true };
  });
}

/** "Already answered by …": keep theirs (drop mine) or use mine (send it anyway) */
export function resolveConflict(runKey, opId, useMine) {
  return update(runKey, (run) => {
    const op = run.ops.find((o) => o.opId === opId);
    if (!op) return run;
    if (useMine) Object.assign(op, { status: "waiting", force: true, nextTry: 0, error: "" });
    else {
      run.ops = run.ops.filter((o) => o.opId !== opId);
      delete run.local[op.itemId];
      if (op.theirs && run.snapshot) for (const s of run.snapshot.sections) for (const it of s.items) if (it.id === op.itemId) it.answer = op.theirs;
    }
    return run;
  }).then(() => syncInspections());
}

export const retryOp = (runKey, opId) => update(runKey, (run) => { const op = run.ops.find((o) => o.opId === opId); if (op) Object.assign(op, { status: "waiting", nextTry: 0, error: "" }); return run; }).then(() => syncInspections({ now: true }));

/** Drop something Procore keeps refusing (the answer stays on this phone's summary as not sent) */
export const dropOp = (runKey, opId) => update(runKey, (run) => { run.ops = run.ops.filter((o) => o.opId !== opId); return run; });

/** Submit: needs signal. { closed } or { closed: false, message } when the role can't close inspections */
export async function submitInspection(project, listId) {
  const r = await fetch("/api/procore/inspections", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ companyId: project.companyId, projectId: project.projectId, listId, action: "close" }),
  });
  const body = await json(r);
  if (!r.ok) throw Object.assign(new Error(body.message || "Couldn't submit it. Try again."), { status: r.status });
  return body;
}

/** Forget this phone's copy (after a submitted inspection has nothing left to send) */
export const forgetRun = (project, listId) => del(runKeyOf(project, listId));

// ---------- sending ----------

async function bodyFor(run, op) {
  const base = { companyId: run.companyId, projectId: run.projectId, listId: run.listId, action: op.action, opId: op.opId };
  if (op.action === "answer") return { ...base, itemId: op.itemId, answer: op.answer, known: op.known, force: !!op.force };
  if (op.action === "note") return { ...base, itemId: op.itemId, text: op.text };
  if (op.action === "section_na") return { ...base, sectionId: op.sectionId, na: op.na };
  if (op.action === "photo") return { ...base, itemId: op.itemId, photo: { type: op.photo.type || "image/jpeg", data: await base64(op.photo) } };
  if (op.action === "fail") {
    const files = [];
    for (const [i, p] of op.photos.entries()) files.push({ name: `SiteSnap-item-photo-${i + 1}.jpg`, type: p.type || "image/jpeg", data: await base64(p) });
    return { ...base, itemId: op.itemId, card: op.card, files, contractor: op.contractor };
  }
  return base;
}

function applyResult(run, op, out) {
  if (op.action === "answer" && out.item) {
    for (const s of run.snapshot?.sections ?? []) s.items = s.items.map((it) => (it.id === op.itemId ? { ...it, ...out.item, sectionId: it.sectionId, number: it.number } : it));
    if (run.local[op.itemId]?.opId === op.opId) run.local[op.itemId].synced = true; // a newer answer may be waiting
  }
  if (op.action === "note") run.notes[op.itemId] = { ...(run.notes[op.itemId] ?? {}), saved: out.saved !== false, notInProcore: out.saved === false };
  if (op.action === "fail") {
    run.observations[op.itemId] = { id: out.id, number: out.number, url: out.url, linked: out.linked, warnings: out.warnings ?? [] };
    if (run.local[op.itemId]?.opId === op.opId) run.local[op.itemId].synced = true;
  }
}

/** Send what's waiting, oldest first, one inspection at a time; an inspection stops at the first op that has to wait. */
export async function syncInspections({ now = false } = {}) {
  if (running) return;
  running = true;
  try {
    const runKeys = (await keys()).filter((k) => String(k).startsWith(PREFIX));
    for (const runKey of runKeys) {
      for (;;) {
        const run = await get(runKey);
        // Oldest waiting first; refused ones and "already answered" ones wait for the person without holding up the rest
        const op = run?.ops?.find((o) => o.status === "waiting");
        if (!op) break;
        if ((!now && op.nextTry > Date.now()) || !navigator.onLine) break;
        let r, out;
        try {
          r = await fetch("/api/procore/inspections", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(await bodyFor(run, op)) });
          out = await json(r);
        } catch {
          await update(runKey, (x) => { const o = x.ops.find((y) => y.opId === op.opId); if (o) { o.attempts++; o.nextTry = Date.now() + backoff(o.attempts); o.error = ""; } return x; });
          break;
        }
        if (r.ok) {
          await update(runKey, (x) => { x.ops = x.ops.filter((y) => y.opId !== op.opId); applyResult(x, op, out); return x; });
          continue;
        }
        if (r.status === 409 && out.error === "already_answered") {
          await update(runKey, (x) => { const o = x.ops.find((y) => y.opId === op.opId); if (o) Object.assign(o, { status: "conflict", by: out.by, theirs: out.answer, error: out.message }); return x; });
          continue; // the rest of this inspection can still go
        }
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
          console.warn("SiteSnap inspections: Procore refused", op.action, r.status);
          await update(runKey, (x) => {
            const o = x.ops.find((y) => y.opId === op.opId);
            if (o) Object.assign(o, { status: "failed", error: out.message || "Procore didn't take this." });
            if (op.action === "fail") x.observations[op.itemId] = { queued: true, error: out.message || "Procore didn't create the Observation." };
            return x;
          });
          continue;
        }
        await update(runKey, (x) => { const o = x.ops.find((y) => y.opId === op.opId); if (o) { o.attempts++; o.nextTry = Date.now() + backoff(o.attempts); o.error = out.message || ""; } return x; });
        break;
      }
    }
  } finally {
    running = false;
  }
}

/** Keep trying while the app is open: when signal returns, when the app comes back, and every 20 seconds */
export function startInspectionSync() {
  const kick = () => syncInspections();
  const back = () => syncInspections({ now: true });
  const onVisible = () => document.visibilityState === "visible" && back();
  window.addEventListener("online", back);
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(kick, 20_000);
  kick();
  return () => {
    window.removeEventListener("online", back);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}
