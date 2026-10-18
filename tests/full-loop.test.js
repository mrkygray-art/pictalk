// Full-loop demo mode (api/_fullLoop.js): project allowlist, action allowlist, kill switch, and that it reaches
// every Procore call made with a signed-in person's token (procoreGet, procoreSend), the project picker, and a 429.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { demoProjectsOnly, fullLoopProblem, fullLoopSettings, guardFullLoop } from "../api/_fullLoop.js";
import { procoreGet, rateLimitWait, seal, SESSION_COOKIE } from "../api/_procore.js";
import { procoreSend } from "../api/_procoreWrite.js";
import { listProjects } from "../api/_projects.js";

const ON = fullLoopSettings({ FULL_LOOP_DEMO: "true", DEMO_PROJECT_IDS: "HP:101,WG:102,LV:103" });
const OFF = fullLoopSettings({ FULL_LOOP_DEMO: "false", DEMO_PROJECT_IDS: "HP:101,WG:102,LV:103" });
const app = { url: "/api/procore/records" };
const refused = (fn, code) => assert.throws(fn, (e) => e.status === 403 && e.code === code);

test("settings: its own flag, the shared project list; off = a named problem", () => {
  assert.deepEqual(ON.projectIds, ["101", "102", "103"]);
  assert.equal(ON.enabled, true);
  assert.equal(fullLoopProblem(ON), null);
  assert.match(fullLoopProblem(OFF), /FULL_LOOP_DEMO/);
  assert.equal(fullLoopSettings({ DEMO_ENABLED: "true" }).enabled, false, "the guest demo's flag doesn't turn it on");
});

test("kill switch: with demo mode off, nothing is refused", () => {
  guardFullLoop(app, "DELETE", "/rest/v1.1/punch_items/5", { query: { project_id: 999 } }, OFF);
  guardFullLoop(app, "GET", "/rest/v1.0/projects/999/users", { query: {} }, OFF);
});

test("project allowlist: any other project is refused, by path or project_id, reads too", () => {
  refused(() => guardFullLoop(app, "GET", "/rest/v1.0/projects/999/users", { query: {} }, ON), "demo_project");
  refused(() => guardFullLoop(app, "GET", "/rest/v1.0/observations/items", { query: { project_id: 999 } }, ON), "demo_project");
  refused(() => guardFullLoop(app, "POST", "/rest/v1.0/observations/items", { query: { project_id: "999" } }, ON), "demo_project");
  guardFullLoop(app, "GET", "/rest/v1.0/projects/101/users", { query: {} }, ON);
  guardFullLoop(app, "GET", "/rest/v1.0/me", { query: {} }, ON);
});

test("action allowlist: the loop's writes pass; any other write is refused", () => {
  const q = { project_id: 102 };
  for (const [m, p] of [
    ["POST", "/rest/v1.0/observations/items"], ["PATCH", "/rest/v1.0/observations/items/77"],
    ["POST", "/rest/v1.0/observations/items/77/response_logs"], ["POST", "/rest/v1.0/observations/items/77/send_email"],
    ["POST", "/rest/v1.1/projects/102/uploads"], ["POST", "/rest/v1.0/images"], ["POST", "/rest/v1.0/image_categories"],
  ]) guardFullLoop(app, m, p, { query: q }, ON);
  for (const [m, p] of [
    ["DELETE", "/rest/v1.0/observations/items/77"], ["POST", "/rest/v1.1/punch_items"], ["PATCH", "/rest/v1.0/projects/102/users/5"],
    ["POST", "/rest/v1.0/projects/102/daily_logs/notes_logs"], ["POST", "/rest/v1.0/vendors"],
  ]) refused(() => guardFullLoop(app, m, p, { query: q }, ON), "demo_action");
});

