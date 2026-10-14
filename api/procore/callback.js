// GET /api/procore/callback?code=&state= : Procore sends the user back here. Checks the state
// against the cookie (once only), trades the code for tokens, keeps them in an encrypted httpOnly
// cookie, and returns to the app with the same company / project.
import {
  appUrl, checkState, clearCookie, config, exchangeCode, HttpError, queryOf, readCookies, redirect, saveSession, sendError, STATE_COOKIE,
} from "../_procore.js";

export default async function handler(req, res) {
  try {
    const cfg = config();
    const q = queryOf(req);
    const stateCookie = readCookies(req)[STATE_COOKIE];
    clearCookie(res, STATE_COOKIE); // single use, whatever happens next
    const context = checkState(cfg, stateCookie, q.get("state"));
    if (q.get("error")) return redirect(res, appUrl(context, "denied")); // e.g. the user said no
    const code = q.get("code");
    if (!code) throw new HttpError(400, "no_code", "Procore didn't send a sign-in code. Start again.");
    try {
      saveSession(res, cfg, await exchangeCode(cfg, code));
    } catch (err) {
      console.error("Procore token exchange failed:", err?.status ?? err?.name ?? "Error");
      return redirect(res, appUrl(context, "error"));
    }
    redirect(res, appUrl(context, "connected"));
  } catch (err) {
    sendError(res, err);
  }
}
