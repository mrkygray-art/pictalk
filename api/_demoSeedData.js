// The sandbox demo seed (Ky's procore-sandbox-demo-seed.md, 2026-10-18): a second demo set that lives alongside the
// demo staging one (api/_demoScenarios.js). 5 companies, 22 people plus Ky (the signed-in PM), 3 projects at three
// stages, 12 Observations, 14 Punch Items, 21 Daily Log days, 3 inspections, 10 SiteSnap messages and 12 photos.
// Plain data and functions, so tests check exactly what Procore would receive. Used by api/_demoSeedRun.js and the
// page api/procore/demo-seed.js (sandbox only, DEMO_MODE=true, admins only).
//
// Names differ from the spec where they clashed with people already in the sandbox (the test people in
// api/_seedDirectory.js and the demo staging people): SiteSnap's directory search, the guest demo and the sample
// messages find people by name, so two Luis Herreras would tag the wrong one. The spec's handle is kept in `spec`.
// Projects: "Westgate" and "Harbor Point" were already demo staging projects, so they are Crestview and Dockside.
// Matrix fixes (spec section 3 vs. the items it assigns): Mehta and Webb are on Crestview (Template B, PI-13/14,
// OBS-05/06), Salazar and Reed on Dockside (OBS-08, M9, PI-04).
// Everything here is made up. Phones use the reserved 555-01XX range. Emails are plus-addresses of the address in
// DEMO_SEED_EMAIL (else the first of DEMO_ADMIN_EMAILS), so no personal address is written in this public repo.

export const SEED_TAG = "[DEMO]";
export const isSeedTitle = (s) => String(s ?? "").trim().startsWith(SEED_TAG);
export const tagged = (s) => (isSeedTitle(s) ? String(s) : `${SEED_TAG} ${String(s ?? "").trim()}`);
export const KY = "ky"; // the signed-in Procore admin running the page (Ky, the demo PM)

// ---------- projects ----------

export const PROJECTS = {
  MH: { name: "[DEMO] Marina Heights Mixed-Use", stage: "Early: foundations and framing", shows: "Pre-pour inspections, safety observations, delays, deliveries", spec: "Marina Heights Mixed-Use" },
  CV: { name: "[DEMO] Crestview Medical Office TI", stage: "Middle: MEP rough-in, in-wall", shows: "Electrical and mechanical coordination, rough-in inspections, low voltage", spec: "Westgate Medical Office TI" },
  DS: { name: "[DEMO] Dockside Warehouse Conversion", stage: "Late: finishes and closeout", shows: "Punch lists, final walk, closing out observations", spec: "Harbor Point Warehouse Conversion" },
};
export const CODES = Object.keys(PROJECTS);

// ---------- companies ----------

// abbreviated_name: Procore allows 10 characters at most
const vendor = (name, abbreviated_name, phone, city, zip, notes) => ({
  name, abbreviated_name, business_phone: phone, address: "200 Demo Way", city, zip,
  email_address: `office@${abbreviated_name.toLowerCase().replace(/[^a-z]/g, "")}.example.com`, notes: `SiteSnap demo seed: ${notes}`, labor_union: null,
});

export const COMPANIES = {
  tidewater: vendor("Tidewater Development", "Tidewater", "(562) 555-0114", "Long Beach", "90802", "owner / developer (spec: Pacific Rim Development)"),
  harborline: vendor("Harborline Construction", "Harborline", "(310) 555-0115", "San Pedro", "90731", "general contractor"),
  beacon: vendor("Beacon Electric & Low Voltage", "Beacon", "(310) 555-0116", "Hawthorne", "90250", "electrical, CCTV, access control, intercom"),
  coastal: vendor("Coastal Mechanical", "CoastalMec", "(424) 555-0117", "Redondo Beach", "90278", "HVAC and plumbing"),
  ridgeline: vendor("Ridgeline Drywall & Finishes", "Ridgeline", "(323) 555-0118", "Inglewood", "90301", "framing, drywall, paint, flooring (spec: Summit Drywall & Finishes)"),
};
export const isSeedVendor = (name) => Object.values(COMPANIES).some((v) => v.name.toLowerCase() === String(name ?? "").trim().toLowerCase());

// ---------- people ----------

