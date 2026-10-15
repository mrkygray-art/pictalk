// Demo data for the Procore sandbox (Ky's sitesnap-demo-seed-and-reset.md, 2026-10-15): three demo projects at
// three construction stages, 12 fictional people, 15 scenarios (Observations and Punch Items), and the rules that
// keep seeding and reset safe. Plain data and functions, so tests check exactly what Procore would receive.
// Used only by api/procore/demo-staging.js (sandbox only, DEMO_MODE=true, admins only) and, for the [SS-DEMO]
// tag on live captures, by api/procore/records.js.
// Everything here is made up: names, companies, example.com emails, 555-01XX phones.

export const DEMO_TAG = "[SS-DEMO]";
export const ARCHIVED_TAG = "[SS-DEMO][ARCHIVED]";
export const STEPS = ["create", "photo", "assignee", "close", "thread"];
export const STEP_LABEL = { create: "create the record", photo: "attach the photo", assignee: "assign", close: "close it", thread: "write the SiteSnap thread" };

// ---------- settings (Vercel env) ----------

export const demoMode = (env = process.env) => String(env.DEMO_MODE ?? "").trim().toLowerCase() === "true";

/** DEMO_PROJECT_IDS = "HP:123,WG:456,LV:789" -> { HP: "123", ... }; null unless all three are whole numbers */
export function demoProjects(env = process.env) {
  const out = {};
  for (const part of String(env.DEMO_PROJECT_IDS ?? "").split(",")) {
    const [code, id] = part.split(/[:=]/).map((s) => String(s ?? "").trim());
    if (/^(HP|WG|LV)$/i.test(code) && /^\d{1,20}$/.test(id)) out[code.toUpperCase()] = id;
  }
  return out.HP && out.WG && out.LV && new Set(Object.values(out)).size === 3 ? out : null;
}

/** The project's code (HP / WG / LV) when it's an allowlisted demo project, else null */
export function demoCodeOf(projectId, env = process.env) {
  const p = demoProjects(env);
  if (!p) return null;
  return Object.keys(p).find((c) => p[c] === String(projectId)) ?? null;
}

export const batchSize = (env = process.env) => Math.min(Math.max(Number.parseInt(env.IMPORT_BATCH_SIZE, 10) || 3, 1), 6);
export const delayMs = (env = process.env) => Math.min(Math.max(Number.parseInt(env.IMPORT_DELAY_MS, 10) || 500, 0), 5000);

// ---------- titles ----------

export const isDemoTitle = (name) => String(name ?? "").trim().startsWith(DEMO_TAG);
export const isArchivedTitle = (name) => String(name ?? "").trim().startsWith(ARCHIVED_TAG);
export const withTag = (title) => (isDemoTitle(title) ? String(title) : `${DEMO_TAG} ${String(title ?? "").trim()}`);
export const archivedTitle = (name) => `${ARCHIVED_TAG} ${String(name ?? "").trim().replace(/^\[SS-DEMO\](\[ARCHIVED\])?\s*/, "")}`.slice(0, 255);

// ---------- projects and people ----------

export const PROJECTS = {
  HP: { name: "Harbor Point Medical Office", stage: "Early: sitework and foundation", shows: "Catching problems before they get buried under concrete or dirt" },
  WG: { name: "Westgate Distribution Center", stage: "Middle: rough-in (inside walls and ceilings)", shows: "Trades colliding, schedule risk, materials delays" },
  LV: { name: "Lakeview Elementary Modernization", stage: "Final: closeout and punch", shows: "Fixes needed before handover; safety and paperwork" },
};

// abbreviated_name: Procore allows 10 characters at most
const vendor = (name, abbreviated_name, phone, city, zip, notes) => ({
  name, abbreviated_name, business_phone: phone, address: "100 Demo Way", city, zip,
  email_address: `office@${abbreviated_name.toLowerCase().replace(/[^a-z]/g, "")}.example.com`, notes: `SiteSnap demo data: ${notes}`, labor_union: null,
});

