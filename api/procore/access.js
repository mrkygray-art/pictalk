// GET /api/procore/access?companyId=&projectId= : who on this project Procore will accept for a Punch Item or an
// Observation, and why not (no permission template, or a template with no access to that tool). Read only on
// Procore, with the signed-in person's own sign-in:
//   GET /rest/v1.0/projects/{p}/users                      (anyone on the project: each person's template)
//   GET /rest/v1.0/observations/assignees?project_id=      (anyone on the project: Procore's own list)
//   GET /rest/v1.0/companies/{c}/permission_templates/{id} (admins only: what each template allows)
// The template levels are saved per company (api/_access.js) when an admin opens the project, at most once a
// day, so everyone else gets them too. Answers ids, names of templates, yes/no/unknown and a reason; no emails.
import { config, HttpError, procoreId, queryOf, sendError, sendJson } from "../_procore.js";
import { allPages } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { accessFor, keepLevels, readSaved, STALE_MS, writeSaved } from "../_access.js";

export default async function handler(req, res) {
  try {
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    const projectId = procoreId(q.get("projectId"));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");

    // The project's people (Procore refuses anyone not on the project)
    let users;
    try {
      users = await allPages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId, query: {} });
    } catch (err) {
      if (err?.status === 403) throw new HttpError(403, "no_directory", "You don't have access to this project's people in Procore.");
      throw err;
    }

    const obs = await procoreSend(req, res, cfg, "GET", "/rest/v1.0/observations/assignees", { companyId, query: { project_id: projectId } });
    const observationIds = obs.ok && Array.isArray(obs.json) ? new Set(obs.json.map((u) => String(u.id))) : null;

    // What each template allows: the saved copy, refreshed when this person can read templates (admins)
    let saved = null;
    try { saved = await readSaved(companyId); } catch (err) { console.error("Saved permission levels unavailable:", err?.code ?? err?.name ?? "Error"); }
    const ids = [...new Set(users.map((u) => u.permission_template?.id).filter((x) => x != null).map(String))];
    const missing = ids.filter((id) => !saved?.templates?.[id]);
    if (ids.length && (missing.length || !saved?.at || Date.now() - saved.at > STALE_MS)) {
      const templates = { ...(saved?.templates ?? {}) };
      let readAny = false;
      for (const id of ids) {
        const r = await procoreSend(req, res, cfg, "GET", `/rest/v1.0/companies/${companyId}/permission_templates/${id}`, { companyId });
        if (r.status === 403 || r.status === 401) break; // not an admin: keep what's saved
        if (r.ok) { templates[id] = keepLevels(r.json); readAny = true; }
      }
      if (readAny) {
        saved = { templates, at: Date.now() };
        try { await writeSaved(companyId, saved); } catch (err) { console.error("Couldn't save permission levels:", err?.code ?? err?.name ?? "Error"); }
      }
    }

    const people = Object.fromEntries(users.map((u) => [String(u.id), accessFor(u, saved?.templates, observationIds)]));
    sendJson(res, 200, { people, levelsKnown: !!saved?.at, levelsAt: saved?.at ?? null, observationList: !!observationIds });
  } catch (err) {
    sendError(res, err);
  }
}
