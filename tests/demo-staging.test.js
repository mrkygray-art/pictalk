// The Demo staging page (api/procore/demo-staging.js, api/_demoImport.js, api/_demoScenarios.js) against a mocked
// Procore and an in-memory SiteSnap store. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import demoStaging from "../api/procore/demo-staging.js";
import records from "../api/procore/records.js";
import { pace } from "../api/_seedSteps.js";
import { setDemoStore } from "../api/_demoImport.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import {
  DEMO_PEOPLE, SCENARIOS, archivedTitle, cardFor, copyForClaude, demoProjects, directorySeed, personByKey, plannedShape, statusFrom,
} from "../api/_demoScenarios.js";
import { cleanupPlan } from "../api/_seedDirectory.js";

pace.gapMs = 0;
pace.spikeWaitMs = 0;

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  DEMO_MODE: "true", DEMO_PROJECT_IDS: "HP:1001,WG:1002,LV:1003", IMPORT_BATCH_SIZE: "3",
};
const CO = "4291776";
let calls, routes, saved, db, nextId, admin;

// In-memory stand-in for the Firestore side (same interface as store() in api/_demoImport.js)
function memoryStore() {
  const table = new Map(); const threads = new Map(); const msgs = new Map(); let meta = {};
  return {
    table, threads, msgs,
    async rows() { return Object.fromEntries([...table].map(([k, v]) => [k, structuredClone(v)])); },
    async saveRow(id, row) { table.set(id, structuredClone(row)); },
    async meta() { return meta; },
    async saveMeta(p) { meta = { ...meta, ...p }; },
    async threadExists(key, cid) { return threads.has(`${key}/${cid}`); },
    async putThread(key, cid, d) { threads.set(`${key}/${cid}`, d); },
    async messageExists(key, cid, mid) { return msgs.has(`${key}/${cid}/${mid}`); },
    async putMessage(key, cid, mid, d) { msgs.set(`${key}/${cid}/${mid}`, d); },
    async threadsFor(key, ids) {
      const want = new Set(ids.map(Number));
      return [...threads].filter(([k, t]) => k.startsWith(`${key}/`) && (t.demo || want.has(Number(t.procore?.id)))).map(([k]) => k.split("/")[1]);
    },
    async deleteThread(key, cid) { threads.delete(`${key}/${cid}`); for (const k of [...msgs.keys()]) if (k.startsWith(`${key}/${cid}/`)) msgs.delete(k); },
  };
}

beforeEach(() => {
  calls = []; routes = []; nextId = 500; admin = true;
  db = memoryStore();
  setDemoStore(db);
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, ENV);
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: init.method ?? "GET", body });
    const r = routes.find((x) => x.test(u, init));
    if (!r) throw new Error(`unexpected fetch ${init.method ?? "GET"} ${u}`);
    const { status = 200, body: out = {} } = typeof r.reply === "function" ? r.reply(u, init, body) : r.reply;
    return new Response(JSON.stringify(out), { status, headers: { "content-type": "application/json" } });
  };
  baseRoutes();
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { log: saved.log, error: saved.error });
  setDemoStore(null);
});

const on = (method, re, reply) => routes.push({ test: (u, init) => (init.method ?? "GET") === method && re.test(u), reply });
const onFirst = (method, re, reply) => routes.unshift({ test: (u, init) => (init.method ?? "GET") === method && re.test(u), reply });
const projectUsers = (pid) => DEMO_PEOPLE.filter((p) => p.projects.includes({ 1001: "HP", 1002: "WG", 1003: "LV" }[pid]))
  .map((p, i) => ({ id: 9000 + DEMO_PEOPLE.indexOf(p), email_address: p.email_address, vendor: { name: p.company }, i }));

