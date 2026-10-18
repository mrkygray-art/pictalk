// What the signed-in person can use on the picked project (sitesnap-report-picker-my-items-spec.md, section 4), from
// GET /api/procore/capabilities. Kept per project for the browser session (sessionStorage), asked again when the
// project changes or on refresh. A failed answer is never an error: every tool is then "unknown", which hides nothing.
// Also: the Report something picker's rows, which tiles show, and the "New" pill.
import { useCallback, useEffect, useState } from "react";

const KEY = (projectKey) => `sitesnap-capabilities:${projectKey}`;

// "New" pills on My items and the new picker rows: shown until this date, then gone (one place to change)
export const NEW_RELEASED = "2026-10-17";
export const NEW_DAYS = 30;
export function isNew(now = Date.now()) {
  return now < new Date(`${NEW_RELEASED}T00:00:00Z`).getTime() + NEW_DAYS * 86_400_000;
}

function readCached(projectKey) {
  try { return JSON.parse(sessionStorage.getItem(KEY(projectKey)) ?? "null"); } catch { return null; }
}
function writeCached(projectKey, value) {
  try { sessionStorage.setItem(KEY(projectKey), JSON.stringify(value)); } catch { /* private window: fine */ }
}

async function fetchTools(project) {
  try {
    const r = await fetch(`/api/procore/capabilities?${new URLSearchParams({ companyId: project.companyId, projectId: project.projectId })}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return {};
    const tools = (await r.json())?.tools ?? {};
    // Only keep an answer that knows something; an all-unknown one is asked again next time
    if (Object.values(tools).some((t) => t?.state !== "unknown")) writeCached(`${project.companyId}_${project.projectId}`, { tools, at: Date.now() });
    return tools;
  } catch {
    return {}; // no signal: unknown, nothing hidden
  }
}

/** { tools, refresh } for the project; tools = {} until known (every tool then counts as unknown) */
export function useCapabilities(project) {
  const projectKey = project ? `${project.companyId}_${project.projectId}` : null;
  const [fetched, setFetched] = useState({ key: null, tools: {} });
  const [asked, setAsked] = useState(0); // refresh(): ask Procore again
  const cached = projectKey ? readCached(projectKey) : null;

  useEffect(() => {
    if (!project || (cached && !asked)) return undefined;
    let live = true;
    const key = `${project.companyId}_${project.projectId}`;
    fetchTools(project).then((tools) => { if (live) setFetched({ key, tools }); });
    return () => { live = false; };
  }, [project, asked]); // eslint-disable-line react-hooks/exhaustive-deps -- cached is read fresh each render

  const tools = fetched.key === projectKey && (asked || !cached) ? fetched.tools : cached?.tools ?? {};
  const refresh = useCallback(() => {
    if (projectKey) { try { sessionStorage.removeItem(KEY(projectKey)); } catch { /* fine */ } }
    setAsked((n) => n + 1);
  }, [projectKey]);
  return { tools, refresh };
}

// A tool the person can't use: Procore said no to seeing it, or (from the permission list) to creating in it.
// Unknown never counts as a no.
export const cantSee = (tools, tool) => tools?.[tool]?.state === "denied";
export const cantCreate = (tools, tool) => cantSee(tools, tool) || tools?.[tool]?.canCreate === false;

// The picker's rows, in order. via = which Procore record it will make, given what's allowed (spec section 4 table).
// Message is SiteSnap's own feed, so it's always there as the fallback for Extra work and Question for the PM.
export const REPORT_TYPES = [
  { id: "issue", title: "Issue", subtitle: "Observation or punch item", isNew: false },
  { id: "safety", title: "Safety", subtitle: "Near miss or hazard", isNew: true },
  { id: "delay", title: "Delay", subtitle: "“I'm blocked”, with reason and hours lost", isNew: true },
  { id: "extra", title: "Extra work", subtitle: "Crew, hours, materials", isNew: true },
  { id: "question", title: "Question for the PM", subtitle: "Drafts an RFI for review", isNew: true },
];

/** How each type would be sent for this person (null = no usable path: the row is left out) */
export function routeFor(id, tools) {
  const obs = !cantCreate(tools, "observations");
  const punch = !cantCreate(tools, "punch_list");
  switch (id) {
    case "issue": return obs || punch ? "record" : null;
    case "safety": return obs ? "observation" : null;
    case "delay": return !cantCreate(tools, "daily_log") ? "daily_log" : obs ? "observation" : null;
    case "extra": return !cantCreate(tools, "change_events") ? "change_event" : "message";
    case "question": return !cantCreate(tools, "rfis") ? "rfi" : "message";
    default: return null;
  }
}

/**
 * The rows to show. ready = the types built so far (the rest stay out until their step lands). In the guest demo
 * every built row shows: the guest's template is view-only, and the send button explains that instead.
 */
export function pickerRows(tools, { demo = false, ready = [] } = {}) {
  return REPORT_TYPES
    .filter((t) => ready.includes(t.id))
    .map((t) => ({ ...t, via: demo ? "demo" : routeFor(t.id, tools) }))
    .filter((t) => t.via);
}

/** My items needs Observations or Punch List (either one is enough) */
export const showMyItems = (tools, { demo = false } = {}) => demo || !(cantSee(tools, "observations") && cantSee(tools, "punch_list"));
