// My items on the phone (sitesnap-report-picker-my-items-spec.md, section 6): the list from GET /api/procore/my-items,
// kept about a minute per project. The home badge reads the same answer, so its count always matches the list.
export const MY_ITEMS_TTL_MS = 60_000;
const cache = new Map(); // projectKey -> { at, value }

const keyOf = (project) => `${project.companyId}_${project.projectId}`;
const ids = (project) => ({ companyId: project.companyId, projectId: project.projectId });

/** { groups, counts, today, tools } or throws an Error with a plain message (status on it) */
export async function loadMyItems(project, { force = false, now = Date.now() } = {}) {
  const hit = cache.get(keyOf(project));
  if (!force && hit && now - hit.at < MY_ITEMS_TTL_MS) return hit.value;
  const r = await fetch(`/api/procore/my-items?${new URLSearchParams(ids(project))}`, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message ?? "Couldn't load your items. Check your signal and try again."), { status: r.status });
  cache.set(keyOf(project), { at: now, value: body });
  return body;
}

/** After Mark fixed: drop the saved list so the next look reads Procore again */
export const forgetMyItems = (project) => cache.delete(keyOf(project));

export async function loadItem(project, type, id) {
  const r = await fetch(`/api/procore/my-items?${new URLSearchParams({ ...ids(project), type, id })}`, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message ?? "Couldn't load this item. Try again."), { status: r.status });
  return body.item;
}
