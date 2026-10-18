// Step 4: a thread's Procore record kept in step with the thread (api/_recordStatus.js,
// api/procore/record-status.js) against a mocked Procore and an in-memory Firestore. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { createRequire } from "node:module";
import recordStatus from "../api/procore/record-status.js";
import { statusOf, updateBody } from "../api/_recordStatus.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { setStore } from "../api/_firestore.js";

const { recordTasks } = createRequire(import.meta.url)("../functions/messaging.js");

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const KEY = "4291776_373235";
const CONV = `procoreProjects/${KEY}/conversations/c1`;
let calls, routes, saved, docs, added;

const fakeDb = {
  doc: (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) }),
    set: async (v, opt) => { docs.set(path, opt?.merge ? { ...(docs.get(path) ?? {}), ...v } : v); },
  }),
  collection: (path) => ({ add: async (v) => { added.push({ path, ...v }); return { id: `e${added.length}` }; } }),
};

beforeEach(() => {
  calls = [];
  routes = [];
  added = [];
  docs = new Map([
    [`procoreProjects/${KEY}/members/481274`, { procoreUserId: "481274" }],
    [CONV, { status: "open", procore: { recordType: "punch_item", id: 196900, number: "2", url: "https://x", projectId: "373235", title: "Redo drywall" } }],
  ]);
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, ENV);
  setStore(fakeDb);
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: init.body });
    const r = routes.find((x) => (init.method ?? "GET") === x.method && x.re.test(u));
    if (!r) throw new Error(`unexpected fetch ${init.method ?? "GET"} ${u}`);
    const { status = 200, body = {} } = typeof r.reply === "function" ? r.reply(u, init) : r.reply;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  on("GET", /\/rest\/v1\.0\/me\?/, { body: { id: 481274, name: "Edward Gray" } });
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { log: saved.log, error: saved.error });
});
const on = (method, re, reply) => routes.push({ method, re, reply });
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = (method, url, body) => ({
  method, url, body,
  headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` },
});
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const run = async (r) => { const out = res(); await recordStatus(r, out); return out; };
const post = (action, cid = "c1") => run(req("POST", "/api/procore/record-status", { companyId: "4291776", projectId: "373235", cid, action }));
const sync = (cid = "c1") => run(req("GET", `/api/procore/record-status?companyId=4291776&projectId=373235&cid=${cid}`));

test("the Procore change for each action: Done = ready for review, Close = closed, Reopen = open", () => {
  assert.deepEqual(updateBody("observation", "done", "373235"), { path: "/rest/v1.0/observations/items", body: { project_id: 373235, observation: { status: "ready_for_review" } } });
  assert.deepEqual(updateBody("observation", "close", "373235").body.observation, { status: "closed" });
  assert.deepEqual(updateBody("observation", "reopen", "373235").body.observation, { status: "initiated" });
  assert.deepEqual(updateBody("punch_item", "done", "373235"), { path: "/rest/v1.1/punch_items", body: { project_id: 373235, punch_item: { workflow_status: "ready_for_review" } } });
  assert.deepEqual(updateBody("punch_item", "close", "373235").body.punch_item, { status: "closed" });
  assert.deepEqual(statusOf("punch_item", { status: "Open", workflow_status: "ready_for_review" }), { value: "ready_for_review", label: "Ready for review", closed: false });
  assert.equal(statusOf("punch_item", { status: "Closed", workflow_status: "closed" }).closed, true);
  assert.equal(statusOf("punch_item", { status: "closed" }).closed, true);
  assert.deepEqual(statusOf("observation", { status: "initiated" }), { value: "initiated", label: "Open", closed: false });
});

test("Done: the punch item goes to Ready for review with the person's own sign-in; the thread stays open", async () => {
  let sent;
  on("PATCH", /\/rest\/v1\.1\/punch_items\/196900$/, (u, init) => { sent = JSON.parse(init.body); return { body: { id: 196900 } }; });
  on("GET", /\/rest\/v1\.1\/punch_items\/196900\?project_id=373235$/, { body: { id: 196900, status: "Open", workflow_status: "ready_for_review" } });
  const out = await post("done");
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(sent, { project_id: 373235, punch_item: { workflow_status: "ready_for_review" } });
  assert.equal(out.json().status.label, "Ready for review");
  assert.equal(docs.get(CONV).status, "open");
  assert.equal(docs.get(CONV).procoreStatus.label, "Ready for review");
  assert.equal(added.length, 0);
  assert.ok(!out.body.includes("access-1") && !out.body.includes("secret-never-leak"), "no tokens or secrets in the answer");
});

test("Close: closes it in Procore, then the thread, with a Closed line by the person", async () => {
  on("PATCH", /\/punch_items\/196900$/, { body: { id: 196900 } });
  on("GET", /\/punch_items\/196900\?/, { body: { id: 196900, status: "Closed", workflow_status: "closed" } });
  const out = await post("close");
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(docs.get(CONV).status, "closed");
  assert.equal(added.length, 1);
  assert.equal(added[0].path, `${CONV}/messages`);
  assert.equal(added[0].event, "closed");
  assert.equal(added[0].authorName, "Edward Gray");
});

test("Close refused by Procore: says plainly who closes it, and nothing changes", async () => {
  on("PATCH", /\/punch_items\/196900$/, { status: 403, body: { errors: "Forbidden" } });
  const out = await post("close");
  assert.equal(out.statusCode, 403);
  assert.match(out.json().message, /project manager/i);
  assert.equal(docs.get(CONV).status, "open");
  assert.equal(added.length, 0);
});

test("closed in Procore: opening the thread closes it here too, as 'Procore'", async () => {
  on("GET", /\/punch_items\/196900\?/, { body: { id: 196900, status: "Closed", workflow_status: "closed" } });
  const out = await sync();
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(out.json().threadStatus, "closed");
  assert.equal(docs.get(CONV).status, "closed");
  assert.equal(docs.get(CONV).statusBy, "procore");
  assert.equal(added[0].authorName, "Procore");
  assert.ok(!calls.some((c) => c.method === "PATCH"), "a sync never changes Procore");
  const again = await sync();
  assert.equal(again.statusCode, 200);
  assert.equal(added.length, 1, "no second Closed line");
});

test("Reopen: reopens in Procore and the thread, with a Reopened line", async () => {
  docs.get(CONV).status = "closed";
  on("PATCH", /\/punch_items\/196900$/, { body: { id: 196900 } });
  on("GET", /\/punch_items\/196900\?/, { body: { id: 196900, status: "Open", workflow_status: "work_required" } });
  const out = await post("reopen");
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(docs.get(CONV).status, "open");
  assert.equal(added[0].event, "reopened");
});

test("observations use the observation endpoint", async () => {
  docs.get(CONV).procore = { recordType: "observation", id: 370999, number: "4", url: "https://x", projectId: "373235", title: "Loose rail" };
  on("PATCH", /\/rest\/v1\.0\/observations\/items\/370999$/, { body: { id: 370999 } });
  on("GET", /\/observations\/items\/370999\?project_id=373235$/, { body: { id: 370999, status: "ready_for_review" } });
  const out = await post("done");
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(docs.get(CONV).procoreStatus.value, "ready_for_review");
});

test("refused: not on the project, a thread with no record, an unknown action, a cross-site post", async () => {
  docs.delete(`procoreProjects/${KEY}/members/481274`);
  assert.equal((await post("done")).statusCode, 403);
  docs.set(`procoreProjects/${KEY}/members/481274`, {});
  docs.set(`${CONV.replace("c1", "c2")}`, { status: "open" });
  assert.equal((await post("done", "c2")).statusCode, 404);
  assert.equal((await post("delete")).statusCode, 400);
  const cross = req("POST", "/api/procore/record-status", { companyId: "4291776", projectId: "373235", cid: "c1", action: "close" });
  cross.headers.origin = "https://evil.example";
  const out = res();
  await recordStatus(cross, out);
  assert.equal(out.statusCode, 403);
  assert.ok(!calls.some((c) => c.method === "PATCH"), "nothing changed in Procore");
});

test("a record thread's first message: one to-do per assignee, the record's title and due date", () => {
  const tasks = recordTasks({
    procore: { title: "Redo drywall in Room 204", due: "2026-10-16" },
    tagged: [{ procoreUserId: 900, name: "Lisa Hubbard" }, { procoreUserId: "901", name: "Sam" }],
  }, "m1");
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0], { id: "m1-t1", text: "Redo drywall in Room 204", assigneeIds: ["900"], assigneeNames: ["Lisa Hubbard"], due: "Fri, Oct 16", status: "open" });
  assert.equal(recordTasks({ procore: { title: "X", due: "soon" }, tagged: [{ procoreUserId: 1 }] }, "m2")[0].due, "");
  assert.deepEqual(recordTasks({ procore: { title: "X" } }, "m3"), []);
});

// My items' Mark fixed on a record with no thread (sitesnap-report-picker-my-items-spec.md, section 6)
const fix = (body) => run(req("POST", "/api/procore/record-status", { companyId: "4291776", projectId: "373235", ...body }));

test("Mark fixed by record id: the same Ready for review change, no thread touched", async () => {
  on("PATCH", /\/rest\/v1\.0\/observations\/items\/555$/, { body: {} });
  on("GET", /\/rest\/v1\.0\/observations\/items\/555\?/, { body: { id: 555, status: "ready_for_review" } });
  const out = await fix({ recordType: "observation", recordId: "555", action: "done" });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json().status, { value: "ready_for_review", label: "Ready for review", closed: false });
  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(JSON.parse(patch.body), { project_id: 373235, observation: { status: "ready_for_review" } });
  assert.equal(added.length, 0);
  assert.equal(docs.get(CONV).procoreStatus, undefined);
});

test("Mark fixed by record id: only done, only real record types, members only, Procore's 403 in plain words", async () => {
  assert.equal((await fix({ recordType: "observation", recordId: "555", action: "close" })).statusCode, 400);
  assert.equal((await fix({ recordType: "rfi", recordId: "555", action: "done" })).statusCode, 400);
  on("PATCH", /\/rest\/v1\.1\/punch_items\/777$/, { status: 403, body: { errors: "Forbidden" } });
  const refused = await fix({ recordType: "punch_item", recordId: "777", action: "done" });
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().message, /Ask your project admin/);
  assert.doesNotMatch(refused.json().message, /Forbidden/);
  docs.delete(`procoreProjects/${KEY}/members/481274`);
  assert.equal((await fix({ recordType: "punch_item", recordId: "777", action: "done" })).statusCode, 403);
});
