// The Procore projects the signed-in user can open, across their companies. Shared by
// GET /api/procore/projects (the picker) and POST /api/procore/session (who may read which feed).
// Checked against Procore's reference (2026-10-14):
//   GET /rest/v1.0/companies  "Returns companies visible to the current user" (no Procore-Company-Id needed)
//   GET /rest/v1.1/projects?company_id=  "Return a list of active Projects. If the authenticated user has
//     full company admin permissions the request will return all of the projects in the company. If the
//     user does not have full company admin permissions, the request will only return the projects that
//     the user has been added to." Default 100 per page, max 300; view=compact returns id and name.
// Calls run one after another: a token refresh replaces the refresh token, so two at once could clash.
import { demoCookie, procoreGet, session } from "./_procore.js";
import { demoProjectsOnly } from "./_fullLoop.js";

const PER_PAGE = 100;
const MAX_PAGES = 10;

export async function allPages(req, res, cfg, path, opts) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await procoreGet(req, res, cfg, path, { ...opts, query: { ...opts.query, page, per_page: PER_PAGE } });
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return out;
}

// { projects: [{ companyId, companyName, projectId, name }], companies, refused }
// A guest demo session (docs/guest-demo.md) gets only the allowlisted projects saved when Ky authorized the guest,
// with no Procore calls (every demo visitor shares the guest's rate limit).
export async function listProjects(req, res, cfg) {
  if (demoCookie(req, cfg.sessionSecret)) {
    await session(req, res, cfg); // checks the demo session, fills req.demoGuest
    const projects = req.demoGuest.projects.map((p) => ({ companyId: String(p.companyId), companyName: p.companyName ?? null, projectId: String(p.projectId), name: p.name }));
    return { projects, companies: new Set(projects.map((p) => p.companyId)).size, refused: 0 };
  }
  const companies = await allPages(req, res, cfg, "/rest/v1.0/companies", { query: {} });
  const projects = [];
  let refused = 0;
  for (const c of companies) {
    if (c?.id == null || c.is_active === false) continue;
    const companyId = String(c.id);
    try {
      const list = await allPages(req, res, cfg, "/rest/v1.1/projects", { companyId, query: { company_id: companyId, view: "compact" } });
      for (const p of list) {
        if (p?.id == null) continue;
        projects.push({ companyId, companyName: c.name ?? null, projectId: String(p.id), name: p.name || `Project ${p.id}` });
      }
    } catch (err) {
      // One company refusing (app not installed there, tool off) shouldn't hide the others
      if (err?.status === 403 || err?.status === 404) { refused++; continue; }
      throw err;
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId));
  // Full-loop demo mode on: the picker lists only the demo projects (api/_fullLoop.js)
  return { projects: await demoProjectsOnly(req, cfg, await session(req, res, cfg), projects), companies: companies.length, refused };
}

// Firestore key for a project: procoreProjects/{companyId}_{projectId}
export const projectKey = (p) => `${p.companyId}_${p.projectId}`;