// Permission templates by kind, best first (the first one the project has is used). Procore's own templates only.
export const TEMPLATES = {
  owner: ["Owner - External", "Owner", "Client - External", "Subcontractor - External"],
  gcadmin: ["Project Manager - Internal"],
  gc: ["Foreman / Superintendent - Internal"],
  subpm: ["Subcontractor - External"],
  trade: ["Subcontractor - External"],
};
const ROLE_TYPE = { owner: "Owner", gcadmin: "PM", gc: "GC", subpm: "Sub PM", trade: "Worker" };

const ALL = ["MH", "CV", "DS"];
const person = (key, first, last, company, title, kind, projects, cell, spec) => ({
  key, company, projects, kind, templates: TEMPLATES[kind], spec,
  first_name: first, last_name: last, initials: `${first[0]}${last[0]}`, job_title: title, mobile_phone: cell,
  projectRole: null, roleType: ROLE_TYPE[kind],
});

export const PEOPLE = [
  person("osei", "Margaret", "Osei", "tidewater", "Owner's Representative", "owner", ALL, "(562) 555-0119", "Margaret Okafor"),
  person("ashford", "Vincent", "Ashford", "tidewater", "Development Director", "owner", ALL, "(562) 555-0120", "Daniel Whitfield"),
  person("navarro", "Rachel", "Navarro", "harborline", "Project Executive", "gcadmin", ALL, "(310) 555-0121", "Rachel Navarro"),
  person("brennan", "Sean", "Brennan", "harborline", "Assistant Project Manager", "gc", ["MH", "CV"], "(310) 555-0122", "Tom Brennan"),
  person("salazar", "Ruben", "Salazar", "harborline", "General Superintendent", "gc", ALL, "(310) 555-0123", "Luis Herrera"),
  person("mehta", "Anjali", "Mehta", "harborline", "Project Engineer", "gc", ALL, "(310) 555-0124", "Priya Nair"),
  person("carter", "Denise", "Carter", "harborline", "Safety Manager", "gc", ["MH", "DS"], "(310) 555-0125", "Denise Carter"),
  person("webb", "Grant", "Webb", "harborline", "QC / Punch Coordinator", "gc", ["CV", "DS"], "(310) 555-0126", "Marcus Webb"),
  person("holm", "Gary", "Holm", "beacon", "Project Manager", "subpm", ["MH", "CV"], "(310) 555-0127", "Gary Lindqvist"),
  person("alvarez", "Victor", "Alvarez", "beacon", "Electrical Foreman", "trade", ["MH", "CV"], "(310) 555-0128", "Carlos Mendez"),
  person("reed", "Darnell", "Reed", "beacon", "Journeyman Electrician", "trade", ALL, "(310) 555-0129", "Jamal Reed"),
  person("mori", "Aiko", "Mori", "beacon", "Low-Voltage Technician (CCTV / access control)", "trade", ["CV", "DS"], "(310) 555-0130", "Aiko Tanaka"),
  person("boone", "Caleb", "Boone", "beacon", "Apprentice Electrician", "trade", ["MH", "CV"], "(310) 555-0156", "Tyler Boone"),
  person("flores", "Sandra", "Flores", "coastal", "Project Manager", "subpm", ["CV", "DS"], "(424) 555-0157", "Sandra Flores"),
  person("odonnell", "Mike", "O'Donnell", "coastal", "HVAC Foreman", "trade", ["CV", "DS"], "(424) 555-0158", "Mike O'Donnell"),
  person("cho", "Eddie", "Cho", "coastal", "Plumbing Foreman", "trade", ["CV"], "(424) 555-0159", "Eddie Park"),
  person("vega", "Hector", "Vega", "coastal", "Journeyman Pipefitter", "trade", ["CV"], "(424) 555-0160", "Hector Ruiz"),
  person("novak", "Beth", "Novak", "ridgeline", "Owner / Estimator", "subpm", ALL, "(323) 555-0161", "Beth Kowalski"),
  person("washington", "Andre", "Washington", "ridgeline", "Drywall Foreman", "trade", ALL, "(323) 555-0162", "Andre Washington"),
  person("delgado", "Nina", "Delgado", "ridgeline", "Painting Foreman", "trade", ["DS"], "(323) 555-0163", "Nina Castillo"),
  person("ortiz", "Ramon", "Ortiz", "ridgeline", "Drywall Finisher", "trade", ["MH", "DS"], "(323) 555-0164", "Ramon Ortiz"),
  person("doyle", "Kevin", "Doyle", "ridgeline", "Laborer / Cleanup", "trade", ["MH", "DS"], "(323) 555-0165", "Kevin Tran"),
];
export const personByKey = (k) => PEOPLE.find((p) => p.key === k) ?? null;
export const fullName = (p) => `${p.first_name} ${p.last_name}`;
export const nameOf = (k) => (k === KY ? "Ky Gray" : fullName(personByKey(k)));

