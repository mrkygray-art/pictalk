// POST /api/procore/logout : signs this browser out of SiteSnap's Procore connection (clears the sealed session
// cookie, so a reload doesn't sign straight back in). Same-origin JSON only.
// GET  /api/procore/logout : sends the browser to Procore's own sign-out page ({PROCORE_LOGIN_URL}/logout; works in
// the sandbox, Ky 2026-10-15), for "Use a different Procore account": the app opens it in a small window, closes it
// after a few seconds, then starts a fresh sign-in. It changes nothing on SiteSnap's side (that's the POST).
import { clearCookie, config, redirect, requireSameOriginJson, sendError, sendJson, SESSION_COOKIE, STATE_COOKIE } from "../_procore.js";

export default function handler(req, res) {
  try {
    if (req.method === "GET") return redirect(res, `${config().loginUrl}/logout`);
    if (req.method !== "POST") return sendJson(res, 405, { error: "bad_request", message: "Use POST." });
    requireSameOriginJson(req);
    clearCookie(res, SESSION_COOKIE);
    clearCookie(res, STATE_COOKIE);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
