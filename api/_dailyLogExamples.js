// Daily Log Examples (Ky's docs/daily-log-examples-spec.md): the content bank and the sample builder for the sandbox
// page api/procore/daily-log-examples.js. Pure (no Procore, no Firestore), so tests drive it with a seeded random.
//   Foremen:  findForemen(users) -> people whose job title says foreman / lead / super…; when none match, people
//             whose permission template or company hints at it, marked "guess". Never invents a person.
//   Trade:    guessTrade(title, company): the title first, then the company name; else the GC's superintendent.
//   Stage:    guessStage(project): the demo staging plan, then the project name, then Procore's stage, else
//             "rough-in" (marked guessed). Ky can change it on the page.
//   Samples:  makeSamples(): one day's log per foreman: Manpower + Notes always, Delivery about 1 in 3, an issue
//             about 1 in 3 (most issues lose time, so a Delay about 1 in 4), and a read-aloud script.
// Sentences are written per trade and per stage, so a drywall foreman never reports finish paint during site work.
// No phone numbers, emails or real company names: suppliers are generic ("Lumber yard"), people come from the directory.
import { PROJECTS } from "./_demoScenarios.js";

export const MARKER = "— [SiteSnap sample]";
export const STAGES = {
  site: "Site work and foundations",
  structure: "Structure and framing",
  roughin: "Rough-in (MEP, inside walls)",
  finishes: "Finishes, punch and closeout",
};
const STAGE_KEYS = Object.keys(STAGES);

// ---------- who is a foreman ----------

const FOREMAN_TITLE = /fore\s*man|foreperson|forman|\blead\b|superintendent|\bsuper\b|supervisor|crew lead/i;
const FOREMAN_TEMPLATE = /foreman|superintendent/i;
const NOT_FIELD = /project manager|\bpm\b|engineer|inspector|owner|architect|director|accountant|coordinator|estimator|admin/i;

const nameOf = (u) => u?.name || `${u?.first_name ?? ""} ${u?.last_name ?? ""}`.trim() || `Person ${u?.id}`;

/** A project user, in the shape the page shows: { id, name, title, company, companyId, trade, template } */
export function person(u) {
  const title = String(u?.job_title ?? "").trim();
  const company = u?.vendor?.name ?? "";
  return {
    id: String(u?.id ?? ""), name: nameOf(u), title, company, companyId: u?.vendor?.id != null ? String(u.vendor.id) : null,
    template: u?.permission_template?.name ?? "", trade: guessTrade(title, company),
  };
}

/** { candidates: [{ ...person, match: "title" | "guess", why }], directory: [person] } (active people only) */
export function findForemen(users = []) {
  const directory = users.filter((u) => u && u.id != null && u.is_active !== false).map(person).sort((a, b) => a.name.localeCompare(b.name));
  const byTitle = directory.filter((p) => FOREMAN_TITLE.test(p.title)).map((p) => ({ ...p, match: "title", why: `Job title: ${p.title}` }));
  if (byTitle.length) return { candidates: byTitle, directory };
  // Nothing in the titles: hints only, never people whose title says they aren't in the field
  const guesses = directory.filter((p) => !NOT_FIELD.test(p.title)).flatMap((p) => {
    if (FOREMAN_TEMPLATE.test(p.template)) return [{ ...p, match: "guess", why: `Permission template: ${p.template}` }];
    if (p.company && tradeFrom(p.company)) return [{ ...p, match: "guess", why: `Company looks like ${TRADES[p.trade].label.toLowerCase()}: ${p.company}` }];
    return [];
  });
  return { candidates: guesses, directory };
}

// ---------- trade and stage ----------

// Checked in this order: low voltage before electrical ("Low-Voltage"), plumbing before fire ("Plumbing / Sprinkler")
const TRADE_WORDS = [
  ["lowvoltage", /low[- ]?voltage|security|telecom|\bdata\b|communications|access control|camera|structured cabling/i],
  ["plumbing", /plumb|pipefit/i],
  ["fireprotection", /fire|sprinkler/i],
  ["hvac", /hvac|mechanical|sheet ?metal|heating|\bair\b|\bduct/i],
  ["electrical", /electric|volt|power|lighting|wiring/i],
  ["drywall", /drywall|gypsum|taper|interiors|finisher|plaster/i],
  ["painting", /paint|coating/i],
  ["framing", /fram(er|ing)|carpent|lumber|truss/i],
  ["concrete", /concrete|cement|flatwork|rebar|ready ?mix|foundation/i],
  ["sitework", /excavat|earthwork|grading|site ?work|civil|paving|underground|utilit/i],
  ["roofing", /roof/i],
];
const tradeFrom = (text) => TRADE_WORDS.find(([, re]) => re.test(String(text ?? "")))?.[0] ?? null;
export const guessTrade = (title, company) => tradeFrom(title) ?? tradeFrom(company) ?? "gc";

const STAGE_WORDS = [
  ["site", /site ?work|excavat|foundation|earthwork|grading|ground ?up|early/i],
  ["structure", /framing|structur|steel|shell|core/i],
  ["roughin", /rough|\bmep\b|distribution|warehouse/i],
  ["finishes", /finish|punch|closeout|close-out|modernization|remodel|renovation|tenant improvement|\bti\b|turnover/i],
];
const DEMO_STAGE = { HP: "site", WG: "roughin", LV: "finishes" };

/** { stage, source } from the demo staging plan, the project's name, or Procore's project stage */
export function guessStage({ name = "", procoreStage = "" } = {}) {
  const demo = Object.entries(PROJECTS).find(([, p]) => String(name).toLowerCase().includes(p.name.toLowerCase()));
  if (demo) return { stage: DEMO_STAGE[demo[0]], source: `Demo staging plan: ${demo[1].stage}` };
  const byName = STAGE_WORDS.find(([, re]) => re.test(name));
  if (byName) return { stage: byName[0], source: "From the project name" };
  if (/pre-?construction|bidding|design|planning/i.test(procoreStage)) return { stage: "site", source: `Procore stage: ${procoreStage}` };
  if (/post-?construction|closeout|warranty|complete/i.test(procoreStage)) return { stage: "finishes", source: `Procore stage: ${procoreStage}` };
  return { stage: "roughin", source: procoreStage ? `Guessed (Procore stage "${procoreStage}" doesn't say which phase)` : "Guessed: no stage in Procore or the name" };
}