/** The address people get plus-addressed from: DEMO_SEED_EMAIL, else the first of DEMO_ADMIN_EMAILS; null when neither */
export function emailBase(env = process.env) {
  const raw = String(env.DEMO_SEED_EMAIL || String(env.DEMO_ADMIN_EMAILS ?? "").split(",")[0] || "").trim().toLowerCase();
  const m = /^([a-z0-9._-]+)(?:\+[^@]*)?@([a-z0-9.-]+\.[a-z]{2,})$/.exec(raw);
  return m ? { local: m[1], domain: m[2] } : null;
}
export function emailFor(p, env = process.env) {
  const b = emailBase(env);
  return b ? `${b.local}+demo-${p.key}@${b.domain}` : null;
}
/** Is this one of the seed's people (any base address)? The test-people cleanup leaves them alone. */
const HANDLES = new Set(PEOPLE.map((p) => p.key));
export const isSeedEmail = (e) => { const m = /\+demo-([a-z]+)@/.exec(String(e ?? "").toLowerCase()); return !!m && HANDLES.has(m[1]); };

/** The person as api/_seedSteps.js addPerson takes them */
export function directoryUser(p, env = process.env) {
  return {
    first_name: p.first_name, last_name: p.last_name, email_address: emailFor(p, env), initials: p.initials,
    job_title: p.job_title, mobile_phone: p.mobile_phone, projectRole: null, roleType: `${p.roleType} (SiteSnap demo seed)`,
    templates: p.templates,
  };
}

export const peopleOn = (code) => PEOPLE.filter((p) => p.projects.includes(code));
export const companiesOn = (code) => [...new Set(peopleOn(code).map((p) => p.company))];

// ---------- dates (all relative to today, so the data always looks current) ----------

export const DAY_MS = 24 * 60 * 60 * 1000;
// The sandbox projects are in Pacific time: "today" is Pacific's date, not UTC's
export const dayOf = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(now));
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** The last 7 work days ending today (or the Friday before, on a weekend): index 0 = 6 work days ago, 6 = "today" */
export function workDays(today) {
  const out = [];
  for (let d = today; out.length < 7; d = addDays(d, -1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d);
  }
  return out;
}

// ---------- photos (generated illustrations: scripts/build-seed-photos.mjs → api/_demoSeedPhotos.js) ----------
// album: the project's Photos album (spec section 10: Safety, Quality, Progress, Punch per project)

export const ALBUMS = ["Safety", "Quality", "Progress", "Punch"];
export const PHOTOS = {
  rebar: { project: "MH", album: "Quality", caption: "Rebar at gridline C, south corner: lap splice missing" },
  slabedge: { project: "MH", album: "Safety", caption: "Open slab edge with the guardrail section removed" },
  cords: { project: "MH", album: "Safety", caption: "Extension cords across the walkway, not secured" },
  conduit: { project: "CV", album: "Progress", caption: "Conduit run crossing the 12-inch duct route in the corridor" },
  hangers: { project: "CV", album: "Quality", caption: "Duct hangers spaced wider than the spec allows" },
  dust: { project: "DS", album: "Safety", caption: "Corridor opening with no dust containment" },
  extinguisher: { project: "DS", album: "Safety", caption: "Empty fire extinguisher bracket at stair 2" },
  levelfive: { project: "DS", album: "Punch", caption: "Level 5 finish on the east corridor wall, ready for paint" },
  texture: { project: "DS", album: "Punch", caption: "Texture mismatch from a patch next to the stair door" },
  paint: { project: "DS", album: "Punch", caption: "Paint holiday (missed spot) on the north wall" },
  camera: { project: "DS", album: "Punch", caption: "Lobby camera mounted lower than the drawings show" },
  pallets: { project: "DS", album: "Progress", caption: "Drywall mud pallets dropped at the wrong door" },
};

// ---------- Observations (spec section 8) ----------
// type: the spec's kind; typeHints: Procore Observation categories / names to look for, best first.
// status: initiated | ready_for_review | closed. due: days from today. by: who reported it (Procore records the
// signed-in admin as the creator, so the description says who). assignees: first is the spec's assignee.

