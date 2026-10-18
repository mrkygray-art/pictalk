// Full-loop demo steps C-D: one capture = one Procore record (api/_captures.js via api/procore/records.js), the
// mapping row, the classification log's final + edits, the [SS-DEMO] tag and Observations-only flag in demo mode,
// and the card's assignee proposal (src/messaging/assigneeMatch.js). Mocked Procore, in-memory Firestore.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import records from "../api/procore/records.js";
import recordOptions from "../api/procore/record-options.js";
import { LOCK_MS } from "../api/_captures.js";
import { forgetOwners } from "../api/_fullLoop.js";
import { setStore } from "../api/_firestore.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { proposeAssignee, tradeStem } from "../src/messaging/assigneeMatch.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  FULL_LOOP_DEMO: "true", DEMO_PROJECT_IDS: "HP:373715,WG:373716,LV:373717",
};

// ---------- in-memory Firestore: collection/doc paths, get/set (merge)/delete, runTransaction ----------
let docs;
const docRef = (path) => ({
  id: path.split("/").pop(),
  collection: (name) => ({ doc: (id) => docRef(`${path}/${name}/${id}`) }),
  get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }),
  set: async (v, opts) => { docs.set(path, opts?.merge ? { ...(docs.get(path) ?? {}), ...structuredClone(v) } : structuredClone(v)); },
  delete: async () => { docs.delete(path); },
  path,
});
const fakeDb = {
  collection: (name) => ({ doc: (id) => docRef(`${name}/${id}`) }),
  runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, v, o) => ref.set(v, o) }),
};

