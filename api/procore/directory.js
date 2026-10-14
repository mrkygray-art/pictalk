// GET /api/procore/directory?companyId=&projectId= : read-only list of the project's active users
// (Procore "List Project Users", GET /rest/v1.0/projects/{project_id}/users, Procore-Company-Id
// header required). Returns name, company (vendor), and role (job title, else permission template).
// Users without Directory read access get Procore's compact view, which has no title or template.
import { config, HttpError, procoreGet, procoreId, queryOf, sendError, sendJson } from "../_procore.js";

const PER_PAGE = 100;
const MAX_PAGES = 20; // up to 2,000 people

export const person = (u) => ({
  id: u.id,
  name: u.name || [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
  company: u.vendor?.name ?? null,
  role: u.job_title || u.permission_template?.name || null,
});

export default async function handler(req, res) {
  try {
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    const projectId = procoreId(q.get("projectId"));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "This link needs a Procore companyId and projectId.");
    const people = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await procoreGet(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, {
        companyId, query: { page, per_page: PER_PAGE },
      });
      if (!Array.isArray(batch)) break;
      people.push(...batch.map(person));
      if (batch.length < PER_PAGE) break;
    }
    sendJson(res, 200, { people });
  } catch (err) {
    sendError(res, err);
  }
}