export const DEMO_COMPANIES = {
  cornerstone: vendor("Cornerstone Builders", "Cornerstn", "(310) 555-0180", "Torrance", "90501", "general contractor"),
  bayline: vendor("Bayline Concrete", "Bayline", "(310) 555-0181", "Carson", "90745", "concrete"),
  pacific: vendor("Pacific Structural Inspections", "PSI", "(310) 555-0182", "Long Beach", "90802", "special inspections"),
  volt: vendor("Volt Line Electric", "Volt Line", "(310) 555-0183", "Hawthorne", "90250", "electrical"),
  summit: vendor("Summit Mechanical", "SummitMech", "(424) 555-0184", "El Segundo", "90245", "plumbing and fire sprinklers"),
  sentry: vendor("Sentry Low-Voltage Systems", "Sentry", "(424) 555-0185", "Gardena", "90248", "security cameras and access control"),
  cleanline: vendor("Clean Line Drywall", "Clean Line", "(323) 555-0186", "Compton", "90220", "drywall"),
  westgate: vendor("Westgate Logistics", "Westgate", "(562) 555-0187", "Ontario", "91761", "owner, Westgate Distribution Center"),
  lakeview: vendor("Lakeview School District", "LakeviewSD", "(562) 555-0188", "Lakewood", "90712", "owner, Lakeview Elementary"),
  finishpro: vendor("Finish Pro Painting", "Finish Pro", "(323) 555-0189", "Inglewood", "90301", "painting"),
};

// Permission templates by kind, best first (the first one the project has is used): the GC's people are
// Internal; trades and owners are External ("Owner" templates aren't in every company, so Subcontractor is
// the fallback).
const TEMPLATES = {
  pm: ["Project Manager - Internal"],
  super: ["Foreman / Superintendent - Internal"],
  sub: ["Subcontractor - External"],
  owner: ["Owner - External", "Owner", "Client - External", "Subcontractor - External"],
};

const person = (key, first, last, company, title, kind, projects, cell) => ({
  key, company, projects, templates: TEMPLATES[kind],
  first_name: first, last_name: last, email_address: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
  initials: `${first[0]}${last[0]}`, job_title: title, mobile_phone: cell,
  projectRole: kind === "pm" ? "Project Manager" : null, roleType: { pm: "PM", super: "GC", sub: "Worker", owner: "Owner" }[kind],
});

// "Mr. Alan Reese" in the spec: Procore has no honorific field, so he's Alan Reese.
export const DEMO_PEOPLE = [
  person("dana", "Dana", "Whitfield", "cornerstone", "Project Manager", "pm", ["HP", "WG", "LV"], "(310) 555-0190"),
  person("marcus", "Marcus", "Ortega", "cornerstone", "Superintendent", "super", ["HP", "WG"], "(310) 555-0191"),
  person("priya", "Priya", "Raman", "cornerstone", "Superintendent", "super", ["LV"], "(310) 555-0192"),
  person("luis", "Luis", "Herrera", "bayline", "Concrete Foreman", "sub", ["HP"], "(310) 555-0193"),
  person("tom", "Tom", "Becker", "pacific", "Special Inspector", "sub", ["HP"], "(310) 555-0194"),
  person("alicia", "Alicia", "Nguyen", "volt", "Electrical Foreman", "sub", ["HP", "WG", "LV"], "(310) 555-0195"),
  person("ray", "Ray", "Castillo", "summit", "Plumbing / Sprinkler Foreman", "sub", ["WG", "LV"], "(424) 555-0196"),
  person("jenna", "Jenna", "Park", "sentry", "Security Systems Foreman", "sub", ["HP", "WG", "LV"], "(424) 555-0197"),
  person("carlos", "Carlos", "Mendez", "cleanline", "Drywall Foreman", "sub", ["WG"], "(323) 555-0198"),
  person("hannah", "Hannah", "Brooks", "westgate", "Owner's Representative", "owner", ["WG"], "(562) 555-0199"),
  person("alan", "Alan", "Reese", "lakeview", "Facilities Director", "owner", ["LV"], "(562) 555-0170"),
  person("nikki", "Nikki", "Tran", "finishpro", "Painting Foreman", "sub", ["LV"], "(323) 555-0171"),
];
export const personByKey = (k) => DEMO_PEOPLE.find((p) => p.key === k);
export const fullName = (p) => `${p.first_name} ${p.last_name}`;
const demoEmails = new Set(DEMO_PEOPLE.map((p) => p.email_address));
const demoVendorNames = new Set(Object.values(DEMO_COMPANIES).map((v) => v.name.toLowerCase()));
export const isDemoEmail = (e) => demoEmails.has(String(e ?? "").trim().toLowerCase());
export const isDemoVendor = (name) => demoVendorNames.has(String(name ?? "").trim().toLowerCase());