const TYPE_HINTS = { Safety: ["safety"], Quality: ["quality"], Coordination: ["coordination", "quality"], Housekeeping: ["housekeeping", "safety"] };
const obs = (id, project, title, type, priority, assignees, status, by, due, text, extra = {}) => ({
  id, recordType: "observation", project, title: tagged(title), type, typeHints: TYPE_HINTS[type], priority, assignees: [].concat(assignees), status, by, due, text, ...extra,
});

export const OBSERVATIONS = [
  obs("OBS-01", "MH", "Missing lap splice at gridline C", "Quality", "High", "alvarez", "initiated", "carter", 1,
    "The rebar at gridline C, south corner, has no lap splice where S-201 calls for one. It has to be fixed and walked before tomorrow's pour.", { photo: "rebar" }),
  obs("OBS-02", "MH", "Open slab edge, guardrail removed", "Safety", "Urgent", "salazar", "initiated", "carter", 0,
    "A guardrail section at the open slab edge was taken down and not put back. It must be back up before the end of the shift.", { photo: "slabedge" }),
  obs("OBS-03", "MH", "Trip hazard: unsecured cords", "Safety", "Medium", "reed", "ready_for_review", "carter", -1,
    "Extension cords run across the main walkway with no cover or tie-up. Reed has routed them overhead; ready for Denise to check.", { photo: "cords" }),
  obs("OBS-04", "CV", "Conduit conflicts with 12\" duct, corridor", "Coordination", "High", ["alvarez", KY], "initiated", "odonnell", 1,
    "Electrical conduit is installed where the 12-inch supply duct runs in the main corridor. Duct has priority; conduit to be rerouted above.", {
      photo: "conduit",
      comments: [
        ["odonnell", "Conduit is sitting in my duct route at the corridor. Who moves?"],
        [KY, "Meet at the corridor at 7 a.m. Duct has priority. Victor, please reroute the conduit above and send me a photo."],
        ["alvarez", "Got it. Crew starts the reroute first thing tomorrow."],
      ],
    }),
  obs("OBS-05", "CV", "Trash and cut-offs in restroom rough-in", "Housekeeping", "Low", "cho", "initiated", "webb", 3,
    "Pipe cut-offs and boxes are left in the restroom rough-in area. Clean up before the rough-in inspection."),
  obs("OBS-06", "CV", "Hanger spacing exceeds spec at duct run", "Quality", "Medium", "odonnell", "ready_for_review", "mehta", 2,
    "Duct hangers on the east run are about 10 feet apart; the spec allows 8. Extra hangers added, ready for review.", { photo: "hangers" }),
  obs("OBS-07", "CV", "Camera pull boxes missing from ceiling layout", "Coordination", "Medium", "mori", "initiated", "brennan", 4,
    "The lobby camera pull boxes aren't on the reflected ceiling plan. Place them per the security drawings unless an RFI says otherwise."),
  obs("OBS-08", "DS", "Fire extinguisher missing at stair 2", "Safety", "High", "salazar", "closed", "carter", -2,
    "The fire extinguisher bracket at stair 2 is empty.", { photo: "extinguisher", closing: "New extinguisher mounted and tagged. Closed." }),
  obs("OBS-09", "DS", "Dust control, no containment at corridor", "Safety", "Medium", "washington", "initiated", "carter", 1,
    "Sanding in the east corridor with no plastic containment; dust is reaching the finished offices.", { photo: "dust" }),
  obs("OBS-10", "DS", "Damaged corner bead, east corridor", "Quality", "Low", "ortiz", "closed", "webb", -3,
    "Corner bead at the east corridor is dented about 4 feet up.", { closing: "Bead replaced and refinished. Closed." }),
  obs("OBS-11", "DS", "Wet floor, no signage after cleaning", "Safety", "Low", "doyle", "initiated", "carter", 0,
    "The lobby floor was mopped and left wet with no wet-floor signs out."),
  obs("OBS-12", "MH", "Rebar delivery blocking crane path", "Coordination", "Medium", "salazar", "initiated", "brennan", 0,
    "The rebar bundles from this morning's delivery are staged in the crane swing path. Move them to the laydown yard."),
];

// ---------- Punch Items (spec section 9) ----------
// status: open | work_required | ready_for_review | closed (Procore's workflow_status). reviewer: the Punch Item
// Manager / final approver. trade: Procore's trade (used only when the company has it; always in the description).

