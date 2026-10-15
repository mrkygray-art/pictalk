// POST /api/procore/logout : signs this browser out of SiteSnap's Procore connection (clears the sealed session
// cookie, so a reload doesn't sign straight back in). It can't sign anyone out of Procore itself; the sign-in
// screen explains how, for switching to another Procore account. Same-origin JSON only.
import { clearCookie, requireSameOriginJson, sendError, sendJson, SESSION_COOKIE, STATE_COOKIE } from "../_procore.js";

export default function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "bad_request", message: "Use POST." });
    requireSameOriginJson(req);
    clearCookie(res, SESSION_COOKIE);
    clearCookie(res, STATE_COOKIE);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