let calls, created, saved, refuse;
beforeEach(() => {
  calls = [];
  created = 0;
  refuse = false;
  docs = new Map();
  setStore(fakeDb);
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, ENV);
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const m = init.method ?? "GET";
    calls.push({ url: u, method: m, body: init.body });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (/\/companies\?/.test(u)) return json(200, [{ id: 4291776, name: "Kyco", is_active: true }]);
    if (/\/v1\.1\/projects\?/.test(u)) return json(200, [{ id: 373715, name: "Harbor Point" }, { id: 373235, name: "Sandbox Test Project" }]);
    if (/\/me(\?|$)/.test(u)) return json(200, { id: 481274, login: "e@example.com", name: "Edward Gray" });
    if (m === "POST" && /\/observations\/items$/.test(u)) {
      if (refuse) return json(422, { errors: "type_id is invalid" });
      created++;
      return json(201, { id: 371000 + created, number: String(created) });
    }
    if (m === "POST" && /send_email/.test(u)) return json(200, {});
    if (/observation_types/.test(u)) return json(200, [{ id: 1, name: "Deficiency", category: "Quality" }]);
    if (/trades|locations/.test(u)) return json(200, []);
    return json(404, { errors: `unexpected ${m} ${u}` });
  };
});
afterEach(() => {
  setStore(null);
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { log: saved.log, error: saved.error });
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = (method, url, body) => ({ method, url, body, headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` } });
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const run = async (h, r) => { const out = res(); await h(r, out); return out; };
const card = (over) => ({
  recordType: "observation", observationTypeId: 1, title: "Cracked drywall at the east stairwell", description: "Cracked drywall at the east stairwell, needs fixing before paint Thursday.",
  transcript: "Cracked drywall at the east stairwell, needs fixing before paint Thursday, drywall sub.", locationText: "East stairwell",
  priority: "medium", assigneeIds: [900], dueDate: null, captureId: "cap-77", ...over,
});
const send = (body) => run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373715", files: [], ...body }));
const capture = (id = "cap-77") => docs.get(`procoreProjects/4291776_373715/recordCaptures/${id}`);

test("double tap: the second send gets the first record back, Procore makes one", async () => {
  const first = await send({ card: card() });
  assert.equal(first.statusCode, 201, first.body);
  const again = await send({ card: card() });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().repeat, true);
  assert.equal(again.json().id, first.json().id);
  assert.equal(created, 1, "exactly one Observation in Procore");
});

test("the mapping row: SiteSnap id, Procore project and Observation, who, when, the demo tag", async () => {
  const out = await send({ card: card() });
  const row = capture();
  assert.equal(row.state, "done");
  assert.equal(row.siteSnapItemId, "cap-77");
  assert.equal(row.procoreProjectId, "373715");
  assert.equal(row.procoreObservationId, String(out.json().id));
  assert.equal(row.createdByActor, "481274");
  assert.equal(row.demoTag, true);
  assert.ok(row.createdAt > 0);
  const made = JSON.parse(calls.find((c) => c.method === "POST" && /observations\/items$/.test(c.url)).body);
  assert.match(made.observation.name, /^\[SS-DEMO\] Cracked drywall/, "demo mode tags the title");
});

test("while the first send is still running, a second is told to wait; a stale lock can be taken again", async () => {
  docs.set("procoreProjects/4291776_373715/recordCaptures/cap-77", { state: "creating", at: Date.now() });
  const busy = await send({ card: card() });
  assert.equal(busy.statusCode, 409);
  assert.equal(busy.json().error, "already_sending");
  assert.equal(created, 0);
  docs.set("procoreProjects/4291776_373715/recordCaptures/cap-77", { state: "creating", at: Date.now() - LOCK_MS - 1000 });
  const ok = await send({ card: card() });
  assert.equal(ok.statusCode, 201);
});

test("Procore refuses: the lock is let go, so the next tap tries again", async () => {
  refuse = true;
  const bad = await send({ card: card() });
  assert.equal(bad.statusCode, 422);
  assert.equal(capture(), undefined);
  refuse = false;
  const ok = await send({ card: card() });
  assert.equal(ok.statusCode, 201);
  assert.equal(created, 1);
});

test("the classification log gets what was sent and which fields the person changed", async () => {
  docs.set("procoreProjects/4291776_373715/classifications/cap-77", { runs: [{ at: 1, transcript: "…", output: {} }] });
  const proposed = { ...card(), priority: "high", assigneeIds: [900], title: "Cracked drywall" };
  await send({ card: card(), proposed });
  const log = docs.get("procoreProjects/4291776_373715/classifications/cap-77");
  assert.equal(log.runs.length, 1, "the AI's runs are kept");
  assert.deepEqual(log.edits, ["title", "priority"]);
  assert.equal(log.final.title, "Cracked drywall at the east stairwell", "the [SS-DEMO] tag isn't counted as an edit");
  assert.equal(log.record.recordType, "observation");
});

test("demo mode: projects outside the allowlist and Punch Items are refused before Procore", async () => {
  const other = await run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373235", card: card(), files: [] }));
  assert.equal(other.statusCode, 403);
  const punch = await send({ card: card({ recordType: "punch_item", captureId: "cap-78" }) });
  assert.equal(punch.statusCode, 403);
  assert.equal(punch.json().error, "loop_action");
  assert.ok(!calls.some((c) => c.method === "POST" && /punch_items/.test(c.url)));
});

test("record options say when the card is Observations-only (demo mode, a demo project)", async () => {
  const on = await run(recordOptions, req("GET", "/api/procore/record-options?companyId=4291776&projectId=373715"));
  assert.equal(on.json().fullLoopDemo, true);
  process.env.FULL_LOOP_DEMO = "false";
  const off = await run(recordOptions, req("GET", "/api/procore/record-options?companyId=4291776&projectId=373715"));
  assert.equal(off.json().fullLoopDemo, false);
});

test("the owner gets the normal card even with demo mode on, and can send a Punch Item", async () => {
  process.env.DEMO_ADMIN_EMAILS = "e@example.com"; // the mocked /me login
  forgetOwners();
  const opts = await run(recordOptions, req("GET", "/api/procore/record-options?companyId=4291776&projectId=373715"));
  assert.equal(opts.json().fullLoopDemo, false);
  const other = await run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373235", card: card({ captureId: "cap-90" }), files: [] }));
  assert.equal(other.statusCode, 201, "a project outside the demo works for the owner");
});

// ---------- the card's assignee ----------

const people = [
  { id: 1, name: "Carlos Mendez", company: "Clean Line Drywall", title: "Drywall Foreman" },
  { id: 2, name: "Alicia Nguyen", company: "Volt Line Electric", title: "Electrical Foreman" },
  { id: 3, name: "Maria Santos", company: "VoltLine Electric Inc.", title: "Electrical Foreman" },
  { id: 4, name: "Ray Castillo", company: "Summit Mechanical", title: "Plumbing / Sprinkler Foreman" },
  { id: 5, name: "Owen Fletcher", company: "Skyline Roofing & Waterproofing", title: "Roofing Foreman" },
  { id: 6, name: "Edward Gray", company: "Kyco", title: null },
];

test("assignee: a named person first; else the company heard; else the trade", () => {
  assert.deepEqual(proposeAssignee({ draft: { assignees: [{ id: 4 }] }, people }).picked.map((p) => p.name), ["Ray Castillo"]);
  const sub = proposeAssignee({ draft: { assignees: [], suggested_assignee: { company: "Clean Line Drywall" } }, people });
  assert.deepEqual(sub.picked.map((p) => p.name), ["Carlos Mendez"]);
  assert.equal(sub.how, "company");
  assert.deepEqual(proposeAssignee({ draft: {}, people, tradeName: "Roofing / Envelope" }).picked.map((p) => p.name), ["Owen Fletcher"]);
  assert.deepEqual(proposeAssignee({ draft: { trade: { name: "Plumbing" } }, people }).picked.map((p) => p.name), ["Ray Castillo"], "a title can name the trade");
});

test("assignee: two who could take it are offered, none means the person picks", () => {
  const two = proposeAssignee({ draft: {}, people, tradeName: "Electrical" });
  assert.deepEqual(two.picked, []);
  assert.deepEqual(two.choices.map((p) => p.name).sort(), ["Alicia Nguyen", "Maria Santos"]);
  const none = proposeAssignee({ draft: { suggested_assignee: { company: null } }, people });
  assert.deepEqual(none, { picked: [], choices: [], how: null });
  assert.equal(tradeStem("Roofing / Envelope"), "roof");
  assert.equal(tradeStem("Electrical"), "electric");
});
