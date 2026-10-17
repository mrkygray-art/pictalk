// Daily log by voice (docs/closeout-and-daily-log-spec.md, Feature B): the phone's side. Talks to this site's
// /api/procore/daily-log (the server writes to Procore with the signed-in person's own sign-in) and to the
// organizeDailyLog function. The draft (words, cards, photos) stays on this phone until every entry is sent,
// so leaving the screen or losing signal never loses a capture (B8). No tokens here.
import { httpsCallable } from "firebase/functions";
import { del, get, set } from "idb-keyval";
import { functions } from "../firebase";
import { shrinkPhoto } from "./recordStore";

export const SECTIONS = [
  { key: "manpower", name: "Manpower", one: "manpower", many: "manpower" },
  { key: "delays", name: "Delays", one: "delay", many: "delays" },
  { key: "deliveries", name: "Deliveries", one: "delivery", many: "deliveries" },
  { key: "notes", name: "Notes", one: "note", many: "notes" },
];
export const MAX_PHOTOS = 8;
const MAX_PER_ENTRY = 4;

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (k) => { try { return JSON.parse(store()?.getItem(k) ?? "null"); } catch { return null; } };
const write = (k, v) => { try { store()?.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } };
const remove = (k) => { try { store()?.removeItem(k); } catch { /* blocked */ } };

const OPTIONS = "sitesnap-dailylog-options:";
const DRAFT = "sitesnap-dailylog-draft:";
const SENT = "sitesnap-dailylog-sent:";
const PHOTOS = "sitesnap-dailylog-photos:";

/** Can this person use the Daily Log here, plus the project's lists. Saved per project for weak signal. */
export async function dailyLogOptions(project, date) {
  const key = `${project.companyId}_${project.projectId}`;
  const q = new URLSearchParams({ companyId: project.companyId, projectId: project.projectId, ...(date ? { date } : {}) });
  try {
    const r = await fetch(`/api/procore/daily-log?${q}`, { headers: { Accept: "application/json" } });
    const body = await r.json().catch(() => null);
    if (r.ok && body) { write(`${OPTIONS}${key}`, { ...body, savedAt: Date.now() }); return body; }
    if (r.status === 401) return { error: "Sign in to Procore again." };
    if (body?.message && r.status !== 502) return { error: body.message };
  } catch { /* no signal: the saved copy */ }
  const saved = read(`${OPTIONS}${key}`);
  return saved ? { ...saved, offline: true } : { error: "No signal. The Daily Log needs signal the first time you open it on this project." };
}

/** The AI's four sections (functions/dailyLogParser.js decides what's kept) */
export async function organizeLog(key, transcript, opts) {
  const r = await httpsCallable(functions, "organizeDailyLog", { timeout: 60000 })({
    key,
    transcript,
    context: {
      date: opts.date, timeZone: opts.timeZone, myCompany: opts.myCompany,
      companies: opts.companies, delayTypes: opts.delayTypes, locations: opts.locations,
    },
  });
  return r.data;
}

// ---------- the draft on this phone ----------

/** { date, words, log, sent: { entryId: procoreId } } or null */
export const loadDraft = (key) => read(`${DRAFT}${key}`);
export const saveDraft = (key, draft) => write(`${DRAFT}${key}`, draft);
export const hasDraft = (key) => { const d = read(`${DRAFT}${key}`); return !!(d && (String(d.words ?? "").trim() || d.log || d.photoCount)); };
export async function loadPhotos(key) { try { return (await get(`${PHOTOS}${key}`)) ?? []; } catch { return []; } }
export async function savePhotos(key, photos) { try { await set(`${PHOTOS}${key}`, photos.map(({ id, blob, attach }) => ({ id, blob, attach }))); } catch { /* storage blocked */ } }
export async function clearDraft(key) { remove(`${DRAFT}${key}`); try { await del(`${PHOTOS}${key}`); } catch { /* blocked */ } }

/** "Sent today · 4 entries" on the home tile */
export const markSent = (key, date, count) => write(`${SENT}${key}`, { date, count });
export const lastSent = (key) => read(`${SENT}${key}`);

// ---------- sending ----------

const base64 = (blob) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => bad(r.error);
  r.readAsDataURL(blob);
});

/** One entry to Procore. Throws an Error with { status, retryAfter } and a plain message when refused. */
export async function sendEntry(project, { date, section, entryId, entry, photos = [] }) {
  const files = [];
  for (const p of photos.slice(0, MAX_PER_ENTRY)) {
    const small = await shrinkPhoto(p);
    files.push({ type: small.type || "image/jpeg", data: await base64(small) });
  }
  let r;
  try {
    r = await fetch("/api/procore/daily-log", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ companyId: project.companyId, projectId: project.projectId, date, section, entryId, entry, photos: files }),
    });
  } catch {
    throw Object.assign(new Error("No signal. This entry is saved on your phone. Tap Retry."), { status: 0 });
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message ?? "Procore didn't save it. Tap Retry."), { status: r.status, retryAfter: body.retryAfter ?? null });
  return body; // { id, section, status, duplicate }
}

// ---------- past logs ----------

const getJson = async (url) => {
  let r;
  try { r = await fetch(url, { headers: { Accept: "application/json" } }); } catch { return { error: "No signal. Past logs need signal." }; }
  const body = await r.json().catch(() => null);
  if (r.ok && body) return body;
  if (r.status === 401) return { error: "Sign in to Procore again." };
  return { error: body?.message ?? "Procore didn't answer. Try again." };
};

/** Every Daily Log entry from `from` to `to` (YYYY-MM-DD), straight from Procore: { access, today, entries: [{ id,
 *  section, date, by, status, photos, entry, mine }] } or { error }. One day is read with log_date. */
export function pastLogs(project, from, to = from) {
  const q = new URLSearchParams({ companyId: project.companyId, projectId: project.projectId, view: "past", from, to });
  return getJson(`/api/procore/daily-log?${q}`);
}

/** Change (action "update", with entry) or delete one of your own entries. Throws an Error with { status, code }. */
export async function changeEntry(project, { action, section, id, entry }) {
  let r;
  try {
    r = await fetch("/api/procore/daily-log", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ companyId: project.companyId, projectId: project.projectId, action, section, id, entry }),
    });
  } catch {
    throw Object.assign(new Error("No signal. Try again when you have signal."), { status: 0, code: "offline" });
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message ?? "Procore didn't take the change. Try again."), { status: r.status, code: body.error ?? "" });
  return body; // { ok, action, section, id, entry }
}
