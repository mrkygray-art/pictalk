// Sample My items for the guest demo (Ky, 2026-10-17): a few Observations and Punch Items in each demo project,
// assigned to the view-only guest, so a visitor's My items tile and list have something to show. Created with the
// owner's own Procore sign-in from /admin/demo-authorize ("Add My Items Samples"); titles carry [SS-DEMO], so the
// demo staging page's Reset clears them too, and "Remove My Items Samples" deletes just these.
// Each project gets one overdue item, one open item and one Ready for review item. Everything here is made up.
// Runs again safely: a sample whose title is already on the project (assigned to the guest) is skipped.
import { procoreSend } from "./_procoreWrite.js";
import { observationBody, punchBody } from "./_records.js";
import { updateBody } from "./_recordStatus.js";
import { pickObservationType, withTag } from "./_demoScenarios.js";
import { PATHS } from "./_myItems.js";

// due: days from today (negative = overdue). ready: moved to Ready for review after it's made.
const item = (recordType, title, due, priority, reporter, description, typeHints = ["quality"], ready = false) => ({ recordType, title, due, priority, reporter, description, typeHints, ready });
export const MY_ITEMS_SAMPLES = {
  HP: [
    item("observation", "Recheck anchor bolt layout at column C-4 before the pour", -2, "high", "Marcus Ortega",
      "Two anchor bolts at C-4 look about an inch off the layout. The pour is scheduled; someone needs to measure against the drawing."),
    item("observation", "Silt fence torn along the west property line", 4, "medium", "Dana Whitfield",
      "About 20 feet of silt fence is down after the excavator turned around. Rain is forecast this week.", ["environmental", "quality"]),
    item("observation", "Survey stakes knocked over near the north footing", null, "low", "Marcus Ortega",
      "Grade stakes at the north footing were run over. Reset and re-shot by the surveyor.", ["quality"], true),
  ],
  WG: [
    item("observation", "Duct hanger missing at gridline 7, duct sagging over corridor", -3, "high", "Marcus Ortega",
      "One trapeze hanger is missing and the main duct sags about two inches over the corridor. Needs to be fixed before drywall closes it in."),
    item("punch_item", "Seal the fire-rated wall penetration at Room 112", 5, "medium", "Dana Whitfield",
      "Conduit penetration through the rated wall at Room 112 still needs firestop sealant before inspection."),
    item("punch_item", "Relabel conduit runs in Electrical Room B", null, "low", "Dana Whitfield",
      "Labels on three conduit runs don't match the panel schedule. Relabeled to match.", ["quality"], true),
  ],
  LV: [
    item("punch_item", "Replace stained ceiling tile above Classroom 14", -2, "medium", "Priya Raman",
      "Two ceiling tiles above the door in Classroom 14 have water stains from the old roof leak. Replace before the walkthrough."),
    item("punch_item", "Touch up paint on hallway door frames, east wing", 3, "low", "Priya Raman",
      "Scuffs and chips on four door frames in the east wing hallway from furniture move-in."),
    item("observation", "Exit sign out above the gym's north doors", null, "high", "Priya Raman",
      "The exit sign above the north gym doors doesn't light up. Replaced the battery pack; works on test.", ["safety", "quality"], true),
  ],
};

const addDays = (today, n) => (n == null ? null : new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10));

/** The Procore request that makes one sample (pure: tests check it) */
export function sampleBody(s, { projectId, guestUserId, observationTypeId, today }) {
  const card = {
    recordType: s.recordType, title: withTag(s.title), description: s.description, transcript: "", observationTypeId,
    tradeId: null, locationId: null, locationText: null, priority: s.priority, assigneeIds: [Number(guestUserId)],
    dueDate: addDays(today, s.due), impactMentioned: false,
  };
  const body = s.recordType === "observation" ? observationBody(card, projectId, { reporterName: s.reporter }) : punchBody(card, projectId, { reporterName: s.reporter });
  return { path: s.recordType === "observation" ? PATHS.observations : PATHS.punch, body };
}

