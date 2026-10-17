// GET /api/procore/directory?companyId=&projectId= : read-only list of the project's active users
// (Procore "List Project Users", GET /rest/v1.0/projects/{project_id}/users, Procore-Company-Id
// header required). Returns name, company (vendor), and role: the project team's Project Role, else
// the job title, else the permission template, else a tag a PM set in SiteSnap (api/_responsibilities.js).
// Also says whether the signed-in person may tag (a Project Manager / Executive on this project).
// Users without Directory read access get Procore's compact view, which has no title or template
// (reported as compact: true). People come back without email or phone; those stay on the server.
// ?shape=1 (diagnostic): the first page's field names and how many people have each one filled
// in, never the values, so we can see where title / company / role live in a real project.
import { config, HttpError, procoreGet, procoreId, queryOf, sendError, sendJson } from "../_procore.js";
import { canTag, LABELS, person, projectRoles, readTags } from "../_responsibilities.js";

const PER_PAGE = 100;
const MAX_PAGES = 20; // up to 2,000 people


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
    // One Procore call after another (a token refresh replaces the refresh token)
    const users = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = await procoreGet(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, {
          companyId, query: { page, per_page: PER_PAGE },
        });
        if (!Array.isArray(batch)) break;
        users.push(...batch);
        if (batch.length < PER_PAGE) break;
      }
    } catch (err) {
      if (err?.status === 403) throw new HttpError(403, "no_directory", "You don't have access to this project's directory in Procore.");
      throw err;
    }
    // Procore's compact view (no Directory read permission) has names and companies but no titles
    const compact = users.length > 0 && users.every((u) => !("job_title" in (u ?? {})) && !("email_address" in (u ?? {})));
    const { roles, available: rolesAvailable } = await projectRoles(req, res, cfg, companyId, projectId);
    const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
    // Tags are extra: if SiteSnap's Firestore isn't reachable, the list still shows
    let tags = new Map();
    let tagsAvailable = true;
    try {
      tags = await readTags(companyId, projectId);
    } catch (err) {
      tagsAvailable = false;
      console.error("Responsibility tags unavailable:", err?.code ?? err?.name ?? "Error");
    }
    sendJson(res, 200, {
      // a demo visitor never sees the demo guest's own entry (name, email)
      people: users.filter((u) => !req.demoGuest || String(u?.id) !== req.demoGuest.userId).map((u) => person(u, roles, tags)),
      rolesAvailable,
      tagsAvailable,
      compact,
      canTag: tagsAvailable && canTag(roles, me?.id),
      labels: LABELS,
    });
  } catch (err) {
    sendError(res, err);
  }
}
