// Full-loop demo, Step 0 (Ky's SITESNAP_FULL_LOOP_DEMO_SPEC.md v4, section 3): is the PM account (and, for
// Option B, the second Foreman/Sub user) set up in each demo project? Pure functions over what Procore answered,
// so tests can check every PASS / PARTIAL / FAIL rule. The page that gathers the answers (GET calls only) is
// api/procore/demo-check.js. Emails are compared here and never returned.
//
// Levels (company template user_access_levels, sandbox 2026-10-15): 1 None, 2 Read Only, 3 Standard, 4 Admin.
// Procore's Admin level on a tool includes changing any item's status; whether Standard may close an
// Observation it didn't create isn't confirmed, so Standard is PARTIAL for the PM's close/reopen.

export const PASS = "PASS";
export const PARTIAL = "PARTIAL";
export const FAIL = "FAIL";
const RANK = { [PASS]: 0, [PARTIAL]: 1, [FAIL]: 2 };
export const worst = (rows) => rows.reduce((w, r) => (RANK[r.result] > RANK[w] ? r.result : w), PASS);

const WORDS = { none: 1, read_only: 2, readonly: 2, standard: 3, admin: 4 };
/** A tool level as 1-4 (numbers or Procore's words), else null */
export function levelNum(v) {
  if (v && typeof v === "object") v = v.level ?? v.value ?? v.name;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1 && n <= 4) return n;
  return WORDS[String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}
const LEVEL_NAME = { 1: "None", 2: "Read Only", 3: "Standard", 4: "Admin" };
const lvl = (n) => (n == null ? "not readable" : LEVEL_NAME[n]);

// The trades the demo assigns to (spec sections 3 and 8)
export const TRADES = [
  { label: "Drywall", re: /drywall|gypsum/i },
  { label: "Electrical", re: /electric/i },
  { label: "Plumbing", re: /plumb/i },
  { label: "Roofing / Envelope", re: /roof|envelope|waterproof|cladding|glaz/i },
];

