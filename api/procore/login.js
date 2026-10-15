// GET /api/procore/login?companyId=&projectId= : starts Procore sign-in (top-level tab or popup
// only; Procore's login page won't load inside an iframe). Saves a random state in a short-lived
// httpOnly cookie, with the company / project to come back to, and redirects to Procore.
// ?fresh=1 ("Use a different Procore account") also asks Procore to show its login screen (prompt=login);
// Procore doesn't document it, so if it's ignored the sign-in screen says how to sign out of Procore first.
import { config, newState, procoreId, queryOf, redirect, sendError, setCookie, STATE_COOKIE } from "../_procore.js";

export default function handler(req, res) {
  try {
    const cfg = config();
    const q = queryOf(req);
    const { state, cookie, maxAge } = newState(cfg, { companyId: procoreId(q.get("companyId")), projectId: procoreId(q.get("projectId")) });
    setCookie(res, STATE_COOKIE, cookie, maxAge);
    const params = new URLSearchParams({ client_id: cfg.clientId, response_type: "code", redirect_uri: cfg.redirectUri, state });
    if (q.get("fresh") === "1") params.set("prompt", "login");
    redirect(res, `${cfg.loginUrl}/oauth/authorize?${params}`);
  } catch (err) {
    sendError(res, err);
  }
}