function baseRoutes() {
  on("GET", /\/rest\/v1\.0\/companies\?/, { body: [{ id: Number(CO), name: "Ky's sandbox" }] });
  on("GET", /\/rest\/v1\.1\/projects\?/, { body: [{ id: 1001, name: "Harbor Point" }, { id: 1002, name: "Westgate" }, { id: 1003, name: "Lakeview" }, { id: 2000, name: "Real project" }] });
  on("GET", /\/projects\/\d+\/permission_templates$/, { body: [{ id: 5, name: "Project Manager - Internal" }] });
  on("GET", /\/companies\/\d+\/permission_templates\/5/, () => (admin ? { body: { id: 5 } } : { status: 403, body: { error: "forbidden" } }));
  on("GET", /\/rest\/v1\.0\/me/, { body: { id: 7, name: "Ky Gray" } });
  on("GET", /\/rest\/v1\.0\/projects\/(\d+)\/users\?/, (u) => ({ body: projectUsers(u.match(/projects\/(\d+)\//)[1]) }));
  on("GET", /\/observation_types/, { body: [{ id: 1, name: "Safety", active: true }, { id: 2, name: "Quality", active: true }] });
  on("POST", /\/rest\/v1\.1\/projects\/\d+\/uploads/, { body: { uuid: "up-1", url: "https://s3.procore.test/up", fields: { key: "k" } } });
  on("POST", /s3\.procore\.test/, { body: {} });
  on("POST", /\/rest\/v1\.0\/observations\/items$/, () => ({ status: 201, body: { id: ++nextId, number: nextId - 500 } }));
  on("POST", /\/rest\/v1\.1\/punch_items$/, () => ({ status: 201, body: { id: ++nextId, position: nextId - 500 } }));
  on("POST", /\/response_logs/, { status: 201, body: { id: 1 } });
  on("POST", /\/punch_items\/\d+\/comments/, { status: 201, body: { id: 1 } });
  on("PATCH", /\/(observations\/items|punch_items)\/\d+/, { body: {} });
  on("GET", /\/(observations\/items|punch_items)\/\d+\?/, { body: { id: 1, name: "[SS-DEMO] x" } });
}

const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = (method, body, url = "/api/procore/demo-staging") => ({
  method, url, body,
  headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` },
});
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const post = async (body, handler = demoStaging) => { const out = res(); await handler(req("POST", body), out); return out; };
const creates = () => calls.filter((c) => c.method === "POST" && /\/(observations\/items|punch_items)$/.test(c.url));

// ---------- data ----------

test("the scenarios: 15, three projects, every title tagged, people on their projects, shape as planned", () => {
  assert.equal(SCENARIOS.length, 15);
  assert.deepEqual(plannedShape(), { HP: { open: 3, overdue: 1, closed: 1 }, WG: { open: 4, overdue: 1, closed: 1 }, LV: { open: 4, overdue: 1, closed: 2 } });
  for (const s of SCENARIOS) {
    assert.match(cardFor(s).title, /^\[SS-DEMO\] /, s.id);
    for (const k of [s.speaker, s.assignee, ...s.tagged]) assert.ok(personByKey(k)?.projects.includes(s.project), `${s.id}: ${k} isn't on ${s.project}`);
    if (s.planned === "closed") assert.ok(s.closingComment, s.id);
    if (s.planned === "overdue") assert.ok(s.due < 0, s.id);
  }
  for (const p of DEMO_PEOPLE) assert.match(p.email_address, /@example\.com$/);
  assert.equal(directorySeed("LV").flatMap((c) => c.users).length, 7);
});

test("settings: the allowlist needs all three ids; a tagged title archives once", () => {
  assert.deepEqual(demoProjects({ DEMO_PROJECT_IDS: "HP:1, WG=2 ,lv:3" }), { HP: "1", WG: "2", LV: "3" });
  assert.equal(demoProjects({ DEMO_PROJECT_IDS: "HP:1,WG:2" }), null);
  assert.equal(demoProjects({ DEMO_PROJECT_IDS: "HP:1,WG:1,LV:3" }), null);
  assert.equal(archivedTitle("[SS-DEMO][ARCHIVED] Ladder"), "[SS-DEMO][ARCHIVED] Ladder");
  assert.equal(archivedTitle("[SS-DEMO] Ladder"), "[SS-DEMO][ARCHIVED] Ladder");
});

test("status model and the Copy for Claude text", () => {
  const s = SCENARIOS.find((x) => x.id === "HP-03");
  assert.equal(statusFrom(s, {}), "not_imported");
  assert.equal(statusFrom(s, { last_error: "x" }), "failed");
  assert.equal(statusFrom(s, { procore_id: "1", steps_completed: ["create"] }), "partial");
  assert.equal(statusFrom(s, { procore_id: "1", steps_completed: ["create", "photo", "assignee", "close", "thread"] }), "imported");
  const text = copyForClaude([{ id: "HP-01", import_status: "imported" }, { id: "HP-04", import_status: "failed", steps_completed: [], last_error: "Step 1 of 4 failed (create the record): nope" }]);
  assert.match(text, /1 of 2 not fully imported/);
  assert.match(text, /HP-04 \(failed\).*Step 1 of 4 failed/);
  assert.doesNotMatch(text, /HP-01/);
});

test("the test-people cleanup never offers the demo people or companies", () => {
  const plan = cleanupPlan({ users: [{ id: 1, email_address: "dana.whitfield@example.com", vendor: { id: 2 } }], vendors: [{ id: 2, name: "Cornerstone Builders" }], meId: 7 });
  assert.equal(plan.users[0].action, "keep");
  assert.equal(plan.vendors[0].action, "keep");
});

// ---------- who can reach it ----------

test("GET: 404 unless DEMO_MODE=true; the page carries noindex", async () => {
  process.env.DEMO_MODE = "false";
  let out = res(); await demoStaging(req("GET"), out);
  assert.equal(out.statusCode, 404);
  process.env.DEMO_MODE = "true";
  out = res(); await demoStaging(req("GET"), out);
  assert.equal(out.statusCode, 200);
  assert.match(out.body, /noindex/);
  assert.equal(out.headers["x-robots-tag"], "noindex, nofollow");
});

test("POST: 404 when DEMO_MODE is off, 403 and no data for a non-admin", async () => {
  process.env.DEMO_MODE = "";
  assert.equal((await post({ action: "state" })).statusCode, 404);
  process.env.DEMO_MODE = "true";
  admin = false;
  const out = await post({ action: "state" });
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().error, "not_admin");
  assert.equal(out.json().rows, undefined);
  assert.equal(db.table.size, 0);
  // Nor any other action
  assert.equal((await post({ action: "reset", code: "HP", dryRun: false })).statusCode, 403);
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
});

test("state: all 15 rows saved to SiteSnap's copy first, all not imported; setup list when ids are missing", async () => {
  const b = (await post({ action: "state" })).json();
  assert.equal(b.rows.length, 15);
  assert.equal(db.table.size, 15);
  assert.deepEqual(b.summary, { total: 15, imported: 0, not_imported: 15, partial: 0, failed: 0 });
  assert.equal(b.demo.HP.projectId, "1001");
  process.env.DEMO_PROJECT_IDS = "";
  const c = (await post({ action: "state" })).json();
  assert.equal(c.configured, false);
  assert.equal(c.choices.length, 4);
  assert.equal((await post({ action: "reset", code: "HP" })).statusCode, 409);
});

// ---------- import ----------

test("import next batch: 3 at most, one after another, tagged, photo, assignee, closed one closed, threads written", async () => {
  const b = (await post({ action: "import", mode: "next" })).json();
  assert.deepEqual(b.results.map((r) => [r.id, r.status]), [["HP-01", "imported"], ["HP-02", "imported"], ["HP-03", "imported"]]);
  const made = creates();
  assert.equal(made.length, 3);
  const first = made[0].body;
  assert.equal(first.project_id, 1001);
  assert.equal(first.observation.name, "[SS-DEMO] Steel bars in footing look spaced too wide");
  assert.equal(first.observation.type_id, 2); // Quality
  assert.deepEqual(first.observation.assignee_ids, [9000 + DEMO_PEOPLE.indexOf(personByKey("luis"))]);
  assert.deepEqual(first.observation.upload_ids, ["up-1"]);
  assert.equal(first.observation.personal, false);
  assert.match(first.observation.description, /Alicia Nguyen \(demo\)/);
  assert.match(first.observation.description, /rebar looks wider than the plan/);
  assert.equal(made[2].body.observation.type_id, 1); // Safety
  // HP-03 closed with its comment
  const close = calls.find((c) => /response_logs/.test(c.url));
  assert.deepEqual(close.body, { project_id: 1001, response_log: { comment: "Barricade and caution tape installed." }, status: "closed" });
  // SiteSnap threads, the closed one closed, with the comment and a Closed line
  const t = db.threads.get(`${CO}_1001/demo-hp-03`);
  assert.equal(t.status, "closed");
  assert.equal(t.demo, true);
  assert.equal(t.procore.recordType, "observation");
  assert.equal(t.createdBy.name, "Luis Herrera");
  assert.deepEqual(t.tagged.map((x) => x.name), ["Marcus Ortega"]);
  assert.equal(db.msgs.get(`${CO}_1001/demo-hp-03/demo-hp-03-2`).text, "Barricade and caution tape installed.");
  assert.equal(db.msgs.get(`${CO}_1001/demo-hp-03/demo-hp-03-3`).event, "closed");
  // Run again: the next three, never these again
  const again = (await post({ action: "import", mode: "next" })).json();
  assert.deepEqual(again.results.map((r) => r.id), ["HP-04", "WG-01", "WG-02"]);
  assert.equal(creates().length, 6);
});

test("a 429 stops the batch: nothing else is sent, the rest say retry later", async () => {
  let n = 0;
  onFirst("POST", /\/rest\/v1\.0\/observations\/items$/, () => (++n === 2 ? { status: 429, body: {} } : { status: 201, body: { id: ++nextId, number: 1 } }));
  const b = (await post({ action: "import", mode: "next" })).json();
  assert.equal(b.rateLimited, true);
  assert.deepEqual(b.results.map((r) => r.id), ["HP-01", "HP-02", "HP-03"]);
  assert.equal(n, 2); // HP-03 never tried
  assert.match(db.table.get("HP-02").last_error, /429 rate limited, retry later/);
  assert.match(db.table.get("HP-03").last_error, /429 rate limited, retry later/);
  const st = (await post({ action: "state" })).json();
  assert.equal(st.summary.imported, 1);
  assert.equal(st.summary.failed, 2);
});

test("partial: someone not in the directory leaves it Partial with a plain error; retry resumes, no duplicate", async () => {
  const luis = personByKey("luis").email_address;
  let hide = true;
  onFirst("GET", /\/rest\/v1\.0\/projects\/1001\/users\?/, () => ({ body: projectUsers("1001").filter((u) => !hide || u.email_address !== luis) }));
  await post({ action: "import", mode: "selected", ids: ["HP-01"] });
  const row = db.table.get("HP-01");
  assert.equal(row.import_status, "partial");
  assert.match(row.last_error, /^Step 3 of 4 failed \(assign\): could not assign Luis Herrera \(not in the project directory/);
  assert.equal(creates().length, 1);
  hide = false;
  const b = (await post({ action: "import", mode: "failed" })).json();
  assert.deepEqual(b.results.map((r) => [r.id, r.status]), [["HP-01", "imported"]]);
  assert.equal(creates().length, 1); // resumed, not re-created
  const fix = calls.find((c) => c.method === "PATCH" && /observations\/items\/501/.test(c.url));
  assert.deepEqual(fix.body.observation, { assignee_ids: [9000 + DEMO_PEOPLE.indexOf(personByKey("luis"))] });
});

test("a record deleted in Procore since is made again on retry", async () => {
  await post({ action: "import", mode: "selected", ids: ["WG-04"] });
  assert.equal(db.table.get("WG-04").import_status, "imported");
  db.table.set("WG-04", { ...db.table.get("WG-04"), steps_completed: ["create"] });
  onFirst("GET", /\/punch_items\/501\?/, { status: 404, body: {} });
  await post({ action: "import", mode: "failed" });
  assert.equal(creates().length, 2);
  assert.equal(db.table.get("WG-04").procore_id, "502");
});

test("mark imported by hand: checks Procore, records the id", async () => {
  onFirst("GET", /\/observations\/items\/777\?/, { status: 404, body: {} });
  assert.equal((await post({ action: "mark", id: "HP-02", procoreId: "777" })).statusCode, 404);
  assert.equal((await post({ action: "mark", id: "HP-02", procoreId: "778" })).statusCode, 200);
  const row = db.table.get("HP-02");
  assert.equal(row.procore_id, "778");
  assert.equal(row.manual, true);
  assert.equal((await post({ action: "state" })).json().rows.find((r) => r.id === "HP-02").import_status, "imported");
});

// ---------- reset ----------

test("reset: dry run lists only tagged records in the project; then deletes, archives what Procore won't delete", async () => {
  await post({ action: "import", mode: "next" }); // HP-01..03 -> 501..503
  db.table.set("HP-04", { id: "HP-04", procore_id: "999", record_type: "observation", project_code: "HP", steps_completed: ["create"] });
  on("GET", /\/rest\/v1\.0\/observations\/items\?/, { body: [
    { id: 501, name: "[SS-DEMO] Steel bars" }, { id: 502, name: "[SS-DEMO] Standing water" }, { id: 503, name: "[SS-DEMO] Open trench" },
    { id: 600, name: "[SS-DEMO] Live test capture" }, { id: 999, name: "Someone renamed it" }, { id: 42, name: "A real observation" },
  ] });
  on("GET", /\/rest\/v1\.1\/punch_items\?/, { body: [] });
  const dry = (await post({ action: "reset", code: "HP", dryRun: true })).json();
  assert.deepEqual(dry.records.map((r) => r.id).sort(), ["501", "502", "503", "600"]);
  assert.equal(dry.skipped[0].id, "999");
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);

  on("DELETE", /\/observations\/items\/(501|502|600)/, { status: 200, body: {} });
  on("DELETE", /\/observations\/items\/503/, { status: 403, body: { error: "not allowed" } });
  const done = (await post({ action: "reset", code: "HP", dryRun: false })).json();
  assert.deepEqual(done.deleted.map((r) => r.id).sort(), ["501", "502", "600"]);
  assert.deepEqual(done.archived.map((r) => r.id), ["503"]);
  const archive = calls.find((c) => c.method === "PATCH" && /observations\/items\/503/.test(c.url));
  assert.deepEqual(archive.body.observation, { name: "[SS-DEMO][ARCHIVED] Open trench", status: "closed" });
  assert.ok(!calls.some((c) => c.method !== "GET" && /\/(42|999)\b/.test(c.url)), "untagged records untouched");
  assert.equal([...db.threads.keys()].filter((k) => k.startsWith(`${CO}_1001/`)).length, 0);
  assert.equal(db.table.get("HP-01").import_status, "not_imported");
  assert.equal(db.table.get("HP-01").procore_id, null);
});

test("reset refuses a project outside the allowlist", async () => {
  assert.equal((await post({ action: "reset", code: "XX", dryRun: true })).statusCode, 400);
  process.env.DEMO_PROJECT_IDS = "HP:1001,WG:1002,LV:5555"; // not a project this person can open
  const out = await post({ action: "reset", code: "LV", dryRun: true });
  assert.equal(out.statusCode, 403);
});

// ---------- live captures ----------

test("a live capture in a demo project is tagged [SS-DEMO]; elsewhere it isn't", async () => {
  const card = { recordType: "punch_item", title: "Fire extinguisher missing", description: "x", assigneeIds: [] };
  await post({ companyId: CO, projectId: "1003", card }, records);
  await post({ companyId: CO, projectId: "2000", card }, records);
  const names = calls.filter((c) => c.method === "POST" && /punch_items$/.test(c.url)).map((c) => c.body.punch_item.name);
  assert.deepEqual(names, ["[SS-DEMO] Fire extinguisher missing", "Fire extinguisher missing"]);
  process.env.DEMO_MODE = "false";
  await post({ companyId: CO, projectId: "1003", card }, records);
  assert.equal(calls.filter((c) => c.method === "POST" && /punch_items$/.test(c.url)).at(-1).body.punch_item.name, "Fire extinguisher missing");
});


test("setup: Create Demo Projects makes the missing ones, reuses one by name, and answers the line", async () => {
  process.env.DEMO_PROJECT_IDS = "";
  onFirst("GET", /\/rest\/v1\.1\/projects\?/, { body: [{ id: 373212, name: "Sandbox Test Project" }, { id: 1002, name: "Westgate Distribution Center" }] });
  let n = 3000;
  on("POST", /\/rest\/v1\.0\/projects$/, () => ({ status: 201, body: { id: ++n } }));
  const b = (await post({ action: "createprojects" })).json();
  const made = calls.filter((c) => c.method === "POST" && /\/rest\/v1\.0\/projects$/.test(c.url));
  assert.deepEqual(made.map((c) => c.body.project.name), ["Harbor Point Medical Office", "Lakeview Elementary Modernization"]);
  assert.equal(made[0].body.company_id, Number(CO));
  assert.equal(b.line, "HP:3001,WG:1002,LV:3002");
  admin = false;
  assert.equal((await post({ action: "createprojects" })).statusCode, 403);
});

test("admin check: a new demo project with no templates yet doesn't lock the admin out", async () => {
  onFirst("GET", /\/projects\/1001\/permission_templates$/, { body: [] });
  const out = await post({ action: "state" });
  assert.equal(out.statusCode, 200);
  assert.ok(calls.some((c) => /\/projects\/1002\/permission_templates$/.test(c.url)));
});
