// The home tiles' counts (sitesnap-report-picker-my-items-spec.md, section 3): read when the home screen shows,
// kept about a minute per project so going back and forth doesn't call Procore each time. A count that can't be
// read is simply not shown.
//   Inspection: open inspections where I'm an inspector (the Inspections list's "mine" group).
//   My items:   { open, overdue } from the same answer as the My items list (myItemsStore.js), so they always match.
import { useEffect, useState } from "react";
import { loadMyItems } from "./myItemsStore";

export const BADGE_TTL_MS = 60_000;
const cache = new Map(); // projectKey -> { at, inspections } (My items has its own, shared with the list)

async function readInspections(project) {
  const r = await fetch(`/api/procore/inspections?${new URLSearchParams({ companyId: project.companyId, projectId: project.projectId })}`, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const body = await r.json();
  if (!body?.access) return null;
  return (body.groups?.mine ?? []).filter((x) => !x.closed).length;
}

export async function loadBadges(project, { now = Date.now(), force = false } = {}) {
  const key = `${project.companyId}_${project.projectId}`;
  const hit = cache.get(key);
  const fresh = !force && hit && now - hit.at < BADGE_TTL_MS;
  const [inspections, mine] = await Promise.all([
    fresh ? hit.inspections : readInspections(project).catch(() => null),
    loadMyItems(project, { force, now }).catch(() => null),
  ]);
  if (!fresh) cache.set(key, { at: now, inspections });
  return { inspections, myItems: mine?.counts ?? null };
}

/** { inspections, myItems } for the project; refreshed each time `showing` turns true (home on screen) */
export function useHomeBadges(project, showing) {
  const key = project ? `${project.companyId}_${project.projectId}` : null;
  const [badges, setBadges] = useState({ key: null, value: null });
  useEffect(() => {
    if (!project || !showing) return undefined;
    let live = true;
    loadBadges(project).then((value) => { if (live) setBadges({ key, value }); }).catch(() => {});
    return () => { live = false; };
  }, [project, showing, key]);
  return badges.key === key ? badges.value : null;
}
