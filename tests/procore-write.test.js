// The Procore writer (api/_procoreWrite.js) and the sandbox write test (api/procore/test-records.js),
// against a mocked Procore with the request and response shapes from Procore's reference. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import testRecords from "../api/procore/test-records.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "test-client-id", PROCORE_CLIENT_SECRET: "test-client-secret-never-leak",
  PROCORE_LOGIN_URL: "https://login-sandbox.procore.test", PROCORE_API_URL: "https://sandbox.procore.test",
  SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
let calls, routes, saved;
beforeEach(() => {
  calls = [];
  routes = [];
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, ENV);
  console.log = () => {};
  console.error = () => {};
  // Mocked Procore + storage: the first route whose test matches answers
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const r = routes.find((x) => x.test(u, init));
    if (!r) throw new Error(`unexpected fetch ${init.method ?? "GET"} ${u}`);
    const { status = 200, body = {} } = typeof r.reply === "function" ? r.reply(u, init) : r.reply;
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { log: saved.log, error: saved.error });
});

const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = (method, body, headers = {}) => ({
  method, url: "/api/procore/test-records", body,
  headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}`, ...headers },
});
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const run = async (r) => { const out = res(); await testRecords(r, out); return out; };
const on = (method, re, reply) => routes.push({ test: (u, init) => (init.method ?? "GET") === method && re.test(u), reply });

function sandbox({ punchNeedsManager = false } = {}) {
  on("GET", /\/rest\/v1\.0\/companies\?/, { body: [{ id: 4291776, name: "Kyco", is_active: true }] });
  on("GET", /\/rest\/v1\.1\/projects\?/, { body: [{ id: 373235, name: "1234 - Sandbox Test Project" }] });
  on("GET", /\/rest\/v1\.0\/me\?/, { body: { id: 7, login: "pm@example.com", name: "Pat PM" } });
  on("GET", /observation_types$/, { body: [{ id: 11, name: "Quality", category: "quality", active: true }] });
  on("GET", /observations\/items\/statuses$/, { body: [{ id: "initiated", label: "Initiated" }] });
  let n = 0;
  on("POST", /\/rest\/v1\.1\/projects\/373235\/uploads$/, () => ({ status: 201, body: { uuid: `UUID${++n}`, url: "https://storage.test/bucket", fields: { key: `k${n}`, policy: "p" } } }));
  on("POST", /^https:\/\/storage\.test\/bucket$/, { status: 204 });
  on("POST", /\/rest\/v1\.0\/observations\/items$/, { status: 201, body: { id: 501, number: 3, status: "initiated", attachments: [{}, {}] } });
  on("POST", /\/rest\/v1\.1\/punch_items$/, (u, init) => {
    const b = JSON.parse(init.body);
    if (punchNeedsManager && !b.punch_item.punch_item_manager_id) return { status: 422, body: { errors: { punch_item_manager: ["can't be blank"] } } };
    return { status: 201, body: { id: 601, position: 12, workflow_status: "initiated", attachments: [{}, {}] } };
  });
  on("GET", /webhooks\/resources/, { body: [{ name: "Observations" }, { name: "Punch Items" }, { name: "RFIs" }] });
}

test("GET shows the test page; it only runs against Procore's sandbox", async () => {
  const page = await run(req("GET"));
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Run Test/);
  process.env.PROCORE_API_URL = "https://api.procore.com";
  const prod = await run(req("GET"));
  assert.equal(prod.statusCode, 403);
  assert.equal(prod.json().error, "not_sandbox");
});

test("POST creates an Observation and a Punch Item with the photo and sound attached, as the signed-in person", async () => {
  sandbox();
  const out = await run(req("POST", { companyId: "4291776", projectId: "373235" }));
  assert.equal(out.statusCode, 200, out.body);
  const { steps, raw } = out.json();
  assert.deepEqual(steps.map((s) => [s.name, s.ok]), [
    ["Signed in", true], ["Observation types", true], ["Upload test photo", true],
    ["Upload test sound (stands in for a voice note)", true], ["Create Observation", true], ["Create Punch Item", true],
    ["Webhook events available", true],
  ]);
  assert.deepEqual(raw.observation, { id: 501, number: 3, status: "initiated", attachments: 2 });
  // The writes Procore received
  const obs = calls.find((c) => c.method === "POST" && /observations\/items$/.test(c.url));
  const ob = JSON.parse(obs.body);
  assert.equal(ob.project_id, 373235);
  assert.equal(ob.observation.type_id, 11);
  assert.deepEqual(ob.observation.upload_ids, ["UUID1", "UUID2"]);
  assert.match(ob.observation.description, /Reported by Pat PM via SiteSnap AI/);
  assert.equal(obs.headers["Procore-Company-Id"], "4291776");
  const punch = JSON.parse(calls.find((c) => c.method === "POST" && /punch_items$/.test(c.url)).body);
  assert.equal(punch.punch_item.reference, "Reported by Pat PM via SiteSnap AI");
  assert.deepEqual(punch.punch_item.upload_ids, ["UUID1", "UUID2"]);
  // Uploads: slot first, then the file posted to storage with Procore's fields unchanged plus "file"
  const store = calls.filter((c) => c.url === "https://storage.test/bucket");
  assert.equal(store.length, 2);
  assert.equal(store[0].body.get("key"), "k1");
  assert.equal(store[0].body.get("policy"), "p");
  assert.ok(store[0].body.get("file"));
  assert.ok(!store[0].headers.Authorization, "no Procore token sent to the storage service");
  assert.ok(!out.body.includes("access-1"), "no token in the answer");
});

test("a Punch Item Procore refuses without a manager is retried with the signed-in person as manager and approver", async () => {
  sandbox({ punchNeedsManager: true });
  const out = await run(req("POST", { companyId: "4291776", projectId: "373235" }));
  const { steps, raw } = out.json();
  assert.equal(steps.find((s) => s.name === "Create Punch Item").ok, true);
  assert.equal(raw.punchFirstTry.status, 422);
  assert.deepEqual(raw.punchFirstTry.error, { punch_item_manager: ["can't be blank"] });
  const tries = calls.filter((c) => c.method === "POST" && /punch_items$/.test(c.url)).map((c) => JSON.parse(c.body).punch_item);
  assert.equal(tries.length, 2);
  assert.equal(tries[1].punch_item_manager_id, 7);
  assert.equal(tries[1].final_approver_id, 7);
});

test("only a project the person can open; no session, no writes", async () => {
  sandbox();
  const other = await run(req("POST", { companyId: "4291776", projectId: "999" }));
  assert.equal(other.statusCode, 403);
  assert.ok(!calls.some((c) => c.method === "POST"), "nothing written");
  calls.length = 0;
  const anon = await run({ ...req("POST", { companyId: "4291776", projectId: "373235" }), headers: { ...req("POST").headers, cookie: "" } });
  assert.equal(anon.statusCode, 401);
  const cross = await run(req("POST", { companyId: "4291776", projectId: "373235" }, { origin: "https://evil.example" }));
  assert.equal(cross.statusCode, 403);
});