// ---------- dates ----------

/** The last `n` working days up to and including `today` (YYYY-MM-DD), newest first. Never a future day. */
export function workingDays(today, n = 5) {
  const out = [];
  const d = new Date(`${today}T12:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const weekday = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

// ---------- the content bank ----------
// A work line is "what we did // short manpower description". {a|b} picks one, {12-30} a number.
// few(...) marks work a trade does with a small crew before or after its main phase.

// Issues, next-day lines and deliveries fit the trade's main stages (where its work isn't few()) unless they name
// their stages ("site structure").
const few = (...lines) => lines.map((w) => ({ w, crew: [2, 4], hours: [4, 8], few: true }));
const issue = (w, delay, stages) => ({ w, delay, stages });
const when = (stages, w) => ({ w, stages });
// A delay: Procore delay type kind, hours lost, what it held up, and when it started (half hours after midnight;
// 7 to 11 AM unless the words say when)
const D = (type, lo, hi, what, at = [14, 22]) => ({ type, hours: [lo, hi], what, at });
const AFTER_LUNCH = [25, 27];

export const TRADES = {
  gc: {
    label: "General contractor",
    work: {
      site: [
        "Walked the site with the surveyor, building corners and grid lines staked. Repaired the silt fence on the east side after last night's wind. // Supervision, layout check",
        "Ran the morning huddle, {3-5} trades on site. Excavator finished the footing trench on grid {A|B|C}. // Supervision, safety walk",
        "Laborers cleaned up the laydown yard and reset the perimeter fence. Port-a-johns serviced, washout moved closer to the gate. // Labor, site cleanup",
      ],
      structure: [
        "Coordinated the crane picks for the {steel|truss} delivery, done by {1|2} PM. Walked the level {2|3} deck with the framer for open penetrations. // Supervision, crane coordination",
        "Safety walk this morning, {2-4} guardrail gaps on the {2nd|3rd} floor fixed before lunch. Toolbox talk on fall protection, everyone signed. // Supervision, safety",
        "Laborers stocked framing material to {level 2|level 3|the east wing} and swept the slab. Dumpster swapped. // Labor, material handling",
      ],
      roughin: [
        "Ran the MEP coordination walk on level {1|2}. Duct and sprinkler main want the same space at corridor {C|D}, sent it to the PM. // Supervision, MEP coordination",
        "Above-ceiling walk with the inspector in {the east wing|area B|the north corridor}, {2|3} items to fix, mostly firestopping. // Supervision, inspections",
        "Laborers cleaned out units {101–104|201–204|301–304} so board can start. Moved the temp lights ahead of the drywall crew. // Labor, cleanup",
      ],
      finishes: [
        "Punch walk with the architect on level {1|2}, {28-55} items written up. Most of it is paint touch-up and ceiling tiles. // Supervision, punch list",
        "Final clean started in {the lobby|wing A|the classrooms}. Floor protection pulled and rolled up. // Labor, final clean",
        "Checked exit signs and door hardware in {wing A|the east stair} for the fire marshal walk. {2|3} doors still need the closers adjusted. // Supervision, closeout",
      ],
    },
    issues: [
      issue("Inspector pushed the {footing|framing|above-ceiling} inspection to tomorrow AM, so nothing gets covered today.", D("inspection", 1, 3, "cover-up work")),
      issue("Owner asked for {2|3} extra outlets in the break room, change order request sent to the PM.", null, "roughin finishes"),
      issue("Neighbor complained about dust, watered the haul road twice.", null, "site structure"),
    ],
    tomorrow: [when("site structure", "Concrete and electrical both on site tomorrow, need to split the laydown."), "Owner's rep walking at 10 tomorrow.", "Same crew tomorrow, finishing the cleanup."],
    deliveries: [
      { what: "Plywood for floor protection, {20-40} sheets", from: "Lumber yard", stages: "roughin finishes" },
      { what: "Temporary fence panels, {10-20} sections", from: "Equipment rental yard", stages: "site structure" },
    ],
  },
  sitework: {
    label: "Site work / Excavation",
    work: {
      site: [
        "Trenched {180-260} ft for storm line along the {north|east} side, bedding and pipe in for the first {80-120} ft. // Storm line trenching",
        "Cut and fill on the {south|west} parking area, about {300-450} yards moved. Compaction tests on the building pad passed at 95%. // Mass grading",
        "Set {3|4} storm structures and tied in the catch basins. Backfilled and compacted in 12 inch lifts. // Storm drain install",
        "Dug footings on grid lines {1–4|5–8|A–C}. Hauled spoils, {12-18} loads. // Footing excavation",
      ],
      structure: [
        "Backfilled behind the {east|north} foundation wall, compacted in lifts. Graded for the sidewalk subbase. // Backfill and grading",
        "Ran the water service from the street to the building, {120-180} ft of 4 inch. Pressure test set for tomorrow. // Water service",
        "Rough grading around the building, cut the swales on the {west|south} side. // Rough grading",
      ],
      roughin: [
        "Fine grading the parking lot, base rock down on {half the lot|rows A to C}. Curb forms go in next. // Fine grading, base rock",
        "Dug for the site lighting bases, {6-10} holes. Conduit trench to the pole bases {done|half done}. // Site lighting excavation",
        "Installed the fire water line from the vault, {90-140} ft, thrust blocks poured. // Fire water line",
      ],
      finishes: [
        "Final grade at the landscape beds, topsoil spread. Swept the parking lot for striping. // Final grading",
        "Pulled the silt fence on the north side and patched the driveway apron. // Site cleanup, patching",
        "Raised {4|5} manhole lids to finish grade before paving. Cleaned out the catch basins. // Utility adjustments",
      ],
    },
    issues: [
      issue("Hit unmarked conduit at about 4 ft, stopped work, flagged it and called the PM.", D("conditions", 2, 4, "the trench"), "site structure roughin"),
      issue("Rain overnight, trench walls soft, pumped water most of the morning.", D("weather", 2, 3, "trenching"), "site structure roughin"),
      issue("Excavator blew a hydraulic line, mechanic out at {10|11}.", D("equipment", 2, 3, "excavation")),
    ],
    tomorrow: [when("site structure", "Locator coming back out first thing tomorrow."), "Compaction tester booked for 8 tomorrow.", when("roughin finishes", "Paving crew wants the base ready by Friday.")],
    deliveries: [
      { what: "{8-12} loads of base rock", from: "Aggregate yard", stages: "structure roughin finishes" },
      { what: "{120-200} ft of 12 inch storm pipe and {2|3} catch basins", from: "Pipe supplier", stages: "site structure" },
    ],
  },
  concrete: {
    label: "Concrete",
    work: {
      site: [
        "Poured footings on grid lines {A–C|1–4|D–F}, about {28-45} yards. Pump on site at {6:30|7:00}, cylinders taken, 4 total. // Footing pour",
        "Formed and set rebar for the {north|east} stem wall, {120-180} ft. Rebar inspection passed before lunch. // Forming and rebar",
        "Laid the vapor barrier and mesh under slab section {A|B}. Grade beams formed. // Slab prep",
      ],
      structure: [
        "Poured slab section {B|C|D}, about {38-60} yards. Pump on site 6:30, finished and cure compound on by 2 PM. // Slab pour",
        "Stripped forms on the {level 2|east} deck and reshored per plan. Next deck pour is {Thursday|Friday} if inspection passes. // Stripping and reshoring",
        "Saw cut control joints on yesterday's pour. Cleaned up the washout. // Saw cutting, cleanup",
      ],
      roughin: [
        "Poured the equipment pads, {3|4} pads, about {6-9} yards total. Anchor bolts set to the mechanical layout. // Equipment pads",
        "Infill pour at the plumbing trenches in {the restrooms|units 101–104}, {4-7} yards. Ground the edges smooth. // Trench infill",
        "Formed the {loading dock|ramp} walls, rebar in. Pour planned for {Friday|Monday}. // Dock walls forming",
      ],
      finishes: [
        "Poured sidewalk on the {north|east} side, {120-200} ft, broom finish. Expansion joints every 20 ft. // Sidewalk pour",
        "Patched and ground the slab at {the lobby|corridor B} for flooring. Moisture tests set out. // Slab patching",
        "Poured curb and gutter along the {main drive|parking lot}, {150-240} ft. Stripped and backfilled. // Curb and gutter",
      ],
    },
    issues: [
      issue("Pump showed up {45|60} minutes late, held the pour.", D("equipment", 1, 1, "the pour", [13, 14])),
      issue("Rebar inspector found {2|3} missing ties at grid B, fixed before the pour.", D("inspection", 1, 2, "the pour start"), "site structure roughin"),
      issue("Rain in the forecast, moved the next pour to {Thursday|Monday}.", D("weather", 2, 4, "the pour schedule")),
    ],
    tomorrow: [when("site structure roughin", "Stripping forms tomorrow."), "Cylinder breaks come back next week.", "Finishers back at 6 tomorrow for the next section."],
    deliveries: [
      { what: "Rebar for the {next pour|stem walls}, {3-5} tons", from: "Rebar fabricator", stages: "site structure roughin" },
      { what: "{2|3} pallets of form ties and chairs", from: "Concrete accessories supplier", stages: "site structure" },
    ],
  },
  framing: {
    label: "Framing",
    work: {
      site: few(
        "Checked our layout against the slab. Anchor bolts at grid {A|B} are off about 1/2 inch, marked them for the GC. // Layout check",
        "Stocked the first lumber drop, {2|3} bunks of studs and plates. Covered it with tarps. // Material stocking",
        "Cut and stacked wall plates for the first floor so we can start once the slab cures. // Plate layout",
      ),
      structure: [
        "Stood second floor walls on grid lines {C–F|1–5|A–D}. Plates nailed off, {14-26} walls up. // Wall framing, level 2",
        "Set {22-40} floor joists on the {2nd|3rd} floor and started subfloor in {the east half|units 201–204}. // Floor framing",
        "Sheathing on the {north|east} elevation, about {40-70} sheets. Hold-downs in and ready for inspection. // Sheathing, hold-downs",
      ],
      roughin: [
        "Framed interior walls in units {201–206|301–306}, {12-20} door openings. Blocking for grab bars and cabinets in. // Interior framing",
        "Framed the corridor soffits for the duct run. Waiting on the final duct size before we box in {corridor C|the lobby}. // Soffit framing",
        "Fixed the framing items from the shear wall inspection, {3|4} nailing items done. // Inspection corrections",
      ],
      finishes: [
        "Set {22-38} door frames in {units 301–306|the classroom wing}. Trim and casing on level {1|2}. // Door frames, trim",
        "Installed backing for the TV mounts and handrails the owner added. Cleaned the scrap out of level {2|3}. // Backing, cleanup",
        "Framing punch: straightened {4-9} studs, added blocking at {2|3} toilet partitions. // Punch list",
      ],
    },
    issues: [
      issue("Lost 2 hours waiting on the crane.", D("equipment", 2, 2, "wall framing"), "structure"),
      issue("Wind picked up after lunch, stopped sheathing the upper wall.", D("weather", 2, 3, "sheathing", AFTER_LUNCH), "structure"),
      issue("Short on {2x6|2x8} studs, lumber yard delivers tomorrow.", D("material", 1, 2, "framing"), "structure roughin"),
      issue("Door frames came in with the wrong hand on {3|4} of them, sent back.", D("material", 1, 2, "frame install"), "finishes"),
    ],
    tomorrow: [when("structure", "Sheathing starts tomorrow if the wind stays down."), when("structure roughin", "Shear wall inspection tomorrow at 9."), when("structure roughin", "Moving up to the next floor tomorrow."), when("finishes", "Trim crew moves to level 2 tomorrow.")],
    deliveries: [
      { what: "{2|3} bunks of 2x6 studs and a load of LVLs", from: "Lumber yard", stages: "site structure roughin" },
      { what: "Trusses for the {east|west} wing, {18-28} pieces", from: "Truss plant", stages: "structure" },
      { what: "Door frames and casing for level {1|2}", from: "Door and frame supplier", stages: "finishes" },
    ],
  },
  drywall: {
    label: "Drywall",
    work: {
      site: few(
        "Walked the building with the super for the board stocking plan. Sent back the Type X and moisture board submittals. // Planning, submittals",
        "Measured the openings for the first board order, {600-900} sheets total. No crew on site yet. // Takeoff",
        "Looked at the laydown area for board, needs a covered spot. Talked to the super about using the {east|north} bay. // Site walk",
      ),
      structure: few(
        "Hung shaft wall at the {east|west} stair, {18-30} sheets. // Shaft wall",
        "Stocked board on level {1|2} with the boom, {300-480} sheets. Chalked the corridor wall layout. // Stocking, layout",
        "Hung the lid at the {mechanical room|corridor}, {14-22} sheets of 5/8 Type X. // Rated lid",
      ),
      roughin: [
        "Hung {3rd|2nd} floor corridor, {30-48} sheets of 5/8 Type X. Taped and first coat on units {301–304|201–204}. // Hang, tape, first coat",
        "Boarded the {east|west} wing ceilings, {40-60} sheets. Screw inspection before we tape. // Ceiling board",
        "Hung {26-40} sheets in the restrooms, moisture board at the wet walls. Corner bead on the {lobby|corridor} soffits. // Restroom board, bead",
      ],
      finishes: [
        "Second coat and sanding in units {201–206|301–306}. Level 4 in the {corridor|lobby}, Level 5 at the feature wall. // Finish coats, sanding",
        "Patched {18-30} holes the electricians and plumbers left in {wing B|level 2}. Skim coat on the {lobby|stairwell} wall. // Patching",
        "Touch-up after primer in {units 101–106|classrooms 4–8}, {12-20} spots the painter marked. // Touch-up",
      ],
    },
    issues: [
      issue("Short {10-16} sheets of 1/2 inch, on order for tomorrow AM.", D("material", 1, 2, "hanging board")),
      issue("Plumber still has open walls in {unit 203|restroom 2}, we can't close them until the inspection.", D("inspection", 1, 3, "closing walls"), "roughin"),
      issue("Lift battery died at 10, lost an hour charging it.", D("equipment", 1, 1, "ceiling board", [20, 20])),
    ],
    tomorrow: [when("roughin", "Tapers start on level 2 tomorrow."), "Second coat tomorrow if it dries overnight.", when("roughin", "Need the plumber's inspection done before we close up.")],
    deliveries: [
      { what: "{40-60} sheets of 5/8 Type X and {20-30} boxes of mud", from: "Drywall supply yard" },
      { what: "Metal studs and track, {2|3} bundles", from: "Steel stud supplier", stages: "roughin" },
    ],
  },
  painting: {
    label: "Painting",
    work: {
      site: few(
        "Drew down color samples for the owner, {3|4} colors on the mockup wall. Waiting on approval before we order. // Color samples",
        "Walked the job with the super to plan staging. No crew on site this week. // Site walk",
        "Checked the paint submittals against the finish schedule, {2|3} colors don't match the spec. Sent to the PM. // Submittals",
      ),
      structure: few(
        "Primed the exposed steel at the {entry canopy|loading dock}, {14-22} pieces. Touched up where the welders burned through. // Steel primer",
        "Painted the hollow metal frames stocked on site, {20-34} frames, before they go in. // Frames",
        "Primed the {mechanical room|stair} walls ahead of the equipment going in. // Primer",
      ),
      roughin: [
        "Primed the {east wing|level 1} after drywall finish, about {6000-9000} sq ft. Back rolled the corridor walls. // Prime walls",
        "Painted the exposed deck in the {warehouse|gym}, {2|3} lifts running, about {40-60}% done. // Exposed ceiling",
        "Masked and sprayed the door frames on level {1|2}, {18-30} frames. // Frames",
      ],
      finishes: [
        "Second coat in {classrooms 1–6|units 201–206}, eggshell on the walls, semi-gloss on the frames. Cut-in done by noon. // Finish coat",
        "Punch touch-up in {the lobby|wing A}, {25-40} spots off the architect's list. Caulked the base in the corridor. // Punch touch-up",
        "Painted the {stair rails|bollards}, two coats. Cleaned the spray rig and pulled the masking. // Rails, cleanup",
      ],
    },
    issues: [
      issue("Drywall not ready in {units 203–204|classroom 5}, moved the crew to the corridor.", D("coordination", 1, 2, "the finish coat")),
      issue("Humidity too high to spray this morning, started after 10.", D("weather", 2, 3, "spraying", [14, 14])),
      issue("Short {5|6} gallons of the accent color, store is mixing more."),
    ],
    tomorrow: ["Second coat tomorrow.", "Starting the stairwells tomorrow.", when("roughin", "Waiting on the architect's color approval for the lobby.")],
    deliveries: [{ what: "{20-35} gallons of wall paint and primer", from: "Paint store" }],
  },
  electrical: {
    label: "Electrical",
    work: {
      site: [
        "Ran underground conduit from the transformer pad to the building, {4|6} runs of 4 inch. Inspector signed off before backfill. // Underground conduit",
        "Set the temp power pole and spider boxes on the {north|east} side. GFCIs tested. // Temp power",
        "Laid out the underslab conduit for the {floor boxes|lobby}, {8-14} stub-ups. Ready for the concrete crew. // Underslab conduit",
      ],
      structure: [
        "Set {16-28} boxes and ran conduit in the level {2|3} deck before the pour. // Deck rough-in",
        "Stub-ups set in the slab at the {electrical room|corridor}, {10-18} runs. Hung temp lights on level {1|2}. // Stub-ups, temp lights",
        "Ran about {300-500} ft of EMT through the framing on level {1|2}. // Conduit",
      ],
      roughin: [
        "Pulled home runs for panel LP-{1|2|3}. Terminated {10-24} circuits in the {east|west} wing. // Rough-in, home runs",
        "Rough-in in units {201–206|301–306}, boxes and MC done. Ready for the in-wall inspection. // Unit rough-in",
        "Set panel gear in the main electrical room, {2|3} panels and the switchboard. Pulled feeders for {MDP|LP-1}. // Panel gear, feeders",
        "Pulled wire for the {parking lot|site} lighting, {600-900} ft. Megger tested. // Site lighting wire",
      ],
      finishes: [
        "Trimmed out devices in {units 101–106|classrooms 1–6}, {60-110} devices and plates. Hung the corridor fixtures. // Trim-out",
        "Panel schedules typed and in the doors, {3|4} panels labeled. Started the lighting control programming. // Labeling, controls",
        "Punch: {6-12} dead outlets traced to a loose neutral, fixed. Exit sign battery tests done. // Punch list",
      ],
    },
    issues: [
      issue("Locator hasn't marked the gas line yet, held the trench by the transformer pad.", D("conditions", 1, 3, "underground conduit"), "site"),
      issue("Waiting on the inspector for rough-in sign-off, he moved it to {10 AM tomorrow|Monday}.", D("inspection", 1, 2, "closing walls"), "structure roughin"),
      issue("Short {2|3} spools of 12/2 MC, picked up more from the supply house at lunch.", D("material", 1, 2, "rough-in", [23, 23]), "structure roughin"),
      issue("Duct is in our path at corridor {C|D}, sent an RFI.", D("design", 1, 2, "conduit runs"), "roughin"),
      issue("Owner changed {2|3} fixture types, waiting on the new ones.", D("design", 1, 2, "fixture install"), "finishes"),
    ],
    tomorrow: [when("site", "Inspector for the underground tomorrow AM."), when("structure roughin", "Pulling wire on level 2 tomorrow."), when("roughin", "Inspection tomorrow at 10, need the covers off."), when("finishes", "Trim-out moves to the next wing tomorrow.")],
    deliveries: [
      { what: "{3|4} spools of 12/2 MC and a box of 4 inch boxes", from: "Electrical supply house", stages: "structure roughin" },
      { what: "Panels LP-{2|3} and a transformer", from: "Switchgear supplier", stages: "structure roughin" },
      { what: "{40-80} light fixtures, {6-10} boxes", from: "Lighting supplier", stages: "finishes" },
    ],
  },
  lowvoltage: {
    label: "Low voltage / Security",
    work: {
      site: few(
        "Ran the underground pathway for the gate card reader and {2|3} site cameras. Pull string in. // Underground pathway",
        "Walked the building with the super to mark the MDF and IDF rooms. Backboards ordered. // Site walk",
        "Set the pull boxes for the site cameras, {3|4} boxes. // Pull boxes",
      ),
      structure: few(
        "Set j-hooks on level {1|2}, every 5 ft along the corridor. Marked the sleeves through the {rated|shaft} walls for firestop. // J-hooks, sleeves",
        "Installed the plywood backboards in the MDF and IDF {1|2}. Ground bar set. // Backboards",
        "Ran sleeves through the {east|west} stair walls for the backbone, {6-10} sleeves. // Sleeves",
      ),
      roughin: [
        "Pulled {48-90} Cat6 drops in the {east|west} wing. Labeled both ends, terminating at IDF {1|2} next. // Cable pulls",
        "Rough-in for card readers on {6-10} doors, brackets at the frames. Waiting on the door hardware schedule. // Access control rough-in",
        "Ran cable for {10-16} cameras in the {parking garage|warehouse}. Pulled backbone fiber to IDF {2|3}. // Camera cable, fiber",
      ],
      finishes: [
        "Terminated and tested {60-110} data drops, all passing. Saved the test reports for closeout. // Terminations, testing",
        "Hung {10-16} cameras and aimed them with the owner's rep. Programmed access for the {front entry|staff doors}. // Cameras, access control",
        "Mounted the wireless access points in {classrooms 1–8|the open office}, {12-20} units. Labeled the patch panels. // WAPs, labeling",
      ],
    },
    issues: [
      issue("Door hardware schedule still isn't final, holding the card reader rough-in.", D("design", 1, 2, "card reader rough-in"), "roughin"),
      issue("IDF {2|3} still has no door or lock, can't leave gear in there.", null, "roughin finishes"),
      issue("Ceiling grid going in before our cable is done in {wing B|corridor C}, asked the GC to hold it.", D("coordination", 1, 2, "cable pulls"), "roughin"),
      issue("Owner's IT person wasn't on site for the switch handoff, moved it to {Thursday|Monday}.", D("coordination", 1, 2, "network turnover"), "finishes"),
    ],
    tomorrow: [when("roughin", "Terminating at the IDF tomorrow."), when("finishes", "Camera aiming with the owner's rep tomorrow at 1."), when("roughin", "Fiber splicer on site tomorrow.")],
    deliveries: [
      { what: "{4|5} boxes of Cat6 and {10-16} cameras", from: "Low voltage distributor", stages: "roughin" },
      { what: "Card readers and access panels", from: "Security distributor" },
    ],
  },
  plumbing: {
    label: "Plumbing",
    work: {
      site: [
        "Roughed in underslab drains at the restrooms. Pressure test passed at 5 PSI hold. // Underslab rough-in",
        "Laid {80-140} ft of 4 inch sewer from the building to the property line. Checked grade every 10 ft. // Sewer lateral",
        "Set the {grease interceptor|sand trap} and tied in the inlet. Backfill after the inspector sees it. // Interceptor",
      ],
      structure: [
        "Set sleeves in the level {2|3} deck before the pour, {18-30} sleeves. Checked against the layout twice. // Deck sleeves",
        "Ran the {storm|roof} drain risers up through level {2|3}, {60-90} ft of cast iron. // Risers",
        "Hung the main water line on level 1, {100-160} ft of 3 inch copper. // Water main",
      ],
      roughin: [
        "Topped out the waste and vent in units {201–206|301–306}. Water lines in at the {mechanical room|risers}. // Rough-in, DWV",
        "Ran {120-200} ft of 2 inch copper on level {1|2}. Pressure test at 100 PSI held 2 hours. // Water piping, test",
        "Set the water heater and recirc pump. Gas line run to the {roof|mechanical room}, test tomorrow. // Water heater, gas",
        "Rough-in in the {restrooms|break room}, carriers set for {6-10} fixtures. // Fixture carriers",
      ],
      finishes: [
        "Set {14-26} fixtures in {restrooms 1–4|units 101–106}. Flushed and checked for leaks. // Fixture set",
        "Trimmed out the {sinks|lavs} and hooked up the {dishwasher|ice machine}. Water heater startup done. // Trim, startup",
        "Punch: snaked {3-6} slow drains and fixed a running toilet. Backflow test scheduled. // Punch list",
      ],
    },
    issues: [
      issue("Inspector wants to see the cleanout locations before we backfill.", D("inspection", 1, 2, "backfill"), "site"),
      issue("Footing at grid {C|D} is in the way of the line, sent an RFI to the engineer.", D("design", 1, 3, "underground piping"), "site"),
      issue("Missing {2|3} fittings from the order, sent a guy to the supply house.", D("material", 1, 2, "piping"), "site structure roughin"),
      issue("Framer closed a wall in {unit 204|restroom 3} before our inspection, had to open it back up.", D("coordination", 1, 2, "the in-wall inspection"), "roughin"),
      issue("Fixtures came in with the wrong {flush valves|faucets}, swapping them out.", D("material", 1, 2, "fixture set"), "finishes"),
    ],
    tomorrow: [when("structure roughin", "Pressure test on level 2 tomorrow."), "Inspector coming at 9 tomorrow.", when("finishes", "Setting fixtures in the next wing tomorrow.")],
    deliveries: [
      { what: "Cast iron and fittings for the risers, {2|3} pallets", from: "Plumbing supply house", stages: "site structure roughin" },
      { what: "Water heater and expansion tank", from: "Plumbing supply house", stages: "roughin" },
      { what: "{14-26} fixtures and trim kits", from: "Plumbing supply house", stages: "finishes" },
    ],
  },
  hvac: {
    label: "HVAC / Mechanical",
    work: {
      site: few(
        "Walked the roof plan with the super for curb locations. RTU submittals back with comments. // Planning",
        "Set sleeves for the condensate and refrigerant lines in the slab, {6-10} sleeves. // Slab sleeves",
        "Marked the underground duct route for the {lobby|gym} with the concrete foreman. // Layout",
      ),
      structure: [
        "Set {3|4} roof curbs and framed the openings with the framer. Crane booked for the RTUs. // Roof curbs",
        "Hung duct mains on level {1|2}, about {120-200} ft of {24x14|20x12}. // Duct mains",
        "Set the exhaust fans' curbs and the {kitchen|restroom} exhaust risers. // Exhaust risers",
      ],
      roughin: [
        "Hung duct mains on level {2|3}, about {140-220} ft. Started branch duct to {units 201–206|the classrooms}. // Duct mains, branches",
        "Set {2|3} RTUs with the crane, curbs sealed. Gas and power to follow. // RTU set",
        "Ran refrigerant lines for {8-14} mini-split heads in {the IDF rooms|the office wing}. Nitrogen test held. // Refrigerant piping",
      ],
      finishes: [
        "Set {30-60} diffusers and grilles in the {corridor|classrooms}. Thermostats mounted in units {101–106|201–206}. // Grilles, thermostats",
        "Started up the RTUs, {2|3} units running. Balancer coming {tomorrow|Monday}. // Startup",
        "Insulated the exposed duct in the {mechanical room|warehouse}. Labeled the equipment for closeout. // Insulation, labeling",
      ],
    },
    issues: [
      issue("Duct and the sprinkler main want the same space at corridor {C|D}, waiting on coordination.", D("coordination", 1, 3, "duct mains"), "roughin"),
      issue("RTU crane pick moved to {Thursday|Monday} for wind.", D("weather", 2, 4, "the RTU set"), "structure roughin"),
      issue("{2|3} fire dampers missing from the delivery, on order.", D("material", 1, 2, "duct install"), "structure roughin"),
      issue("Balancer found {2|3} dampers closed above the ceiling, opening them up.", null, "finishes"),
    ],
    tomorrow: [when("structure roughin", "Hanging branch duct tomorrow."), when("roughin", "Gas test on the RTUs tomorrow."), when("finishes", "Balancer starts tomorrow.")],
    deliveries: [
      { what: "{2|3} RTUs on a flatbed", from: "Equipment supplier", stages: "structure roughin" },
      { what: "Duct for level {2|3}, {2|3} pallets", from: "Sheet metal shop", stages: "structure roughin" },
      { what: "{30-60} diffusers and grilles", from: "HVAC supply house", stages: "finishes" },
    ],
  },
  fireprotection: {
    label: "Fire protection",
    work: {
      site: few(
        "Ran the underground fire line from the vault, {90-140} ft of 6 inch. Thrust blocks poured. // Underground fire line",
        "Set the riser room sleeve and pipe stub. Underground hydro test passed at 200 PSI for 2 hours. // Riser stub, test",
        "Flushed the underground with the water department watching. // Underground flush",
      ),
      structure: few(
        "Hung sprinkler main on level {1|2}, {100-180} ft of 4 inch. Hangers per the shop drawings. // Sprinkler main",
        "Set the riser and FDC piping in the riser room. // Riser",
        "Laid out hanger points on the level {2|3} deck before the pour. // Hanger layout",
      ),
      roughin: [
        "Hung branch lines in the {east|west} wing, {24-40} heads roughed in. Hydro test set for {Friday|Monday}. // Branch lines",
        "Finished the sprinkler main on level {2|3}. Moved {4|6} hangers where the duct got in the way. // Main, hanger moves",
        "Hydro test on level {1|2} held at 200 PSI for 2 hours. Inspector signed it. // Hydro test",
      ],
      finishes: [
        "Trimmed {30-60} heads after the ceiling grid went in. Escutcheons on, cages in the {mechanical room|gym}. // Head trim",
        "Flow test and alarm check with the fire alarm crew. All tamper switches report to the panel. // Flow test",
        "Fire marshal walk prep: riser tagged, spare head box stocked, hydraulic placard hung. // Closeout prep",
      ],
    },
    issues: [
      issue("Duct is in our way at {corridor B|the lobby}, moving {3|4} hangers.", D("coordination", 1, 2, "branch lines"), "roughin"),
      issue("Hydro test failed at a coupling, fixed it, retesting tomorrow.", D("inspection", 1, 2, "the hydro test"), "roughin"),
      issue("Sprinkler heads on backorder, {2|3} days out.", D("material", 1, 2, "head install")),
      issue("Ceiling crew set tiles before we trimmed the heads in {room 112|the corridor}, pulling them back out.", D("coordination", 1, 2, "head trim"), "finishes"),
    ],
    tomorrow: [when("roughin", "Hydro test tomorrow."), when("finishes", "Trimming heads in the next wing tomorrow."), when("finishes", "Fire marshal walk is next week.")],
    deliveries: [{ what: "{3|4} cases of sprinkler heads and pipe for level {2|3}", from: "Fire sprinkler supplier" }],
  },
  roofing: {
    label: "Roofing",
    work: {
      site: few(
        "Membrane and insulation submittals back. Measured the parapets for the coping order. // Submittals, takeoff",
        "Walked the roof deck with the super, deck is not ready for us yet. // Site walk",
        "Set up the material hoist spot and the dumpster for tear-off with the super. // Planning",
      ),
      structure: [
        "Insulation and cover board on the {north|east} half of the roof, about {40-60} squares. Dried in by {2|3} PM. // Insulation, dry-in",
        "Tore off the {north|south} slope and dried in by 3 PM. Tarped the rest and tied it down. // Tear-off, dry-in",
        "Set the roof drains and crickets on the {west|east} side, {4|6} drains. // Drains, crickets",
      ],
      roughin: [
        "Membrane on the {south|east} section, about {20-35} squares, seams welded and probed. // Membrane",
        "Flashed {3|4} RTU curbs and {8-12} pipe penetrations. Laid walk pads to the units. // Flashing",
        "Finished the {north|west} section and the edge metal along it. // Membrane, edge metal",
      ],
      finishes: [
        "Metal coping on the {north|east} parapet, {140-220} ft. Sealant at all the joints. // Coping",
        "Roof punch walk with the manufacturer's rep, {4-8} items: loose flashing and a few seams to re-weld. // Punch walk",
        "Swept the roof and cleared the walk pads. Warranty inspection set for {next week|Friday}. // Cleanup",
      ],
    },
    issues: [
      issue("Rain expected tomorrow, tarped the exposed area and tied it down.", null, "structure roughin"),
      issue("Wind too high after lunch to run membrane.", D("weather", 2, 3, "membrane", AFTER_LUNCH), "structure roughin"),
      issue("Crane for the material lift came late.", D("equipment", 1, 2, "loading the roof"), "structure roughin"),
      issue("Manufacturer's rep moved the warranty walk to next week.", null, "finishes"),
    ],
    tomorrow: [when("structure roughin", "Back on the membrane tomorrow if it stays dry."), when("roughin finishes", "Coping crew starts tomorrow."), when("finishes", "Manufacturer's rep back Friday.")],
    deliveries: [
      { what: "Membrane rolls and {20-30} boards of insulation", from: "Roofing supply", stages: "structure roughin" },
      { what: "Metal coping, {140-220} ft", from: "Sheet metal shop", stages: "roughin finishes" },
    ],
  },
};

// Any trade, any stage: what a foreman adds about the day itself (safety, cleanup), so Notes never stop at the work line
const SITE_LINES = [
  "Toolbox talk at 7 on {ladder safety|silica dust|heat stress|housekeeping|struck-by hazards}, everyone signed.",
  "Cleaned up the work area and hauled our scrap to the dumpster before we left.",
  "No injuries, no near misses.",
  "Everyone in PPE all day, no safety issues.",
  "Swept up and staged material for the morning.",
  "Walked the area with the super at the end of the day, nothing open on our end.",
  "Lift inspected and signed off before use.",
].map((w, i) => ({ w, key: `site.${i}` }));

// Who the crew was, adding up to the head count: the foreman plus the trade's usual mix
const CREW_ROLES = { gc: ["laborers"], sitework: ["operators", "laborers"], concrete: ["finishers", "laborers"] };
function crewMakeup(trade, workers, rand) {
  if (workers <= 1) return "Foreman only";
  const [a, b] = CREW_ROLES[trade] ?? ["journeymen", "apprentices"];
  const lead = trade === "gc" ? "1 super" : "1 foreman";
  const rest = workers - 1;
  if (!b || rest < 2) return `${lead}, ${rest} ${rest === 1 ? a.replace(/men$/, "man").replace(/s$/, "") : a}`;
  const first = between(rand, Math.ceil(rest / 2), rest - 1);
  const one = (n, word) => `${n} ${n === 1 ? word.replace(/men$/, "man").replace(/s$/, "") : word}`;
  return `${lead}, ${one(first, a)}, ${one(rest - first, b)}`;
}

const CONDITIONS = ["Good, no damage.", "All there, checked it against the ticket.", "One bundle wet, rest is fine.", "{1|2} pieces damaged, told the PM."];

// The project's delay types (Procore names them); the bank's kinds match by words
const DELAY_WORDS = {
  weather: /weather/i, material: /material|deliver/i, inspection: /inspect/i, coordination: /coordinat|trade|subcontract/i,
  design: /design|rfi|owner|change/i, conditions: /existing|condition|site/i, equipment: /equipment/i,
};
export function delayTypeFor(kind, types = []) {
  const re = DELAY_WORDS[kind];
  const names = types.map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean);
  return (re && names.find((n) => re.test(n))) || "";
}

// ---------- building one sample ----------

/** A small seeded random (tests and repeatable previews); Math.random otherwise */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const shuffle = (rand, list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
/** Fills {a|b} and {12-30} */
export const fill = (s, rand) => String(s).replace(/\{([^{}]+)\}/g, (_, body) => {
  const range = /^(\d+)-(\d+)$/.exec(body);
  return range ? String(between(rand, Number(range[1]), Number(range[2]))) : pick(rand, body.split("|"));
});
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const spoken = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`; };
const firstName = (name) => String(name).split(/\s+/)[0];
const shortCompany = (c) => String(c || "").replace(/,?\s+(Inc\.?|LLC|Co\.?|Corp\.?|Group)$/i, "").trim();

const workList = (trade, stage) => (TRADES[trade]?.work?.[stage] ?? []).map((x, i) => ({ ...(typeof x === "string" ? { w: x } : x), key: `${trade}.${stage}.${i}` }));
const mainStages = (trade) => STAGE_KEYS.filter((st) => (TRADES[trade]?.work?.[st] ?? []).some((x) => typeof x === "string" || !x.few));
// One kind of line (issue, tomorrow, delivery) that fits this stage, with its bank key
const listKeys = (trade, kind, list, stage) => (list ?? [])
  .map((x, i) => ({ ...(typeof x === "string" ? { w: x } : x), key: `${trade}.${kind}.${i}` }))
  .filter((x) => (x.stages ? x.stages.split(" ") : mainStages(trade)).includes(stage));
// A line not yet used in this project's other samples; none left = leave that part out (no repeated sentences).
// Work lines may repeat only when every one has been used (never with 3 samples: each stage has 3 or more).
const unused = (list, used) => list.filter((x) => !used.has(x.key));
const fresh = (rand, list, used) => (unused(list, used).length ? pick(rand, unused(list, used)) : null);

/**
 * One day's log for one foreman. `used` = bank keys already in this project's other samples (no repeated
 * sentences); `odds` lets tests force a delivery / issue / delay.
 */
export function buildSample({ foreman, date, stage, delayTypes = [], used = new Set(), rand = Math.random, odds = {} }) {
  const trade = TRADES[foreman.trade] ? foreman.trade : "gc";
  const T = TRADES[trade];
  const keys = [];
  const work = fresh(rand, workList(trade, stage), used) ?? pick(rand, workList(trade, stage));
  keys.push(work.key);
  const [did, manpowerText] = fill(work.w, rand).split(" // ");
  const workers = between(rand, ...(work.crew ?? [4, 12]));
  const hours = between(rand, ...(work.hours ?? [6, 10]));

  const sentences = [did];
  let delay = null;
  let issueSaid = "";
  let tomorrow = "";
  const iss = rand() < (odds.issue ?? 1 / 3) ? fresh(rand, listKeys(trade, "issue", T.issues, stage), used) : null;
  if (iss) {
    keys.push(iss.key);
    const said = fill(iss.w, rand);
    issueSaid = said;
    sentences.push(said);
    if (iss.delay && rand() < (odds.delay ?? 0.75)) {
      const lost = between(rand, ...iss.delay.hours);
      const start = between(rand, ...iss.delay.at) * 30;
      delay = {
        type: delayTypeFor(iss.delay.type, delayTypes), start: hhmm(start), end: hhmm(start + lost * 60), company: foreman.companyId,
        comment: `${said} Lost about ${lost} hour${lost === 1 ? "" : "s"} on ${iss.delay.what}.`, hoursLost: lost,
      };
    }
  }
  let delivery = null;
  const d = rand() < (odds.delivery ?? 1 / 3) ? fresh(rand, listKeys(trade, "delivery", T.deliveries, stage), used) : null;
  if (d) {
    keys.push(d.key);
    const condition = fill(pick(rand, CONDITIONS), rand);
    delivery = { what: fill(d.what, rand), from: d.from, time: hhmm(between(rand, 13, 28) * 30), comment: `${condition} Signed by ${foreman.name}.` };
    sentences.push(`${delivery.from} dropped off ${delivery.what.charAt(0).toLowerCase()}${delivery.what.slice(1)}.`);
  }
  // Enough detail: 3 to 5 sentences after "Reported by" (spec: 2 to 5). A safety / cleanup line, then the plan for
  // tomorrow, are added while it's short; each only once per project.
  const count = () => sentences.join(" ").split(/(?<=\.)\s+/).filter(Boolean).length;
  const siteLines = [];
  const addSite = () => {
    const x = fresh(rand, SITE_LINES, used);
    if (!x) return false;
    keys.push(x.key);
    used.add(x.key);
    siteLines.push(fill(x.w, rand));
    sentences.push(siteLines.at(-1));
    return true;
  };
  if (count() < 4 && rand() < 0.5) addSite();
  const t = count() < 5 && !/tomorrow/i.test(issueSaid) && (count() < 3 || rand() < 0.6) ? fresh(rand, listKeys(trade, "tomorrow", T.tomorrow, stage), used) : null;
  if (t) {
    keys.push(t.key);
    tomorrow = fill(t.w, rand);
    sentences.push(tomorrow);
  }
  while (count() < 3 && addSite());
  const start = between(rand, 13, 14) * 30; // 6:30 or 7:00 AM
  const makeup = crewMakeup(trade, workers, rand);
  const manpowerComment = `${manpowerText ?? T.label}. ${makeup}. On site ${spoken(hhmm(start))} to ${spoken(hhmm(start + hours * 60 + 30))}.`;

  const reportedBy = `Reported by: ${[foreman.name, foreman.title, foreman.company].filter(Boolean).join(", ")}`.replace(/\.?$/, ".");
  const notes = `${reportedBy} ${sentences.join(" ")} ${MARKER}`;
  const script = [
    `Daily log for ${weekday(date)}.`,
    `This is ${firstName(foreman.name)}${foreman.company ? ` with ${shortCompany(foreman.company)}` : ""}.`,
    `Crew of ${workers} today, ${makeup.toLowerCase()}, ${hours} hours, ${spoken(hhmm(start))} to ${spoken(hhmm(start + hours * 60 + 30))}.`,
    did,
    issueSaid,
    delay ? `Put that down as a delay${delay.type ? `, ${delay.type.toLowerCase()}` : ""}, about ${spoken(delay.start)} to ${spoken(delay.end)}.` : "",
    delivery ? `Delivery came in around ${spoken(delivery.time)} from the ${delivery.from.toLowerCase()}, ${delivery.what.charAt(0).toLowerCase()}${delivery.what.slice(1)}. ${delivery.comment.replace(/Signed by .*$/, "I signed for it.")}` : "",
    ...siteLines,
    tomorrow,
  ].filter(Boolean).join(" ");

  return {
    date, trade, tradeLabel: T.label, stage,
    foreman: { id: foreman.id, name: foreman.name, title: foreman.title, company: foreman.company, companyId: foreman.companyId },
    manpower: { workers, hours, company: foreman.companyId, trade: T.label, comment: manpowerComment },
    notes: { text: notes },
    ...(delivery ? { delivery: { what: delivery.what, from: delivery.from, time: delivery.time, comment: delivery.comment } } : {}),
    ...(delay ? { delay: { type: delay.type, start: delay.start, end: delay.end, company: delay.company, comment: delay.comment } } : {}),
    script, keys,
  };
}

/**
 * `count` samples for one project: different dates, different foremen when there are 2+, different trades when
 * possible, no bank line used twice. `avoid` = keys of samples kept on the page (for Regenerate).
 */
export function makeSamples({ foremen = [], dates = [], stage = "roughin", count = 3, avoid = [], delayTypes = [], rand = Math.random, newId = () => Math.random().toString(36).slice(2, 12) }) {
  if (!foremen.length || !dates.length) return [];
  // Spread over trades first, then people, then cycle
  const order = [];
  const byTrade = new Map();
  for (const f of shuffle(rand, foremen)) byTrade.set(f.trade, [...(byTrade.get(f.trade) ?? []), f]);
  while (order.length < foremen.length) for (const list of byTrade.values()) if (list.length) order.push(list.shift());
  const days = shuffle(rand, dates);
  const used = new Set(avoid);
  const out = [];
  for (let i = 0; i < Math.min(count, days.length); i++) {
    const s = buildSample({ foreman: order[i % order.length], date: days[i], stage, delayTypes, used, rand });
    s.keys.forEach((k) => used.add(k));
    out.push({ id: newId(), ...s });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const stageKeys = STAGE_KEYS;
