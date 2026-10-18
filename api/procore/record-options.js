// GET /api/procore/record-options?companyId=&projectId= : the project's own lists for the confirmation
// card and the classifier: Observation types (each company sets its own), trades, and locations.
// Read-only, with the signed-in person's Procore sign-in. People come from /api/procore/directory.
//   GET /rest/v1.0/projects/{project_id}/observation_types
//   GET /rest/v1.0/companies/{company_id}/trades
//   GET /rest/v1.0/projects/{project_id}/locations   (paged)
// fullLoopDemo: demo mode is on (FULL_LOOP_DEMO, api/_fullLoop.js) for this person (never the owner) and this is a
// demo project, so the card makes Observations only (spec phase 1) and needs an assignee.
import { config, HttpError, procoreId, queryOf, sendError, sendJson, session } from "../_procore.js";
import { allPages } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { fullLoopSettings, limited } from "../_fullLoop.js";

const list = (r) => (r.ok && Array.isArray(r.json) ? r.json : []);

export default async function handler(req, res) {
  try {
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    const projectId = procoreId(q.get("projectId"));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    const types = await procoreSend(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/observation_types`, { companyId });
    if (types.status === 401) throw new HttpError(401, "not_connected", "Connect Procore again.");
    const trades = await procoreSend(req, res, cfg, "GET", `/rest/v1.0/companies/${companyId}/trades`, { companyId });
    // Say why the list is empty: Procore refused it (permission) vs. the company has none set up
    if (!trades.ok) console.log("SiteSnap record options: trades not readable", trades.status);
    let locations = [];
    try {
      locations = await allPages(req, res, cfg, `/rest/v1.0/projects/${projectId}/locations`, { companyId, query: {} });
    } catch (err) {
      if (err?.status !== 403 && err?.status !== 404) throw err; // no Locations access: free text still works
    }
    sendJson(res, 200, {
      observationTypes: list(types).filter((t) => t.active !== false).map((t) => ({ id: t.id, name: t.name, category: t.category ?? null })),
      trades: list(trades).filter((t) => t.active !== false).map((t) => ({ id: t.id, name: t.name })),
      locations: locations.slice(0, 500).map((l) => ({ id: l.id, name: l.node_name || l.name })),
      canObservations: types.ok,
      tradesReadable: trades.ok,
      fullLoopDemo: fullLoopSettings().projectIds.includes(projectId) && await limited(req, cfg, await session(req, res, cfg)),
    });
  } catch (err) {
    sendError(res, err);
  }
}
