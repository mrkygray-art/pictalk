// GET /api/procore/capabilities?companyId=&projectId= : which Procore tools the signed-in person can use on this
// project (sitesnap-report-picker-my-items-spec.md, section 4), with their own sign-in, reads only:
// { tools: { observations: { state: available|denied|unknown, canCreate: true|false|null, level, source }, ... },
//   manifest: { status } }. How each tool is decided: api/_capabilities.js. The phone keeps the answer per project
// for the session (src/messaging/capabilities.js); a guest demo session gets the same reads (GETs on its projects).
import { config, HttpError, procoreId, queryOf, sendError, sendJson } from "../_procore.js";
import { procoreSend } from "../_procoreWrite.js";
import { probeAll } from "../_capabilities.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "bad_request", "Use GET.");
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    const projectId = procoreId(q.get("projectId"));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    const send = (path, query) => procoreSend(req, res, cfg, "GET", path, { companyId, query });
    const today = new Date().toISOString().slice(0, 10);
    const out = await probeAll(send, { projectId, today });
    console.log("SiteSnap capabilities", JSON.stringify({ projectId, manifest: out.manifest.status, tools: Object.fromEntries(Object.entries(out.tools).map(([k, v]) => [k, `${v.state}/${v.canCreate}/${v.source}${v.status ? `:${v.status}` : ""}`])) }));
    res.setHeader("Cache-Control", "private, no-store");
    sendJson(res, 200, out);
  } catch (err) {
    sendError(res, err);
  }
}