const pi = (id, project, title, location, trade, assignee, status, reviewer, text, extra = {}) => ({
  id, recordType: "punch_item", project, title: tagged(title), location, trade, assignee, status, reviewer, text, ...extra,
});

export const PUNCH_ITEMS = [
  pi("PI-01", "DS", "Paint holiday on north wall", "Office 101", "Painting", "delgado", "work_required", "webb", "Missed spot on the north wall, about 2 feet wide.", { photo: "paint" }),
  pi("PI-02", "DS", "Touch-up at door frame", "Office 102", "Painting", "delgado", "ready_for_review", "webb", "Scuffs at the door frame touched up."),
  pi("PI-03", "DS", "L5 finish check, east wall", "Corridor E", "Drywall", "washington", "ready_for_review", "webb", "Level 5 finish on the east wall is done and ready for the paint inspection.", { photo: "levelfive" }),
  pi("PI-04", "DS", "Outlet cover missing", "Office 103", "Electrical", "reed", "work_required", "webb", "Duplex outlet by the window has no cover plate."),
  pi("PI-05", "DS", "Texture mismatch near stair door", "Stair 1", "Drywall", "washington", "work_required", "webb", "A patch next to the stair door doesn't match the wall texture. Re-skim before prime.", { photo: "texture" }),
  pi("PI-06", "DS", "Scuff on freshly painted wall", "Lobby", "Painting", "delgado", "open", "webb", "Cart scuff on the lobby wall at about waist height."),
  pi("PI-07", "DS", "Door closer adjustment", "Restroom 1", "Doors/Hardware", "washington", "open", "webb", "Door slams; the closer needs adjusting."),
  pi("PI-08", "DS", "Caulk gap at base trim", "Office 104", "Drywall", "washington", "work_required", "webb", "Gap between the base trim and the wall along the east side."),
  pi("PI-09", "DS", "LVT seam lifting", "Break Room", "Flooring", "ortiz", "closed", "webb", "LVT seam lifting by the sink.", { closing: "Plank replaced and rolled. Closed." }),
  pi("PI-10", "DS", "Ceiling tile stained", "Conf Room", "Ceiling", "doyle", "closed", "webb", "One stained ceiling tile over the conference table.", { closing: "Tile swapped. Closed." }),
  pi("PI-11", "DS", "Camera mounting height off", "Lobby", "Low Voltage", "mori", "work_required", KY, "Lobby camera is about 1 foot lower than the drawings show.", { photo: "camera" }),
  pi("PI-12", "DS", "Final clean, windows", "All floors", "Cleaning", "doyle", "ready_for_review", KY, "Final window clean done on every floor; ready for the PM's review."),
  pi("PI-13", "CV", "Cleanout cover not flush", "Restroom 2", "Plumbing", "cho", "open", "mehta", "Floor cleanout cover sits about 1/4 inch high."),
  pi("PI-14", "CV", "Label missing on junction box", "Corridor", "Electrical", "alvarez", "open", "mehta", "Junction box above the corridor ceiling has no circuit label."),
];

export const RECORDS = [...OBSERVATIONS, ...PUNCH_ITEMS];
export const recordById = (id) => RECORDS.find((r) => r.id === id) ?? null;
export const TRADES = [...new Set(PUNCH_ITEMS.map((p) => p.trade))];

// ---------- Daily Logs (spec section 5): 7 work days per project ----------
// manpower: [company, workers, hours]. delay: { kind (matched to the project's delay types), start, end, text }.
// delivery: { what, from, time }. Logged by: who the spec says keeps the log (Procore records the signed-in admin).

