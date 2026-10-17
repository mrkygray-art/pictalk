// GET /api/procore/me?companyId= : the signed-in Procore user's name and email.
// Procore only returns the name when a company_id (or project_id) is given, and then the
// Procore-Company-Id header is required.
import { config, procoreGet, procoreId, queryOf, sendError, sendJson } from "../_procore.js";

export default async function handler(req, res) {
  try {
    const cfg = config();
    const companyId = procoreId(queryOf(req).get("companyId"));
    const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", companyId ? { companyId, query: { company_id: companyId } } : {});
    if (req.demoGuest) return sendJson(res, 200, { name: "Guest", email: null }); // never the demo guest's real name or email
    sendJson(res, 200, { name: me.name ?? null, email: me.login ?? null });
  } catch (err) {
    sendError(res, err);
  }
}
