// GET /api/procore/photo-file?companyId=&projectId=&u=<Procore photo link>
// Procore's photo and thumbnail links answer 401 without a Procore sign-in (docs/procore-photos-findings.md,
// question 5), and a foreman's phone has none. This fetches one file with the signed-in person's own token,
// so Procore still decides what they may see, and lets the phone keep it (private HTTP cache, a week).
// Only https links on procore.com are fetched; the token is never sent anywhere else and never returned.
import { config, HttpError, procoreId, queryOf, sendError, session } from "../_procore.js";

export const MAX_BYTES = 4_400_000; // Vercel's response limit is 4.5 MB

export function allowedLink(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && (url.hostname === "procore.com" || url.hostname.endsWith(".procore.com")) ? url : null;
  } catch { return null; }
}

// Procore's thumbnails come back without a content type: tell from the first bytes
function typeOf(bytes, given) {
  if (given && /^image\//.test(given)) return given;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.slice(0, 4).toString() === "RIFF" && bytes.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (bytes.slice(4, 12).toString().startsWith("ftyp")) return "image/heic";
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "bad_request", "Use GET.");
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    if (!companyId || !procoreId(q.get("projectId"))) throw new HttpError(400, "missing_ids", "Pick a project.");
    const url = allowedLink(q.get("u"));
    if (!url) throw new HttpError(400, "bad_link", "That isn't a Procore photo.");

    let tokens = await session(req, res, cfg);
    const get = (t) => fetch(url.href, { headers: { Authorization: `Bearer ${t.at}`, "Procore-Company-Id": String(companyId) }, redirect: "follow" });
    let r = await get(tokens);
    if (r.status === 401) {
      tokens = await session(req, res, cfg, { force: true });
      r = await get(tokens);
    }
    if (r.status === 401) throw new HttpError(401, "not_connected", "Connect Procore again.");
    if (r.status === 403 || r.status === 404) throw new HttpError(r.status, "no_photo", "This photo isn't available.");
    if (!r.ok) throw new HttpError(502, "procore_error", "Procore didn't send the photo.");
    const size = Number(r.headers.get("content-length")) || 0;
    if (size > MAX_BYTES) throw new HttpError(413, "too_big", "This photo is too big to open here. Open it in Procore.");
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new HttpError(413, "too_big", "This photo is too big to open here. Open it in Procore.");
    const type = typeOf(bytes, r.headers.get("content-type"));
    if (!type) throw new HttpError(502, "not_a_photo", "Procore didn't send a photo.");
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=604800, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(bytes);
  } catch (err) {
    sendError(res, err);
  }
}
