// Voice + photo -> Procore record (Step 3): the project's lists for the card, the AI draft, and sending.
// Talks to this site's /api/procore/record-options and /api/procore/records (the server writes to Procore
// with the signed-in person's own sign-in) and to the classifyCapture function. No tokens here.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

const OPTIONS_KEY = "sitesnap-record-options:";
const PHOTO_SIDE = 1600; // photos are shrunk on the phone before they're sent
const MAX_PHOTOS = 4;

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** Observation types, trades and locations for this project (saved per project for weak signal). */
export async function recordOptions(project) {
  const k = `${OPTIONS_KEY}${project.companyId}_${project.projectId}`;
  try {
    const r = await fetch(`/api/procore/record-options?${new URLSearchParams({ companyId: project.companyId, projectId: project.projectId })}`, { headers: { Accept: "application/json" } });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("application/json")) {
      const v = await r.json();
      try { store()?.setItem(k, JSON.stringify(v)); } catch { /* full */ }
      return v;
    }
  } catch { /* no signal: use the saved copy */ }
  try { return JSON.parse(store()?.getItem(k) ?? "null") ?? { observationTypes: [], trades: [], locations: [] }; } catch { return { observationTypes: [], trades: [], locations: [] }; }
}

/** The AI's draft for the card (functions/classifier.js decides what's kept) */
export async function draftRecord(key, transcript, { project, options, people }) {
  const r = await httpsCallable(functions, "classifyCapture", { timeout: 60000 })({
    key,
    transcript,
    context: {
      projectName: project.name,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      observationTypes: options.observationTypes,
      trades: options.trades,
      locations: options.locations,
      people: (people ?? []).map((p) => ({ id: p.id, name: p.name, company: p.company, title: p.title, role: p.role })),
    },
  });
  return r.data;
}

/** A photo as a JPEG at most PHOTO_SIDE on its long side (keeps the upload small on weak signal) */
export async function shrinkPhoto(blob) {
  try {
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, PHOTO_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok) => canvas.toBlob((b) => ok(b ?? blob), "image/jpeg", 0.72));
  } catch {
    return blob;
  }
}

const base64 = (blob) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => bad(r.error);
  r.readAsDataURL(blob);
});
const ext = (type) => (/png/.test(type) ? "png" : /jpe?g/.test(type) ? "jpg" : /mp4|m4a|aac/.test(type) ? "m4a" : /webm/.test(type) ? "webm" : /wav/.test(type) ? "wav" : "bin");

/** Create the record in Procore. card: the confirmed fields; photos: [Blob]; voice: Blob | null */
export async function sendRecord(project, card, { photos = [], voice = null, link = null } = {}) {
  const files = [];
  for (const [i, p] of photos.slice(0, MAX_PHOTOS).entries()) {
    const small = await shrinkPhoto(p);
    files.push({ name: `SiteSnap-photo-${i + 1}.${ext(small.type)}`, type: small.type || "image/jpeg", data: await base64(small) });
  }
  if (voice) files.push({ name: `SiteSnap-voice.${ext(voice.type)}`, type: (voice.type || "audio/webm").split(";")[0], data: await base64(voice) });
  const r = await fetch("/api/procore/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ companyId: project.companyId, projectId: project.projectId, card, files, link }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message ?? "Couldn't send it to Procore. Try again."), { status: r.status });
  return body; // { recordType, id, number, url, warnings }
}

/** What Procore says now about a thread's record; closes the thread if it was closed in Procore. */
export async function syncRecord(project, cid) {
  const r = await fetch(`/api/procore/record-status?${new URLSearchParams({ companyId: project.companyId, projectId: project.projectId, cid })}`, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message ?? "Couldn't check Procore."), { status: r.status });
  return body;
}

/** Change a thread's record in Procore: done (ready for review), close, or reopen. Procore decides who may. */
export async function recordAction(project, cid, action) {
  const r = await fetch("/api/procore/record-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ companyId: project.companyId, projectId: project.projectId, cid, action }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message ?? "Couldn't change it in Procore. Try again."), { status: r.status });
  return body;
}

export const RECORD_LABEL = { observation: "Observation", punch_item: "Punch Item" };
/** Where each kind lands in Procore, in the words of Procore's own menu */
export const RECORD_TOOL = { observation: "Observations", punch_item: "Punch List" };
export const RECORD_HINT = {
  observation: "An issue to track: quality, safety, a problem someone needs to look at.",
  punch_item: "One specific thing to fix or finish, usually before closeout.",
};
export { MAX_PHOTOS };