const D = (weather, manpower, delay, delivery, note) => ({ weather, manpower, delay, delivery, note });
export const DAILY_LOGS = {
  MH: { by: "salazar", days: [
    D("Sunny, 68°F", [["harborline", 4, 8], ["beacon", 3, 8]], null, { what: "Rebar #5 bundles (2 trucks)", from: "Western Steel & Rebar", time: "07:30" }, "Rebar placement started, gridlines A-C."),
    D("Sunny, 71°F", [["harborline", 4, 8], ["beacon", 3, 8], ["ridgeline", 2, 8]], null, { what: "Formwork lumber", from: "Valley Lumber Co.", time: "08:00" }, "Form crew set walls on A-B."),
    D("Overcast, 64°F", [["harborline", 4, 8], ["beacon", 4, 8]], { kind: "weather", start: "07:00", end: "09:00", text: "Rain for 2 hours in the morning." }, null, "Concrete placement moved to the next day."),
    D("Sunny, 70°F", [["harborline", 5, 8], ["beacon", 3, 8]], null, { what: "Concrete (42 yds)", from: "Harbor Ready-Mix", time: "06:30" }, "Slab-on-grade pour, east side."),
    D("Sunny, 72°F", [["harborline", 4, 8], ["ridgeline", 3, 8]], null, { what: "Anchor bolts", from: "Western Steel & Rebar", time: "09:00" }, "Stripping forms, curing."),
    D("Sunny, 73°F", [["harborline", 4, 8], ["beacon", 2, 8]], { kind: "inspection", start: "08:00", end: "09:30", text: "Inspector arrived 1.5 hours late." }, null, "Pre-pour inspection delayed."),
    D("Sunny, 70°F", [["harborline", 5, 8], ["beacon", 3, 8]], null, { what: "Rebar #4 (1 truck)", from: "Western Steel & Rebar", time: "07:15" }, "Rebar at gridline C; lap splice question open (OBS-01)."),
  ] },
  CV: { by: "salazar", days: [
    D("Clear", [["harborline", 3, 8], ["beacon", 6, 8], ["coastal", 5, 8]], null, { what: "EMT 3/4\" and 1\"", from: "Southland Electrical Supply", time: "07:00" }, "Conduit rough-in, level 1."),
    D("Clear", [["beacon", 6, 8], ["coastal", 6, 8], ["ridgeline", 2, 8]], null, { what: "12\" duct sections", from: "Metro Sheet Metal", time: "08:30" }, "Duct hangers in the corridor."),
    D("Clear", [["beacon", 7, 8], ["coastal", 6, 8]], { kind: "coordination", start: "09:00", end: "12:00", text: "Conduit vs. duct conflict at the corridor (OBS-04); 3 hours lost." }, null, "Conduit vs. duct conflict at the corridor (see OBS-04)."),
    D("Overcast", [["beacon", 6, 8], ["coastal", 6, 8], ["ridgeline", 3, 8]], null, { what: "Plumbing copper", from: "Bayside Plumbing Supply", time: "07:45" }, "Plumbing rough-in, restrooms."),
    D("Clear", [["beacon", 6, 8], ["coastal", 5, 8]], null, null, "Low-voltage cable pulls start."),
    D("Clear", [["beacon", 7, 8], ["coastal", 5, 8]], { kind: "material", start: null, end: null, text: "Chiller delivery pushed one week by the supplier; may affect the rough-in inspection." }, null, "Chiller delay notice from the supplier."),
    D("Clear", [["beacon", 6, 8], ["coastal", 5, 8], ["ridgeline", 2, 8]], null, { what: "Pull boxes", from: "Southland Electrical Supply", time: "10:00" }, "Rough-in inspection scheduled for tomorrow."),
  ] },
  DS: { by: KY, days: [
    D("Clear", [["harborline", 2, 8], ["ridgeline", 7, 8]], null, { what: "Joint compound", from: "Gypsum Supply West", time: "07:30" }, "Drywall finishing, Level 5 on the east side."),
    D("Clear", [["ridgeline", 8, 8], ["beacon", 2, 8]], null, { what: "Primer and paint", from: "Coastline Paint", time: "08:00" }, "Prime coat started."),
    D("Clear", [["ridgeline", 8, 8], ["coastal", 2, 8]], { kind: "delivery", start: "10:00", end: "11:00", text: "Drywall mud delivered to the wrong door; 1 hour to restage." }, { what: "Drywall mud (wrong door)", from: "Gypsum Supply West", time: "09:45" }, "Material staging issue (see the SiteSnap message from Kevin)."),
    D("Clear", [["ridgeline", 8, 8], ["beacon", 3, 8]], null, null, "Paint first coats."),
    D("Clear", [["ridgeline", 6, 8], ["harborline", 2, 8]], null, { what: "Flooring (LVT)", from: "Westside Floor Source", time: "07:00" }, "LVT install, offices."),
    D("Clear", [["ridgeline", 6, 8], ["beacon", 2, 8], ["coastal", 1, 8]], null, null, "Punch walk with the owner's rep."),
    D("Clear", [["ridgeline", 5, 8], ["harborline", 3, 8]], null, null, "Punch fixes and touch-ups."),
  ] },
};
// What each delay kind looks for in the project's delay types (by name), best first
export const DELAY_KIND_WORDS = {
  weather: ["weather"], inspection: ["inspection", "inspector", "owner"], coordination: ["coordination", "subcontractor", "existing conditions", "design"],
  material: ["material", "supplier", "vendor", "delivery"], delivery: ["delivery", "material", "logistics"],
};

