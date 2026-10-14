// GET /api/procore/directory?companyId=&projectId= : read-only list of the project's active users
// (Procore "List Project Users", GET /rest/v1.0/projects/{project_id}/users, Procore-Company-Id
// header required). Returns name, company (vendor), and role (job title, else permission template).
// Users without Directory read access get Procore's compact view, which has no title or template.
// ?shape=1 (diagnostic): the first page's field names and how many people have each one filled
// in, never the values, so we can see where title / company / role live in a real project.
import { config, HttpError, procoreGet, procoreId, queryOf, sendError, sendJson } from "../_procore.js";

const PER_PAGE = 100;
const MAX_PAGES = 20; // up to 2,000 people

export const person = (u) => ({
  id: u.id,
  name: u.name || [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
  company: u.vendor?.name ?? null,
  role: u.job_title || u.permission_template?.name || null,
});

// Field names (one level into objects, e.g. vendor.name) with a count of non-empty values. No values.
export function shapeOf(users) {
  const filled = {};
  const add = (path, v) => {
    filled[path] ??= 0;
    if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) filled[path]++;
  };
  for (const u of users) {
    for (const [k, v] of Object.entries(u ?? {})) {
      add(k, v);
      if (v && typeof v === "object" && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
    }
  }
  return { users: users.length, fields: Object.keys(filled).sort().map((path) => ({ path, filled: filled[path] })) };
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    const projectId = procoreId(q.get("projectId"));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "This link needs a Procore companyId and projectId.");
    if (q.get("shape") === "1") {
      const first = await procoreGet(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId, query: { page: 1, per_page: PER_PAGE } });
      return sendJson(res, 200, shapeOf(Array.isArray(first) ? first : []));
    }
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
