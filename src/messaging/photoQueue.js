// Snap's upload queue (docs/sitesnap-project-home-and-photos-spec.md, section 5). A snapped photo is saved on the
// phone first (IndexedDB), then uploaded oldest first by /api/procore/photo-upload. Each capture keeps one id, so
// a retry never makes a second copy in Procore (the server remembers the id). Signal problems wait and try
// again (5 s, 10 s, 20 s … up to 5 minutes); a refusal (no permission, private album) waits for Retry.
import { del, get, keys, set } from "idb-keyval";
import { shrinkPhoto } from "./recordStore";
import { transcribeVoice, uploadFile } from "./messagingStore";

export const PHOTO_MAX_SIDE = 2048; // spec 2.2: resize before upload (big uploads time out in Procore)
export const PHOTO_QUALITY = 0.8;
const PREFIX = "pending-photo-capture:";
const listeners = new Set();
let running = false;
let lastSaved = null; // { captureId, albumName, at } for the confirmation line

const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* a screen that went away */ } });
export const onPhotoQueueChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const lastSavedPhoto = () => lastSaved;

export const voicePathForPhoto = (key, captureId, type) =>
  `messages/${key}/photos/${captureId}/voice.${/mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm"}`;

/** What goes in Procore's description: the words, then who took it and when (Procore shows the upload time,
 *  which can be later when the photo waited for signal) */
export function descriptionFor(words, by, takenAt) {
  const when = new Date(takenAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return [String(words ?? "").trim(), `Photo by ${by || "SiteSnap"}, ${when}`].filter(Boolean).join("\n\n");
}

/** Save a snapped photo on the phone and start uploading. Throws a plain-language Error for a photo it can't take. */
export async function queuePhoto({ captureId, project, albumId = null, albumLabel, words = "", wordsPending = false, by, photo, voice = null, voicePath = null }) {
  const small = await shrinkPhoto(photo, PHOTO_MAX_SIDE, PHOTO_QUALITY);
  if (!/^image\/(jpeg|png|webp)$/.test(small.type)) throw new Error("This kind of photo can't be saved. Take it with the camera instead.");
  await set(PREFIX + captureId, {
    captureId, key: `${project.companyId}_${project.projectId}`, companyId: project.companyId, projectId: project.projectId,
    takenAt: new Date().toISOString(), albumId, albumLabel, words, wordsPending, by, photo: small, voice, voicePath,
    status: "waiting", attempts: 0, nextTry: 0, error: "",
  });
  changed();
  syncPhotos();
}

async function all() {
  const ks = (await keys()).filter((k) => String(k).startsWith(PREFIX));
  const list = (await Promise.all(ks.map((k) => get(k)))).filter(Boolean);
  return list.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/** This project's photos still on the phone, oldest first */
export const pendingPhotos = async (key) => (await all()).filter((p) => p.key === key);

export async function retryPhoto(captureId) {
  const p = await get(PREFIX + captureId);
  if (!p) return;
  await set(PREFIX + captureId, { ...p, status: "waiting", nextTry: 0, error: "" });
  changed();
  syncPhotos();
}

export async function discardPhoto(captureId) {
  await del(PREFIX + captureId);
  changed();
}

const base64 = (blob) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => bad(r.error);
  r.readAsDataURL(blob);
});
const backoff = (attempts) => Math.min(5 * 60_000, 5000 * 2 ** Math.max(0, attempts - 1));

/** Upload what's waiting, oldest first. One at a time; stops at the first one that has to wait (keeps the order). */
export async function syncPhotos({ now = false } = {}) {
  if (running) return;
  running = true;
  try {
    for (const p of await all()) {
      if (p.status === "failed") continue; // waits for Retry
      if ((!now && p.nextTry > Date.now()) || !navigator.onLine) break;
      let entry = p;
      try {
        // The voice note goes to SiteSnap's storage (Procore's Photos tool doesn't keep audio)
        if (entry.voice && !entry.voicePath) {
          const path = await uploadFile(voicePathForPhoto(entry.key, entry.captureId, entry.voice.type), entry.voice);
          entry = { ...entry, voicePath: path };
          await set(PREFIX + entry.captureId, entry);
        }
        if (entry.wordsPending && entry.voicePath) {
          const t = await transcribeVoice(entry.key, entry.voicePath, entry.voice?.type).catch(() => "");
          entry = { ...entry, words: [entry.words.trim(), t].filter(Boolean).join(" "), wordsPending: false };
          await set(PREFIX + entry.captureId, entry);
        }
        const r = await fetch("/api/procore/photo-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            companyId: entry.companyId, projectId: entry.projectId, captureId: entry.captureId, takenAt: entry.takenAt,
            albumId: entry.albumId, description: descriptionFor(entry.words, entry.by, entry.takenAt), voicePath: entry.voicePath,
            photo: { type: entry.photo.type, data: await base64(entry.photo) },
          }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          await del(PREFIX + entry.captureId);
          lastSaved = { captureId: entry.captureId, albumName: body.albumName, imageId: body.imageId, at: Date.now() };
          changed();
          continue;
        }
        // Refused (permission, private or missing album, bad photo, signed out): wait for the person
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
          await set(PREFIX + entry.captureId, { ...entry, status: "failed", error: body.message || "Procore didn't take this photo." });
          changed();
          continue;
        }
        throw new Error(body.message || "Procore didn't answer.");
      } catch (err) {
        const attempts = (entry.attempts ?? 0) + 1;
        await set(PREFIX + entry.captureId, { ...entry, attempts, nextTry: Date.now() + backoff(attempts), error: navigator.onLine ? err.message || "Couldn't upload." : "" });
        changed();
        break;
      }
    }
  } finally {
    running = false;
  }
}

/** Keep trying while the app is open: when signal returns, when the app comes back, and every 20 seconds */
export function startPhotoSync() {
  const kick = () => syncPhotos();
  const back = () => syncPhotos({ now: true }); // signal is back: don't wait out the backoff
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