const listOf = (r) => (Array.isArray(r.json) ? r.json : []);
const why = (r) => {
  const e = r.json?.errors ?? r.json?.message ?? r.json?.error;
  return typeof e === "string" ? e.slice(0, 200) : e ? JSON.stringify(e).slice(0, 200) : `HTTP ${r.status}`;
};

// The samples already on one project (by exact title)
async function existing(send, projectId) {
  const titles = new Set(Object.values(MY_ITEMS_SAMPLES).flat().map((s) => withTag(s.title)));
  const found = [];
  for (const [type, path] of [["observation", PATHS.observations], ["punch_item", PATHS.punch]]) {
    for (let page = 1; page <= 5; page++) {
      const r = await send("GET", path, { query: { project_id: projectId, per_page: 100, page } });
      const rows = listOf(r);
      for (const x of rows) if (titles.has(String(x.name ?? "").trim())) found.push({ type, id: x.id, title: String(x.name).trim() });
      if (rows.length < 100) break;
    }
  }
  return found;
}

/**
 * Add the samples to every demo project the guest can open. projects: [{ code, companyId, projectId }].
 * Returns one line per sample: { code, title, ok, detail }.
 */
export async function addMyItemsSamples(req, res, cfg, { projects, guestUserId, today }) {
  const lines = [];
  for (const { code, companyId, projectId } of projects) {
    const send = (method, path, opts = {}) => procoreSend(req, res, cfg, method, path, { companyId, ...opts });
    const have = new Set((await existing(send, projectId)).map((x) => x.title));
    const typesR = await send("GET", `/rest/v1.0/projects/${projectId}/observation_types`);
    const types = listOf(typesR);
    for (const s of MY_ITEMS_SAMPLES[code] ?? []) {
      const line = { code, title: s.title };
      if (have.has(withTag(s.title))) { lines.push({ ...line, ok: true, detail: "already there" }); continue; }
      const typeId = s.recordType === "observation" ? pickObservationType(types, s.typeHints)?.id ?? null : null;
      if (s.recordType === "observation" && !typeId) { lines.push({ ...line, ok: false, detail: `no Observation types on this project (${typesR.status})` }); continue; }
      const { path, body } = sampleBody(s, { projectId, guestUserId, observationTypeId: typeId, today });
      const made = await send("POST", path, { body });
      if (!made.ok || made.json?.id == null) {
        lines.push({ ...line, ok: false, detail: `Procore refused it (${made.status}): ${why(made)}. If it names the assignee, the guest's permission template can't receive ${s.recordType === "observation" ? "Observations" : "Punch Items"} on this project.` });
        continue;
      }
      let detail = `${s.recordType === "observation" ? "Observation" : "Punch Item"} #${made.json.number ?? made.json.position ?? made.json.id}`;
      if (s.ready) {
        const { path: p, body: b } = updateBody(s.recordType, "done", projectId);
        const moved = await send("PATCH", `${p}/${made.json.id}`, { body: b });
        detail += moved.ok ? ", Ready for review" : `, but Procore wouldn't set Ready for review (${moved.status})`;
      }
      lines.push({ ...line, ok: true, detail: `made ${detail}` });
    }
  }
  return lines;
}

/** Delete just these samples (Procore allows deleting both kinds; checked 2026-10-15) */
export async function removeMyItemsSamples(req, res, cfg, { projects }) {
  let removed = 0;
  const failed = [];
  for (const { companyId, projectId } of projects) {
    const send = (method, path, opts = {}) => procoreSend(req, res, cfg, method, path, { companyId, ...opts });
    for (const x of await existing(send, projectId)) {
      const r = await send("DELETE", `${x.type === "observation" ? PATHS.observations : PATHS.punch}/${x.id}`, { query: { project_id: projectId } });
      if (r.ok) removed += 1; else failed.push(`${x.title} (${r.status})`);
    }
  }
  return { removed, failed };
}
