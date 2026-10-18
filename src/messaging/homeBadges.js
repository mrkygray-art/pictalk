// The home tiles' counts (sitesnap-report-picker-my-items-spec.md, section 3): read when the home screen shows,
// kept about a minute per project so going back and forth doesn't call Procore each time. A count that can't be
// read is simply not shown.
//   Inspection: open inspections where I'm an inspector (the Inspections list's "mine" group).
//   My items:   not built yet (Step 3); null until then.
import { useEffect, useState } from "react";

export const BADGE_TTL_MS = 60_000;
const cache = new Map(); // projectKey -> { at, value }

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
  if (!force && hit && now - hit.at < BADGE_TTL_MS) return hit.value;
  const [inspections] = await Promise.all([readInspections(project).catch(() => null)]);
  const value = { inspections, myItems: null };
  cache.set(key, { at: now, value });
  return value;
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