/** One project's demo companies and people, in the shape the directory steps take ({ vendor, users }) */
export function directorySeed(code) {
  const people = DEMO_PEOPLE.filter((p) => p.projects.includes(code));
  const keys = [...new Set(people.map((p) => p.company))];
  return keys.map((k) => ({ key: k, vendor: DEMO_COMPANIES[k], users: people.filter((p) => p.company === k) }));
}

// ---------- scenarios ----------
// due: days from today (negative = past). planned: open | overdue | closed. assignee: who must act (Procore's
// assignee); tagged: everyone on the SiteSnap thread. speaker: the foreman talking into SiteSnap.
// typeHints: Observation types to look for, best first (the project's first active type otherwise).

const sc = (id, recordType, planned, priority, due, title, problem, cost, speaker, words, assignee, tagged, result, extra = {}) =>
  ({ id, project: id.slice(0, 2), recordType, planned, priority, due, title, problem, cost, speaker, words, assignee, tagged, result, ...extra });

export const SCENARIOS = [
  sc("HP-01", "observation", "open", "high", 1, "Steel bars in footing look spaced too wide",
    "Before concrete is poured, steel bars are placed inside it, like the skeleton in a body. These look spaced wider than the drawing says. The concrete truck is scheduled for tomorrow morning.",
    "Once concrete is poured, nobody can see inside. Fixing it later means breaking the concrete out with jackhammers: weeks of delay and tens of thousands of dollars. Catching it today costs 30 minutes.",
    "alicia", "Hey, I'm at the north footing and the rebar looks wider than the plan. Pour is tomorrow. Someone should check this before the trucks show up.",
    "luis", ["luis", "marcus", "tom"], "All three alerted within a minute. Visible as high priority, due tomorrow.", { typeHints: ["quality"] }),
  sc("HP-02", "observation", "open", "medium", 2, "Standing water in electrical trench, rain forecast",
    "A ditch for underground electrical pipes has filled with water, and more rain is coming.",
    "Mud and water wash into the pipes. Wires pulled later can fail or need replacing. Crews also lose days waiting for it to dry.",
    "alicia", "Trench along the east side has about six inches of standing water and the forecast says rain Thursday. We need a pump out there or a cover on it.",
    "marcus", ["marcus", "alicia"], "Superintendent sees it the same day and can send a pump before the rain.", { typeHints: ["environmental", "quality"] }),
  sc("HP-03", "observation", "closed", "high", -6, "Open trench next to public sidewalk, no barricade",
    "A deep trench sits next to a sidewalk where the public walks, with nothing blocking it off.",
    "Someone could fall in. Injury, lawsuit, work shutdown.",
    "luis", "North trench by the sidewalk has no barricade. Anyone walking by could step right in.",
    "marcus", ["marcus"], "Closed within 1 day: reported, fixed, closed.", { typeHints: ["safety"], closedDaysAgo: 5, closingComment: "Barricade and caution tape installed." }),
  sc("HP-04", "observation", "overdue", "high", -3, "No camera conduit at parking light pole, trench closing soon",
    "The plan calls for security cameras on the parking lot light poles, but the buried pipe that carries the camera cable isn't in the ground at pole #4. The crew is about to fill the trench back in.",
    "Adding it now = one extra pipe, about an hour. Adding it after the trench is filled and paved = cutting open the asphalt, about 10x the cost, and the parking lot has a blind spot until it's done.",
    "jenna", "At light pole four there's no conduit stubbed up for the camera. They're backfilling this week. Needs to go in before they close it.",
    "alicia", ["alicia", "marcus", "dana"], "Shows as overdue: the PM must push the follow-up.", { typeHints: ["work to complete", "quality"] }),

  sc("WG-01", "observation", "open", "high", 0, "Sprinkler pipe and camera cable tray in the same ceiling space",
    "Two crews planned to use the same strip of ceiling. The sprinkler pipe is already hung where the camera cable tray was supposed to go.",
    "Whoever installs second has to rip out and redo work. Two crews argue, the schedule slips, and the owner pays for rework.",
    "jenna", "Aisle C, the sprinkler main is hanging right where our cable tray goes. There's no room for both. Someone needs to decide who moves before we hang anything.",
    "ray", ["ray", "marcus", "dana"], "Both crews and the GC see the same photo and message, so nobody works around the other without knowing.", { typeHints: ["coordination", "quality"] }),
  sc("WG-02", "observation", "open", "high", 0, "Drywall crew starting Level 2 walls, electrical inspection not signed off",
    "Walls are about to be closed with drywall, but the inspector hasn't approved the wiring inside them yet.",
    "If the inspector fails the wiring, the new drywall must be cut open and rebuilt. That means paying for the work twice and delaying everything behind it.",
    "alicia", "Drywall is staged to start closing Level 2 tomorrow but our rough-in inspection hasn't been signed off yet. Do not close those walls.",
    "carlos", ["carlos", "marcus", "dana"], "The drywall foreman is told before he starts. One message prevents a day of wasted work.", { typeHints: ["quality"] }),
  sc("WG-03", "observation", "open", "medium", 4, "Door access controllers delayed, no delivery date",
    "The electronic door-lock hardware hasn't arrived and the supplier hasn't given a date. Testing the doors can't happen until it does.",
    "The building can't pass final inspection without working doors. A late discovery delays the opening date, and the owner is paying for an empty warehouse.",
    "jenna", "Still no ship date on the door controllers from the supplier. Without them we can't test the access doors. I need someone to push the supplier or we need an alternate.",
    "dana", ["dana", "hannah"], "The owner's rep sees the risk early instead of hearing about it at the end.", { typeHints: ["commissioning", "quality"] }),
  sc("WG-04", "punch_item", "overdue", "high", -5, "Missing fire sealant around pipe through fire wall",
    "Where a pipe passes through a fire-rated wall, the gap must be sealed with special fire-resistant material. This one is empty.",
    "In a fire, that gap lets flames and smoke through, defeating the wall. The inspector will fail the building until it's sealed.",
    "ray", "Fire wall at gridline B, the pipe penetration has no fire caulk. That has to be sealed before inspection.",
    "ray", ["ray", "marcus", "dana"], "Punch Item assigned with a due date. Shows as overdue so the PM can chase it."),
  sc("WG-05", "observation", "closed", "high", -2, "Ladder blocking emergency exit route",
    "A ladder was left in the walkway leading to an emergency exit.",
    "People could trip or be blocked while evacuating.",
    "carlos", "Ladder is laying across the walkway by the east exit.",
    "marcus", ["marcus"], "Closed the same day.", { typeHints: ["safety"], closedDaysAgo: 2, closingComment: "Ladder removed, walkway clear." }),

  sc("LV-01", "punch_item", "open", "high", 2, "Room 104 classroom door will not latch",
    "The new electronic lock on a classroom door doesn't catch, so the door can't be locked from inside.",
    "In a lockdown, teachers must be able to secure the room. A classroom that can't lock is a safety failure, and the district won't accept the building.",
    "jenna", "Room 104 door isn't latching. The strike plate is misaligned. Teacher can't secure the room. We need to fix that before the walkthrough.",
    "jenna", ["jenna", "priya", "alan"], "The district sees that safety items are being tracked, which builds confidence in the contractor."),
  sc("LV-02", "punch_item", "open", "medium", 3, "Entrance camera aimed at ceiling, cannot see faces",
    "The main entrance camera is pointed up and sees mostly ceiling and glare, not people's faces.",
    "The school paid for entrance security that doesn't record who walks in. Re-aiming takes 10 minutes now; after handover it becomes a service call.",
    "jenna", "Front entry camera is tilted too high. It's mostly seeing the ceiling and the sun glare off the glass. Needs re-aiming.",
    "jenna", ["jenna", "priya"], "A small, quick fix; shows low-effort items don't get lost."),
  sc("LV-03", "observation", "open", "high", 1, "Water stain on new hallway ceiling tile",
    "A brand-new ceiling tile has a brown water stain, meaning something above it may be leaking.",
    "A hidden leak grows mold, ruins insulation and ceilings, and may void warranties. Found now, it's a pipe fitting; found next winter, it's a lawsuit with the school district.",
    "nikki", "Hallway B, there's a fresh water stain on the ceiling tile right outside the library. It's new, so something's leaking above it.",
    "ray", ["ray", "priya", "alan"], "An Observation that may become a Punch Item once plumbing finds the cause.", { typeHints: ["warranty", "quality"] }),
  sc("LV-04", "punch_item", "overdue", "medium", -10, "Missing manuals and as-built drawings for intercom system",
    "The owner must receive instruction manuals and drawings showing what was actually installed. They haven't been delivered.",
    "The school can't maintain or fix the system, and final payment to the contractor can be held until the paperwork is complete.",
    "jenna", "Still need to turn in the intercom manuals and the as-built drawings. I'll get them done but the district hasn't gotten them yet.",
    "jenna", ["jenna", "dana"], "Sits in the overdue list so the PM can see it's blocking final payment."),
  sc("LV-05", "punch_item", "closed", "high", -3, "Exit sign over east stairwell not lit",
    "The glowing EXIT sign above the stairwell door was dark.",
    "In a fire or power outage, people can't find the exit. It's an automatic inspection fail.",
    "alicia", "East stairwell exit sign is dark. Probably a loose connection.",
    "alicia", ["alicia"], "Closed.", { closedDaysAgo: 3, closingComment: "Reconnected, lit, tested on battery backup." }),
  sc("LV-06", "punch_item", "closed", "low", -1, "Paint scuff on hallway wall near Room 110",
    "A cosmetic scratch in the new paint.",
    "Nothing dangerous, but it shows on the owner's walkthrough list.",
    "nikki", "Scuff on the wall by 110, I'll touch it up.",
    "nikki", ["nikki"], "Closed. SiteSnap handles small things too, not just emergencies.", { closedDaysAgo: 1, closingComment: "Touched up." }),
];
export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id) ?? null;