// ---------- Inspections (spec section 7) ----------
// answers: item number (1-based) → pass | fail | na; the rest stay open. due: days from today.

export const INSPECTION_TEMPLATES = {
  A: { name: "[DEMO] Pre-Pour Concrete Inspection", section: "Pre-pour checks", items: [
    "Forms are clean, plumb, and braced.", "Rebar size and spacing match structural drawings.", "Lap splices meet required length.",
    "Chairs / bolsters in place for correct cover.", "Embeds and anchor bolts located per plan.", "Penetrations and sleeves in place.",
    "Weather and pump access acceptable.",
  ] },
  B: { name: "[DEMO] Electrical / Mechanical Rough-In Inspection", section: "Rough-in checks", items: [
    "Conduit supported and secured per spec.", "Box fill and placement meet code.", "Pull strings installed in empty conduits.",
    "Duct hangers and clearances meet drawings.", "Plumbing slopes and cleanouts correct.", "Fire-stopping at rated penetrations.",
    "Low-voltage pathways separated from power.", "Labels and as-builts marked up.",
  ] },
  C: { name: "[DEMO] Final Walk / Pre-Punch", section: "Final walk", items: [
    "Paint finish uniform, no holidays.", "Drywall joints and corners flush.", "Flooring seams tight, no lifting.", "Doors operate and latch.",
    "Ceiling tiles and lights clean.", "Low-voltage devices mounted and labeled.", "Cleaning complete.",
  ] },
};
export const INSPECTIONS = [
  { id: "INSP-A", template: "A", project: "MH", name: "[DEMO] Pre-pour, east footings", inspector: "carter", due: 0, answers: { 1: "pass", 2: "pass", 3: "fail" }, failNote: { 3: "OBS-01" } },
  { id: "INSP-B", template: "B", project: "CV", name: "[DEMO] Rough-in, level 1", inspector: "mehta", due: 1, answers: { 1: "pass", 2: "pass", 3: "pass", 4: "fail" }, failNote: { 4: "OBS-04" } },
  { id: "INSP-C", template: "C", project: "DS", name: "[DEMO] Final walk, offices", inspector: "webb", due: 2, answers: {}, failNote: {} },
];

// ---------- SiteSnap messages (spec section 4) ----------
// Procore has no general conversation API, so these live in SiteSnap's own threads (like a real capture), linked to
// the record they're about. A thread: from, to (tagged: alerted), msgs [who, words, minutes ago]. to "team" = everyone
// on the project but the owner's people (M8: the owner can read it but isn't alerted).

export const MESSAGES = [
  { id: "m1", spec: ["M1", "M2"], project: "MH", from: "alvarez", to: ["salazar", KY], link: "OBS-01", msgs: [
    ["alvarez", "Rebar at gridline C is missing the lap splice at the south corner. Can someone from engineering confirm before the pour tomorrow?", 300],
    ["salazar", "Confirmed with Anjali, the splice detail is on S-201. Fix it today, I'll walk it at 3.", 270],
  ] },
  { id: "m3", spec: ["M3", "M4"], project: "CV", from: "odonnell", to: ["alvarez", KY], link: "OBS-04", msgs: [
    ["odonnell", "Your conduit run is sitting right where my 12-inch duct goes at the corridor. Who moves, you or me?", 240],
    [KY, "Meet at the corridor at 7 a.m. Duct has priority. Victor, please reroute the conduit above. Send me a photo when done.", 210],
  ] },
  { id: "m5", spec: ["M5"], project: "CV", from: "mori", to: [KY, "brennan"], link: "OBS-07", msgs: [
    ["mori", "Camera pull boxes for the lobby aren't in the ceiling layout. Do we have an RFI, or do I just place them per the security drawings?", 180],
  ] },
  { id: "m6", spec: ["M6"], project: "DS", from: "washington", to: ["webb"], link: "PI-03", msgs: [
    ["washington", "Level 5 finish on the east wall is done, ready for paint inspection. Photos attached.", 160],
  ] },
  { id: "m7", spec: ["M7"], project: "DS", from: "delgado", to: ["washington", "webb"], link: "PI-05", msgs: [
    ["delgado", "There's a texture mismatch near the stair door. Looks like a patch. Can you re-skim before I prime?", 140],
  ] },
  { id: "m8", spec: ["M8"], project: "MH", from: "carter", to: "team", link: "OBS-02", msgs: [
    ["carter", "Reminder: guardrails at the open slab edge must be back up before end of shift. Photo from this morning attached.", 120],
  ] },
  { id: "m9", spec: ["M9"], project: "DS", from: "doyle", to: ["salazar", "webb"], link: null, msgs: [
    ["doyle", "Pallets of drywall mud delivered to the wrong door. Where do you want them?", 100],
  ] },
  { id: "m10", spec: ["M10"], project: "CV", from: "flores", to: [KY], link: null, msgs: [
    ["flores", "Chiller delivery pushed one week. I'll send the supplier email. Might affect the rough-in inspection.", 60],
  ] },
];
/** Who a thread tags (alerts) */
export function recipientsOf(m) {
  if (m.to !== "team") return m.to;
  return [KY, ...peopleOn(m.project).filter((p) => p.company !== "tidewater" && p.key !== m.from).map((p) => p.key)];
}