const lower = (s) => String(s ?? "").trim().toLowerCase();
export const nameOf = (u) => u?.name || [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "";
const isActive = (u) => u?.is_active !== false;

/** The project person for an email or a name (emails compared lower case), else null */
export function findPerson(people, who) {
  const w = lower(who);
  if (!w) return null;
  return people.find((u) => lower(u.email_address) === w || lower(u.login) === w)
    ?? people.find((u) => lower(nameOf(u)) === w) ?? null;
}

// Status names as Procore's values (initiated, ready_for_review, …), whatever shape the statuses list has
export function statusValues(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  return list.map((s) => lower(typeof s === "string" ? s : s?.status ?? s?.value ?? s?.name ?? s?.label).replace(/[\s-]+/g, "_")).filter(Boolean);
}

/**
 * One project's rows. input:
 *   project { projectId, name, open }        open = the signed-in account can open it
 *   people   project users (normal view: name, email_address, is_active, job_title, vendor, permission_template)
 *   levels   { [templateId]: { observations, images, directory } } as 1-4 or null (unreadable)
 *   assignees ids Procore's Observations will take as assignee (a Set), or null when that list didn't answer
 *   statuses  Procore's Observation status values, or null
 *   vendors   project companies, with trades[] (view=extended) when readable
 *   obsTotal, photoTotal  counts, or null
 *   pm, assignee  the email (or name) to look for; assignee empty = Option A (not checked)
 */
export function evaluateProject(input) {
  const { project, people = [], levels = {}, assignees = null, statuses = null, vendors = [], obsTotal = null, photoTotal = null, pm, assignee } = input;
  const rows = [];
  const add = (check, result, detail) => rows.push({ check, result, detail });

  if (!project.open) {
    add("Project open to this sign-in", FAIL, "The signed-in account can't open this project in Procore. Add it to the project's Directory.");
    return rows;
  }

  // 1. The PM account is in the Directory and active
  const me = findPerson(people, pm);
  if (!me) add("PM account in the Directory", FAIL, "Not in this project's Directory. Add it (Directory → Add User) with the PM permission template.");
  else if (!isActive(me)) add("PM account in the Directory", FAIL, `${nameOf(me)} is in the Directory but inactive. Reactivate them in the project Directory.`);
  else add("PM account in the Directory", PASS, `${nameOf(me)}, active.`);

  // 2. Permission template and effective access
  if (me) rows.push(...accessRows("PM", me, levels, { wantClose: true }));

  // Statuses the loop moves through
  if (statuses == null) add("Observation statuses", PARTIAL, "Procore didn't return the status list; the loop's statuses can't be confirmed yet.");
  else {
    const need = ["initiated", "ready_for_review", "closed"];
    const missing = need.filter((s) => !statuses.includes(s));
    add("Observation statuses", missing.length ? FAIL : PASS, `${statuses.join(", ") || "none"}${missing.length ? `. Missing: ${missing.join(", ")}` : ""}.`);
  }

  // Can the PM account itself be an Observation assignee (open question 5)
  if (me) {
    if (!assignees) add("PM on the Observations assignee list", PARTIAL, "Procore's assignee list didn't answer.");
    else add("PM on the Observations assignee list", assignees.has(String(me.id)) ? PASS : PARTIAL, assignees.has(String(me.id)) ? "Yes: Observations can be assigned to the PM account." : "No: the PM account can't be an assignee here (fine for Option A: the item is assigned to a trade contact).");
  }

  // 3. Realistic trades, each with someone Procore will take as the Observation assignee
  for (const t of TRADES) rows.push(tradeRow(t, people, vendors, assignees));

  // 4. Option B: the second Foreman/Sub user
  if (lower(assignee)) {
    const sub = findPerson(people, assignee);
    if (!sub) add("Option B user in the Directory", FAIL, "Not in this project's Directory. Add them with a Foreman or Subcontractor template.");
    else if (!isActive(sub)) add("Option B user in the Directory", FAIL, `${nameOf(sub)} is inactive in this project.`);
    else {
      add("Option B user in the Directory", PASS, `${nameOf(sub)}, active${sub.vendor?.name ? `, ${sub.vendor.name}` : ""}.`);
      if (!assignees) add("Option B user can be assigned", PARTIAL, "Procore's assignee list didn't answer.");
      else add("Option B user can be assigned", assignees.has(String(sub.id)) ? PASS : FAIL, assignees.has(String(sub.id)) ? "On Procore's Observations assignee list." : "Not on Procore's Observations assignee list: their template needs Observations access.");
      rows.push(...accessRows("Option B user", sub, levels, { wantClose: false }));
    }
  }

  // Prep data (section 8)
  if (obsTotal == null) add("Sample Observations (2+)", PARTIAL, "Couldn't count them.");
  else add("Sample Observations (2+)", obsTotal >= 2 ? PASS : PARTIAL, `${obsTotal} in the project.`);
  if (photoTotal == null) add("Photos in Procore Photos (3+)", PARTIAL, "Couldn't count them.");
  else add("Photos in Procore Photos (3+)", photoTotal >= 3 ? PASS : PARTIAL, `${photoTotal} in the project.`);
  return rows;
}

function accessRows(who, u, levels, { wantClose }) {
  const rows = [];
  const t = u.permission_template;
  if (!t?.id) {
    // Company admins have every tool without a project template (seen 2026-10-15), so this isn't a no
    rows.push({ check: `${who} permission template`, result: PARTIAL, detail: "No project permission template shown. A company admin still has every tool; confirm, or give them a template." });
    return rows;
  }
  const l = levels[String(t.id)] ?? {};
  rows.push({ check: `${who} permission template`, result: PASS, detail: `"${t.name}"` });
  const obs = l.observations ?? null;
  const img = l.images ?? null;
  if (wantClose) {
    const r = obs == null ? PARTIAL : obs >= 4 ? PASS : obs === 3 ? PARTIAL : FAIL;
    const why = obs == null ? "The template's levels couldn't be read (only a Procore admin can read them)."
      : obs >= 4 ? "Create, edit, assign, respond and change status, including close and reopen."
        : obs === 3 ? "Standard creates, edits and responds; closing others' items isn't confirmed at Standard. Raise Observations to Admin in this template for a sure close/reopen."
          : "Can't create Observations. Raise Observations to Admin in this template.";
    rows.push({ check: `${who} Observations: ${lvl(obs)}`, result: r, detail: why });
  } else {
    const r = obs == null ? PARTIAL : obs === 3 ? PASS : obs >= 4 ? PARTIAL : FAIL;
    const why = obs == null ? "The template's levels couldn't be read."
      : obs === 3 ? "Standard: can respond and add photos; not an admin, as the spec wants."
        : obs >= 4 ? "Admin: can also close items. The spec's Option B wants this user unable to close (Standard)."
          : "Can't respond to Observations. Raise Observations to Standard.";
    rows.push({ check: `${who} Observations: ${lvl(obs)}`, result: r, detail: why });
  }
  const ri = img == null ? PARTIAL : img >= 3 ? PASS : FAIL;
  rows.push({ check: `${who} Photos: ${lvl(img)}`, result: ri, detail: img == null ? "The template's levels couldn't be read." : img >= 3 ? "Can upload photos." : "Can't upload photos. Raise Photos to Standard in this template." });
  return rows;
}

function tradeRow(t, people, vendors, assignees) {
  const check = `Trade: ${t.label}`;
  const tradeNames = (v) => (Array.isArray(v?.trades) ? v.trades.map((x) => x?.name ?? x).join(" ") : "");
  const firms = vendors.filter((v) => t.re.test(v?.name ?? "") || t.re.test(tradeNames(v)));
  const firmIds = new Set(firms.map((v) => String(v.id)));
  const crew = people.filter((u) => isActive(u) && (firmIds.has(String(u.vendor?.id ?? "")) || t.re.test(u.vendor?.name ?? "") || t.re.test(u.job_title ?? "")));
  if (!firms.length && !crew.length) return { check, result: FAIL, detail: "No company or person for this trade in the project. Add a company with this trade and one person." };
  const ready = assignees ? crew.filter((u) => assignees.has(String(u.id))) : [];
  const who = (list) => list.slice(0, 3).map((u) => `${nameOf(u)}${u.vendor?.name ? ` (${u.vendor.name})` : ""}`).join(", ");
  if (ready.length) return { check, result: PASS, detail: `${who(ready)} can be assigned.` };
  if (!crew.length) return { check, result: PARTIAL, detail: `${firms.map((v) => v.name).join(", ")} is on the project, with no active person.` };
  return { check, result: PARTIAL, detail: assignees ? `${who(crew)} on the project, but not on Procore's Observations assignee list (their template needs Observations access).` : `${who(crew)} on the project; the assignee list didn't answer.` };
}
