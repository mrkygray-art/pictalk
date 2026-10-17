// Project photos (docs/sitesnap-project-home-and-photos-spec.md): read Procore's Photos tool, which stays the
// system of record. Read-only, with the signed-in person's own Procore sign-in, so people only see what Procore
// already shows them (private albums included only when Procore lists them for this person).
// GET /api/procore/photos?companyId=&projectId=&view=albums
//   -> { albums: [{ id, name, count, private, updatedAt, cover }] }
// GET /api/procore/photos?companyId=&projectId=&view=photos[&albumId=][&page=1]
//   -> { photos: [...newest first], page, nextPage, total, timeZone }
// GET /api/procore/photos?companyId=&projectId=&view=photos&day=YYYY-MM-DD[&page=1]
//   -> the same, but only photos added to Procore on that project day or the next (a phone that was offline
//      overnight uploads late). filters[created_at] with the day and the project's UTC offset is the filter the
//      sandbox confirmed (docs/procore-photos-findings.md, question 4); the phone then keeps the photos taken
//      (else added) on that day.
// Image links (cover, thumb, full) point at /api/procore/photo-file, because Procore's own links need a
// Procore sign-in that a foreman's phone doesn't have (docs/procore-photos-findings.md, question 5).
import { config, HttpError, procoreId, queryOf, sendError, sendJson } from "../_procore.js";
import { procoreSend } from "../_procoreWrite.js";
import { firestore } from "../_firestore.js";
import { ianaZone } from "../_dailyLog.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
/** The project's UTC offset ("-07:00") on a given day (so daylight saving is right for that day) */
export function offsetOn(timeZone, iso) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: ianaZone(timeZone), timeZoneName: "longOffset" })
      .formatToParts(new Date(`${iso}T12:00:00Z`)).find((x) => x.type === "timeZoneName")?.value ?? "";
    const m = /GMT([+-]\d{2}:\d{2})/.exec(part);
    return m ? m[1] : "+00:00";
  } catch { return "+00:00"; }
}
/** filters[created_at] for a project day and the day after */
export const createdOnDay = (timeZone, day) => `${day}T00:00:00${offsetOn(timeZone, day)}...${nextDay(day)}T23:59:59${offsetOn(timeZone, nextDay(day))}`;

// Photos SiteSnap filed from Report an issue: procoreProjects/{key}/photoLinks/{imageId} -> { type, id, number }.
// Without the store the photos still list, just without badges.
async function linksFor(key, ids) {
  if (!ids.length) return {};
  try {
    const db = await firestore();
    const col = db.collection("procoreProjects").doc(key).collection("photoLinks");
    const snaps = await db.getAll(...ids.map((id) => col.doc(String(id))));
    return Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, { type: s.data().type, id: s.data().id, number: s.data().number ?? "" }]));
  } catch (err) {
    console.log("SiteSnap photos: links not read", err.message);
    return {};
  }
}

export const PER_PAGE = 48;

/** The phone's link for one Procore photo file */
export const fileLink = (companyId, projectId, url) =>
  url ? `/api/procore/photo-file?${new URLSearchParams({ companyId, projectId, u: url })}` : null;

const nextFromLink = (link) => {
  const m = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/.exec(link ?? "");
  return m ? Number(m[1]) : null;
};

export function photoOut(img, companyId, projectId) {
  return {
    id: img.id,
    albumId: img.image_category_id ?? null,
    albumName: img.image_category_name ?? "",
    albumPrivate: !!img.image_category_private,
    description: img.description ?? "",
    by: img.uploader?.name ?? "", // never the uploader's login (an email)
    createdAt: img.created_at ?? null,
    takenAt: img.taken_at ?? null,
    location: img.location?.id ? { id: img.location.id, name: img.location.node_name || img.location.name || "" } : null,
    trades: (img.trades ?? []).filter((t) => t?.id).map((t) => ({ id: t.id, name: t.name })),
    thumb: fileLink(companyId, projectId, img.thumbnail_url || img.url),
    full: fileLink(companyId, projectId, img.url),
  };
}

const refused = (r) => {
  if (r.status === 401) return new HttpError(401, "not_connected", "Connect Procore again.");
  if (r.status === 403) return new HttpError(403, "no_photos", "You don't have access to this project's photos in Procore. Ask your project manager.");
  if (r.status === 404) return new HttpError(404, "no_photos_tool", "The Photos tool isn't turned on for this project in Procore.");
  if (r.status === 429) return new HttpError(429, "busy", "Procore is busy. Try again in a minute.");
  return new HttpError(502, "procore_error", "Procore didn't answer. Try again.");
};

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "bad_request", "Use GET.");
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    const projectId = procoreId(q.get("projectId"));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    res.setHeader("Cache-Control", "no-store");

    if (q.get("view") === "albums") {
      const r = await procoreSend(req, res, cfg, "GET", "/rest/v1.0/image_categories", { companyId, query: { project_id: projectId, per_page: 100 } });
      if (!r.ok) throw refused(r);
      const albums = (Array.isArray(r.json) ? r.json : []).map((a) => ({
        id: a.id, name: a.name ?? "", count: a.count ?? 0, private: !!a.private, updatedAt: a.updated_at ?? a.created_at ?? null,
        cover: fileLink(companyId, projectId, a.cover_photo),
      }));
      return sendJson(res, 200, { albums });
    }

    if (q.get("view") === "photos") {
      const page = Math.max(1, Math.min(500, Number(q.get("page")) || 1));
      const albumId = q.get("albumId") ? procoreId(q.get("albumId")) : null;
      if (q.get("albumId") && !albumId) throw new HttpError(400, "bad_album", "That album isn't valid.");
      const day = q.get("day");
      if (day && !DATE.test(day)) throw new HttpError(400, "bad_day", "Pick a day.");
      // The project's time zone groups photos by the project's own day (Procore's dates are UTC)
      let timeZone = null;
      if (page === 1 || day) {
        const p = await procoreSend(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}`, { companyId, query: { company_id: companyId } });
        timeZone = p.ok && p.json?.time_zone ? ianaZone(p.json.time_zone) : null; // "Pacific Time (US & Canada)" -> "America/Los_Angeles": phones only know the second
      }
      const query = {
        project_id: projectId, per_page: PER_PAGE, page, sort: "-created_at",
        ...(albumId ? { image_category_id: albumId } : {}),
        ...(day ? { "filters[created_at]": createdOnDay(timeZone, day) } : {}),
      };
      const r = await procoreSend(req, res, cfg, "GET", "/rest/v1.0/images", { companyId, query });
      if (!r.ok) throw refused(r);
      const list = Array.isArray(r.json) ? r.json : [];
      const total = Number(r.headers?.total) || null;
      const nextPage = nextFromLink(r.headers?.link) ?? (total && page * PER_PAGE < total ? page + 1 : null);
      const links = await linksFor(`${companyId}_${projectId}`, list.map((img) => img.id).filter(Boolean));
      const photos = list.map((img) => ({ ...photoOut(img, companyId, projectId), linked: links[String(img.id)] ?? null }));
      return sendJson(res, 200, { photos, page, nextPage, total, timeZone });
    }

    throw new HttpError(400, "bad_view", "Ask for albums or photos.");
  } catch (err) {
    sendError(res, err);
  }
}