// ---------- the task list (the seed runs one task per request, in this order) ----------
// Each task: { id, kind, label, project? , ... }. Its row in Firestore (the seed map) records the Procore ids made.

export function tasks() {
  const out = [];
  for (const code of CODES) out.push({ id: `project:${code}`, kind: "project", project: code, label: `Project ${PROJECTS[code].name}` });
  out.push({ id: "trades", kind: "trades", label: "Trades for the punch list (when the company allows it)" });
  for (const code of CODES) {
    for (const co of companiesOn(code)) out.push({ id: `company:${co}:${code}`, kind: "company", project: code, company: co, label: `${COMPANIES[co].name} on ${code}` });
    out.push({ id: `pm:${code}`, kind: "pm", project: code, label: `Ky as Project Manager on ${code}` });
    for (const p of peopleOn(code)) out.push({ id: `person:${p.key}:${code}`, kind: "person", project: code, person: p.key, label: `${fullName(p)} on ${code}` });
  }
  for (const code of CODES) out.push({ id: `albums:${code}`, kind: "albums", project: code, label: `Photo albums on ${code}` });
  for (const r of RECORDS) out.push({ id: `record:${r.id}`, kind: "record", project: r.project, record: r.id, label: `${r.id} ${r.title.replace(SEED_TAG, "").trim()}` });
  for (const [key, ph] of Object.entries(PHOTOS)) out.push({ id: `photo:${key}`, kind: "photo", project: ph.project, photo: key, label: `Photo in ${ph.album}: ${ph.caption}` });
  for (const code of CODES) DAILY_LOGS[code].days.forEach((_, i) => out.push({ id: `dailylog:${code}:${i}`, kind: "dailylog", project: code, day: i, label: `Daily log ${code}, work day ${i - 6 === 0 ? "today" : i - 6}` }));
  for (const t of Object.keys(INSPECTION_TEMPLATES)) out.push({ id: `template:${t}`, kind: "template", template: t, label: `Inspection template ${INSPECTION_TEMPLATES[t].name}` });
  for (const i of INSPECTIONS) out.push({ id: `inspection:${i.id}`, kind: "inspection", project: i.project, inspection: i.id, label: `${i.name} (${nameOf(i.inspector)})` });
  for (const m of MESSAGES) out.push({ id: `message:${m.id}`, kind: "message", project: m.project, message: m.id, label: `Message ${m.spec.join(" + ")} from ${nameOf(m.from)}` });
  return out;
}
export const taskById = (id) => tasks().find((t) => t.id === id) ?? null;
export const GROUPS = [
  ["Setup", ["project", "trades", "company", "pm", "person", "albums"]],
  ["Observations and Punch Items", ["record"]],
  ["Photos", ["photo"]],
  ["Daily logs", ["dailylog"]],
  ["Inspections", ["template", "inspection"]],
  ["Messages", ["message"]],
];

/** Who should see what in My items (spec section 6), from the records themselves */
export function myItemsPlan() {
  const out = {};
  for (const r of RECORDS) {
    if (r.status === "closed") continue;
    for (const k of r.recordType === "observation" ? r.assignees : [r.assignee]) (out[k] ??= []).push(r.id);
  }
  return out;
}
