// What the signed-in person can use on one project, tool by tool (sitesnap-report-picker-my-items-spec.md, section 4).
// SiteSnap acts as the signed-in Procore user, so Procore refuses whatever their permission template doesn't allow.
//
// Two sources, best first:
// 1. GET /rest/v1.0/settings/permissions?project_id= (Procore-Company-Id header): the caller's own permission
//    manifest, { tools: [{ name, available_for_user, can_create, user_access_level: { id, name }, ... }] }.
//    Seen in the sandbox 2026-10-17 (Edward, admin, 4 projects): 200 everywhere. It lists ONLY the tools turned on
//    for that project (the demo projects have no rfi / change_events), so a tool missing from a 200 answer is
//    denied without a probe. can_create comes only on some tools (observations, punch_list, rfi, change_events,
//    submittal_log); elsewhere it's absent (null). Names confirmed: checklists, observations, punch_list, daily_log,
//    images, directory, rfi, change_events. Not seen yet: Incidents (off on every sandbox project), so it's probed.
// 2. A one-row read per tool (page size 1). 2xx = can see it; 401/403 = denied; anything else (404, 5xx, no
//    signal) = unknown, which never hides anything. A read can't tell Read Only from Standard, so canCreate is null.
// A failed probe is never an error for the app: unknown means "show it and let Procore decide at Send".

export const TOOLS = ["observations", "punch_list", "rfis", "change_events", "daily_log", "incidents", "inspections", "directory", "photos"];

// Manifest tool names for each of ours (confirmed in the sandbox 2026-10-17 except incidents)
export const MANIFEST_NAMES = {
  observations: ["observations"],
  punch_list: ["punch_list"],
  rfis: ["rfi"],
  change_events: ["change_events"],
  daily_log: ["daily_log"],
  incidents: ["incidents", "incident"],
  inspections: ["checklists"],
  directory: ["directory"],
  photos: ["images"],
};
// Tools whose manifest name is confirmed: missing from a 200 answer = turned off / no access, no probe needed
export const CONFIRMED_NAMES = new Set(["observations", "punch_list", "rfis", "change_events", "daily_log", "inspections", "directory", "photos"]);

/** The one-row read for each tool: [path, query]. Paths already confirmed in the sandbox are marked. */
export function probeRequest(tool, { projectId, today }) {
  const p = projectId;
  switch (tool) {
    case "observations": return [`/rest/v1.0/observations/items`, { project_id: p, per_page: 1 }]; // confirmed 2026-10-14
    case "punch_list": return [`/rest/v1.1/punch_items`, { project_id: p, per_page: 1 }]; // confirmed 2026-10-14
    case "rfis": return [`/rest/v1.0/projects/${p}/rfis`, { per_page: 1 }]; // not yet seen in the sandbox
    case "change_events": return [`/rest/v1.0/change_events`, { project_id: p, per_page: 1 }]; // not yet seen
    // A UTC "today" can be tomorrow on the project's clock, which Procore answers 422; yesterday is always valid
    case "daily_log": return [`/rest/v1.0/projects/${p}/manpower_logs`, { log_date: dayBefore(today) }];
    case "incidents": return [`/rest/v1.0/projects/${p}/incidents`, { per_page: 1 }]; // not yet seen
    case "inspections": return [`/rest/v1.0/projects/${p}/checklist/lists`, { per_page: 1 }]; // confirmed 2026-10-16
    case "directory": return [`/rest/v1.0/projects/${p}/users`, { per_page: 1 }]; // confirmed
    case "photos": return [`/rest/v1.0/image_categories`, { project_id: p, per_page: 1 }]; // confirmed 2026-10-15
    default: throw new Error(`unknown tool ${tool}`);
  }
}

const dayBefore = (d) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** A probe's HTTP status as a state: available | denied | unknown */
export function stateOf(status) {
  if (status >= 200 && status < 300) return "available";
  if (status === 401 || status === 403) return "denied";
  return "unknown";
}

/** The manifest's entry for one of our tools, or null */
export function manifestEntry(json, tool) {
  const list = Array.isArray(json?.tools) ? json.tools : Array.isArray(json) ? json : null;
  if (!list) return null;
  for (const name of MANIFEST_NAMES[tool] ?? []) {
    const hit = list.find((t) => String(t?.name ?? "").toLowerCase() === name);
    if (hit) return hit;
  }
  return null;
}

/** One tool from a manifest entry: { state, canCreate, level, source } */
export function fromManifest(entry) {
  const levelName = entry?.user_access_level?.name ?? null;
  const levelId = Number(entry?.user_access_level?.id);
  const none = levelId === 1 || /^none$/i.test(String(levelName ?? ""));
  const state = entry?.available_for_user === false || none ? "denied" : "available";
  const canCreate = typeof entry?.can_create === "boolean" ? (state === "denied" ? false : entry.can_create) : null;
  return { state, canCreate, level: levelName, source: "manifest" };
}

/**
 * Every tool's state for one project. send(path, query) -> { status, json } (never throws for a Procore answer;
 * a thrown error = no signal). Probes only the tools the manifest didn't cover, three at a time (Procore allows
 * ~25 calls per 10 s).
 */
export async function probeAll(send, { projectId, today }) {
  const tools = {};
  let manifest;
  try {
    const m = await send("/rest/v1.0/settings/permissions", { project_id: projectId });
    manifest = { status: m.status };
    if (m.status >= 200 && m.status < 300) {
      for (const tool of TOOLS) {
        const entry = manifestEntry(m.json, tool);
        if (entry) tools[tool] = fromManifest(entry);
        else if (CONFIRMED_NAMES.has(tool)) tools[tool] = { state: "denied", canCreate: false, level: null, source: "manifest" }; // not on for this project
      }
    }
  } catch (err) { if (err?.status) throw err; manifest = { status: 0 }; } // HttpError = signed out / demo refusal

  const left = TOOLS.filter((t) => !tools[t]);
  for (let i = 0; i < left.length; i += 3) {
    await Promise.all(left.slice(i, i + 3).map(async (tool) => {
      const [path, query] = probeRequest(tool, { projectId, today });
      try {
        const r = await send(path, query);
        tools[tool] = { state: stateOf(r.status), canCreate: null, level: null, source: "probe", status: r.status };
      } catch (err) {
        if (err?.status) throw err;
        tools[tool] = { state: "unknown", canCreate: null, level: null, source: "probe", status: 0 };
      }
    }));
  }
  return { tools, manifest };
}