/** Open / overdue / closed per project, as seeded (overdue counts within open) */
export function plannedShape() {
  const out = {};
  for (const code of Object.keys(PROJECTS)) {
    const list = SCENARIOS.filter((s) => s.project === code);
    out[code] = { open: list.filter((s) => s.planned !== "closed").length, overdue: list.filter((s) => s.planned === "overdue").length, closed: list.filter((s) => s.planned === "closed").length };
  }
  return out;
}

// ---------- dates (relative to "today" on the West Coast, where the demo runs) ----------

export function today(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- what Procore receives ----------

/** The record's card (api/_records.js builds the request from it): tagged title, plain-English description, words */
export function cardFor(s, { observationTypeId = null, assigneeIds = [], now = Date.now() } = {}) {
  return {
    recordType: s.recordType,
    title: withTag(s.title),
    description: `${s.problem} If nobody catches it: ${s.cost}`,
    transcript: s.words,
    observationTypeId,
    tradeId: null, locationId: null, locationText: null,
    priority: s.priority,
    assigneeIds,
    dueDate: addDays(today(now), s.due),
    impactMentioned: false,
  };
}

/** The Observation type for a scenario: the first hint the project has (by name), else its first active type */
export function pickObservationType(types, hints = []) {
  const active = (types ?? []).filter((t) => t && t.active !== false);
  for (const h of hints) {
    const hit = active.find((t) => String(t.name ?? "").toLowerCase().includes(h));
    if (hit) return hit;
  }
  return active[0] ?? null;
}

// ---------- import status (one row per scenario, kept in Firestore) ----------
// import_status: not_imported | imported | failed | partial. steps_completed: which of STEPS are done.

export const stepsFor = (s) => STEPS.filter((st) => st !== "close" || s.planned === "closed");

export function statusFrom(s, row) {
  const need = stepsFor(s);
  const done = new Set(row?.steps_completed ?? []);
  if (need.every((st) => done.has(st))) return "imported";
  if (row?.procore_id) return "partial";
  return row?.last_error ? "failed" : "not_imported";
}

/** "Step 3 of 5 failed: could not assign Jenna Park (not in the project directory)" */
export function stepError(s, step, why) {
  const need = stepsFor(s);
  const n = need.indexOf(step) + 1;
  return `Step ${n || "?"} of ${need.length} failed (${STEP_LABEL[step] ?? step}): ${String(why ?? "").slice(0, 240)}`;
}

/** Plain text for the Copy for Claude button: every row not fully imported */
export function copyForClaude(rows, { at = Date.now(), lastRun = null } = {}) {
  const left = rows.filter((r) => r.import_status !== "imported");
  const lines = [`SiteSnap demo import, ${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC${lastRun ? `; last import run ${new Date(lastRun).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`];
  if (!left.length) return `${lines[0]}\nAll ${rows.length} scenarios imported.`;
  lines.push(`${left.length} of ${rows.length} not fully imported:`);
  for (const r of left) {
    const s = scenarioById(r.id);
    const done = (r.steps_completed ?? []).join(", ") || "none";
    lines.push(`- ${r.id} (${r.import_status}) ${s?.title ?? ""}${r.procore_id ? ` · Procore ${r.procore_id}` : ""} · steps done: ${done}${r.last_error ? ` · ${r.last_error}` : ""}`);
  }
  return lines.join("\n");
}