test("a write's project can be in the body; a write naming no project is refused", () => {
  guardFullLoop(app, "POST", "/rest/v1.0/observations/items", { body: { project_id: 101 } }, ON);
  refused(() => guardFullLoop(app, "POST", "/rest/v1.0/observations/items", { body: { project_id: 999 } }, ON), "demo_project");
  refused(() => guardFullLoop(app, "PATCH", "/rest/v1.0/observations/items/77", { body: { observation: { status: "closed" } } }, ON), "demo_project");
});

test("sandbox tool pages keep their own guards and are exempt", () => {
  guardFullLoop({ url: "/api/procore/demo-staging" }, "POST", "/rest/v1.0/projects/101/users", { query: {} }, ON);
  guardFullLoop({ url: "/api/procore/demo-check" }, "GET", "/rest/v1.0/projects/999/users", { query: {} }, ON);
});

test("project picker: only the demo projects while on; everything when off or on a tool page", () => {
  const all = [{ projectId: "101" }, { projectId: "555" }, { projectId: "103" }];
  assert.deepEqual(demoProjectsOnly(app, all, ON).map((p) => p.projectId), ["101", "103"]);
  assert.equal(demoProjectsOnly(app, all, OFF).length, 3);
  assert.equal(demoProjectsOnly({ url: "/api/procore/test-records" }, all, ON).length, 3);
});

// ---------- wired into the real Procore helpers ----------

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  FULL_LOOP_DEMO: "true", DEMO_PROJECT_IDS: "HP:101,WG:102",
};
let calls, saved, replies;
beforeEach(() => {
  calls = [];
  replies = [];
  saved = { fetch: globalThis.fetch, env: { ...process.env }, err: console.error, wait: rateLimitWait.maxMs };
  Object.assign(process.env, ENV);
  rateLimitWait.maxMs = 0;
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    const [status, body] = replies.shift() ?? (/\/companies/.test(String(url)) ? [200, [{ id: 9, name: "Co" }]] : /\/projects\?/.test(String(url)) ? [200, [{ id: 101, name: "HP" }, { id: 555, name: "Other" }]] : [200, { id: 1 }]);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.error = saved.err;
  rateLimitWait.maxMs = saved.wait;
});
const cfg = () => ({ apiUrl: ENV.PROCORE_API_URL, loginUrl: ENV.PROCORE_LOGIN_URL, clientId: "id", clientSecret: "secret", sessionSecret: ENV.SESSION_SECRET });
const req = (url = "/api/procore/records") => ({ url, headers: { cookie: `${SESSION_COOKIE}=${seal({ at: "a", rt: "r", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE)}` } });
const res = () => ({ setHeader() {}, getHeader() {} });

test("procoreGet and procoreSend refuse outside the demo before calling Procore", async () => {
  await assert.rejects(procoreGet(req(), res(), cfg(), "/rest/v1.0/projects/555/users"), (e) => e.code === "demo_project");
  await assert.rejects(procoreSend(req(), res(), cfg(), "POST", "/rest/v1.1/punch_items", { body: { project_id: 101 } }), (e) => e.code === "demo_action");
  assert.equal(calls.length, 0, "Procore never saw them");
  const ok = await procoreSend(req(), res(), cfg(), "POST", "/rest/v1.0/observations/items", { body: { project_id: 101 } });
  assert.equal(ok.status, 200);
});

test("the picker lists only the demo projects", async () => {
  const { projects } = await listProjects(req(), res(), cfg());
  assert.deepEqual(projects.map((p) => p.projectId), ["101"]);
});

test("procoreSend with retry429 waits out a 429 and tries again; without it, the caller gets the 429", async () => {
  replies = [[429, { errors: "Too many" }], [201, { id: 5 }]];
  const r = await procoreSend(req(), res(), cfg(), "POST", "/rest/v1.0/observations/items", { body: { project_id: 101 }, retry429: true });
  assert.equal(r.status, 201);
  assert.equal(calls.length, 2);
  replies = [[429, { errors: "Too many" }]];
  const plain = await procoreSend(req(), res(), cfg(), "POST", "/rest/v1.0/observations/items", { body: { project_id: 101 } });
  assert.equal(plain.status, 429, "demo staging and others handle a 429 themselves");
});
