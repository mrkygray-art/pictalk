// POST /api/procore/photo-upload : Snap (docs/sitesnap-project-home-and-photos-spec.md 2.2-2.4). Saves one photo
// into a Procore Photos album with the signed-in person's own Procore sign-in.
// Body (same-origin JSON): { companyId, projectId, captureId, takenAt (ISO), albumId? (else that day's album),
//   description?, voicePath?, link? { type: punch_item | observation, id, number } (a Report an issue photo),
//   photo: { type, data (base64) } }
//  1. captureId already saved (procoreProjects/{key}/photoCaptures/{captureId})? Answer with that photo: a retry
//     never makes a second copy in Procore.
//  2. Album: the one picked (never a private one), else "Field photos YYYY-MM-DD" for the day it was taken (the
//     project's own date, so a photo saved offline still files under its own day), made public if it doesn't exist yet. Standard on Photos can make albums (procore-photos-findings.md).
//  3. Upload slot -> Create Image (upload_uuid, private: false, description).
//  4. Remembers captureId -> image id (and the voice note's path in SiteSnap storage) for retries, and
//     photoLinks/{imageId} -> the record, for the "Linked to Punch Item #2" badge (spec section 3).
// Answers { imageId, albumId, albumName, duplicate }.
import { config, HttpError, procoreId, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { procoreSend, uploadFile } from "../_procoreWrite.js";
import { firestore } from "../_firestore.js";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // the phone shrinks photos to 2048 px first
export const MAX_DESCRIPTION = 2500; // Procore kept 3,000 in the sandbox check
export const albumNameFor = (day) => `Field photos ${day}`;
const CAPTURE = /^[A-Za-z0-9_-]{8,64}$/;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }; // never TIFF or HEIC

function projectDay(timeZone, now = new Date()) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "America/Los_Angeles" }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
}

const NO_PHOTOS = "You don't have permission to add photos to this project. Ask your project manager to give you Standard on Photos in Procore.";
function refused(r, what) {
  if (r.status === 401) return new HttpError(401, "not_connected", "Connect Procore again.");
  if (r.status === 403) return new HttpError(403, "no_photo_access", what === "album" ? "You can't make albums on this project. Pick an album, or ask your project manager to make one." : NO_PHOTOS);
  if (r.status === 404) return new HttpError(404, "no_photos_tool", "The Photos tool isn't turned on for this project in Procore.");
  if (r.status === 429) return new HttpError(429, "busy", "Procore is busy. It will try again in a minute.");
  return new HttpError(502, "procore_error", "Procore didn't save the photo. It will try again.");
}

const LINK_TYPES = new Set(["punch_item", "observation"]);
function linkOf(v) {
  if (!v || typeof v !== "object" || !LINK_TYPES.has(v.type)) return null;
  const id = procoreId(String(v.id ?? ""));
  return id ? { type: v.type, id: Number(id), number: String(v.number ?? "").slice(0, 20) } : null;
}
let db = null;
const linkDocs = (key) => db?.collection("procoreProjects").doc(key).collection("photoLinks");

// The capture log (firebase-admin). Without it the upload still works, just without the retry guard.
async function captures(key) {
  try { db = await firestore(); return db.collection("procoreProjects").doc(key).collection("photoCaptures"); }
  catch (err) { console.log("SiteSnap photo upload: no capture log", err.message); return null; }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const cfg = config();
    const body = await readBody(req);
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    const captureId = String(body.captureId ?? "");
    if (!CAPTURE.test(captureId)) throw new HttpError(400, "bad_capture", "That photo can't be saved. Take it again.");
    const type = String(body.photo?.type ?? "").split(";")[0];
    if (!TYPES[type]) throw new HttpError(400, "bad_type", "This kind of photo can't be saved. Take it with the camera instead.");
    const bytes = Buffer.from(String(body.photo?.data ?? ""), "base64");
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new HttpError(400, "bad_photo", "That photo is too big or empty. Take it again.");
    const description = String(body.description ?? "").trim().slice(0, MAX_DESCRIPTION);
    const key = `${companyId}_${projectId}`;
    // The voice note in SiteSnap storage: this project's messages only (Snap's own, or the report / message it came with)
    const vp = typeof body.voicePath === "string" ? body.voicePath : "";
    const voicePath = vp.startsWith(`messages/${key}/`) && /^[A-Za-z0-9_\-/.]{1,300}$/.test(vp) && /\/voice\.[a-z0-9]{2,5}$/.test(vp) && !vp.includes("..") ? vp : null;
    const link = linkOf(body.link);
    // When it was taken (a queued photo uploads later); anything odd counts as now
    const t = Date.parse(String(body.takenAt ?? ""));
    const takenAt = Number.isFinite(t) && t <= Date.now() + 3600_000 && t >= Date.now() - 30 * 86_400_000 ? new Date(t) : new Date();
    const albumWanted = body.albumId == null || body.albumId === "" ? null : procoreId(String(body.albumId));
    if (body.albumId != null && body.albumId !== "" && !albumWanted) throw new HttpError(400, "bad_album", "That album isn't valid.");

    // 1. Already saved?
    const log = await captures(key);
    const seen = log ? await log.doc(captureId).get().catch(() => null) : null;
    if (seen?.exists && seen.data()?.imageId) {
      const d = seen.data();
      return sendJson(res, 200, { imageId: d.imageId, albumId: d.albumId, albumName: d.albumName, duplicate: true });
    }

    // 2. The album
    const list = await procoreSend(req, res, cfg, "GET", "/rest/v1.0/image_categories", { companyId, query: { project_id: projectId, per_page: 100 } });
    if (!list.ok) throw refused(list, "photo");
    const albums = Array.isArray(list.json) ? list.json : [];
    let album;
    if (albumWanted) {
      album = albums.find((a) => String(a.id) === String(albumWanted));
      if (!album) throw new HttpError(404, "no_album", "That album isn't in Procore anymore. Pick another one.");
      if (album.private) throw new HttpError(400, "private_album", "That album is private, so the photo would be hidden from the team. Pick another album.");
    } else {
      const p = await procoreSend(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}`, { companyId, query: { company_id: companyId } });
      const name = albumNameFor(projectDay(p.ok ? p.json?.time_zone : null, takenAt));
      album = albums.find((a) => a.name === name && !a.private);
      if (!album) {
        const made = await procoreSend(req, res, cfg, "POST", "/rest/v1.0/image_categories", { companyId, query: { project_id: projectId }, body: { image_category: { name, private: false } } });
        if (!made.ok) throw refused(made, "album");
        album = made.json;
      }
    }

    // 3. Upload, then the photo record
    const name = `SiteSnap-${captureId.slice(0, 8)}.${TYPES[type]}`;
    const up = await uploadFile(req, res, cfg, { companyId, projectId, name, type, bytes });
    if (!up.ok) throw refused({ status: up.status }, "photo");
    const image = { image_category_id: album.id, private: false, source: "SiteSnap", ...(description ? { description } : {}) };
    const made = await procoreSend(req, res, cfg, "POST", "/rest/v1.0/images", { companyId, query: { project_id: projectId }, body: { upload_uuid: up.uuid, image_name: name, image } });
    if (!made.ok) throw refused(made, "photo");

    // 4. Remember it
    const out = { imageId: made.json?.id, albumId: album.id, albumName: album.name };
    if (log) {
      await log.doc(captureId).set({ ...out, voicePath, link, savedAt: Date.now() }).catch((err) => console.log("SiteSnap photo upload: capture log not written", err.message));
      if (link && out.imageId) await linkDocs(key)?.doc(String(out.imageId)).set({ ...link, captureId, savedAt: Date.now() }).catch((err) => console.log("SiteSnap photo upload: link not written", err.message));
    }
    console.log("SiteSnap photo upload", JSON.stringify({ key, imageId: out.imageId, albumId: out.albumId, made: !albumWanted && !albums.some((a) => a.id === album.id) }));
    sendJson(res, 200, { ...out, duplicate: false });
  } catch (err) {
    sendError(res, err);
  }
}
