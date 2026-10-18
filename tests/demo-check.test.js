// Full-loop demo Step 0: the read-only demo check (api/_demoCheck.js rules, api/procore/demo-check.js page)
// against a mocked Procore.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import check, { pace } from "../api/procore/demo-check.js";
import { evaluateProject, levelNum, statusValues, worst, PASS, PARTIAL, FAIL } from "../api/_demoCheck.js";
import { checkState, config, newState, seal, SESSION_COOKIE } from "../api/_procore.js";
import login from "../api/procore/login.js";

const PM_EMAIL = "pm.owner@example.com";
const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  DEMO_ADMIN_EMAILS: PM_EMAIL, DEMO_ACTOR_PM: PM_EMAIL, DEMO_PROJECT_IDS: "HP:101,WG:102",
};

const people = [
  { id: 1, name: "Edward Gray", email_address: PM_EMAIL, is_active: true, permission_template: { id: 10, name: "Project Manager - Internal" } },
  { id: 2, name: "Carlos Mendez", email_address: "c@example.com", mobile_phone: "555-0198", is_active: true, job_title: "Drywall Foreman", vendor: { id: 70, name: "Clean Line Drywall" }, permission_template: { id: 20, name: "Subcontractor - External" } },
  { id: 3, name: "Alicia Nguyen", email_address: "a@example.com", is_active: true, job_title: "Electrical Foreman", vendor: { id: 71, name: "Volt Line Electric" }, permission_template: { id: 20, name: "Subcontractor - External" } },
  { id: 4, name: "Ray Castillo", email_address: "r@example.com", is_active: true, job_title: "Plumbing / Sprinkler Foreman", vendor: { id: 72, name: "Summit Mechanical" }, permission_template: { id: 20, name: "Subcontractor - External" } },
];
const vendors = [{ id: 70, name: "Clean Line Drywall", trades: [] }, { id: 71, name: "Volt Line Electric", trades: [{ name: "Electrical" }] }, { id: 72, name: "Summit Mechanical", trades: [{ name: "Plumbing" }] }];

const base = {
  project: { projectId: "101", name: "HP", open: true }, people, vendors,
  levels: { 10: { observations: 4, images: 4 }, 20: { observations: 3, images: 3 } },
  assignees: new Set(["1", "2", "3", "4"]), statuses: ["initiated", "ready_for_review", "not_accepted", "closed"],
  obsTotal: 5, photoTotal: 4, pm: PM_EMAIL,
};
const row = (rows, start) => rows.find((r) => r.check.startsWith(start));

test("levels and statuses: numbers or Procore's words", () => {
  assert.equal(levelNum(4), 4);
  assert.equal(levelNum("read_only"), 2);
  assert.equal(levelNum("Standard"), 3);
  assert.equal(levelNum(null), null);
  assert.deepEqual(statusValues([{ status: "initiated" }, { name: "Ready For Review" }, "closed"]), ["initiated", "ready_for_review", "closed"]);
});

test("PM with Admin on Observations passes; the missing roofing trade is the only FAIL", () => {
  const rows = evaluateProject(base);
  assert.equal(row(rows, "PM account in the Directory").result, PASS);
  assert.equal(row(rows, "PM Observations").result, PASS);
  assert.equal(row(rows, "PM Photos").result, PASS);
  assert.equal(row(rows, "Observation statuses").result, PASS);
  assert.equal(row(rows, "Trade: Drywall").result, PASS);
  assert.equal(row(rows, "Trade: Electrical").result, PASS);
  assert.equal(row(rows, "Trade: Plumbing").result, PASS);
  assert.equal(row(rows, "Trade: Roofing").result, FAIL);
  assert.deepEqual(rows.filter((r) => r.result !== PASS).map((r) => r.check), ["Trade: Roofing / Envelope"]);
  assert.equal(worst(rows), FAIL);
  assert.ok(!JSON.stringify(rows).includes("@"), "no emails in the rows");
});

test("Standard on Observations is PARTIAL for the PM's close; not in the Directory is FAIL", () => {
  const std = evaluateProject({ ...base, levels: { ...base.levels, 10: { observations: 3, images: 3 } } });
  assert.equal(row(std, "PM Observations").result, PARTIAL);
  const gone = evaluateProject({ ...base, pm: "someone.else@example.com" });
  assert.equal(row(gone, "PM account in the Directory").result, FAIL);
  const closed = evaluateProject({ ...base, project: { ...base.project, open: false } });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].result, FAIL);
});

test("a trade person off the assignee list is PARTIAL; missing ready_for_review is FAIL", () => {
  const rows = evaluateProject({ ...base, assignees: new Set(["1", "3", "4"]), statuses: ["initiated", "closed"] });
  assert.equal(row(rows, "Trade: Drywall").result, PARTIAL);
  assert.equal(row(rows, "Observation statuses").result, FAIL);
});

test("Option B: Standard sub passes, an Admin sub is PARTIAL (could close), unknown name FAIL", () => {
  const ok = evaluateProject({ ...base, assignee: "Carlos Mendez" });
  assert.equal(row(ok, "Option B user in the Directory").result, PASS);
  assert.equal(row(ok, "Option B user can be assigned").result, PASS);
  assert.equal(row(ok, "Option B user Observations").result, PASS);
  const admin = evaluateProject({ ...base, assignee: "c@example.com", levels: { ...base.levels, 20: { observations: 4, images: 3 } } });
  assert.equal(row(admin, "Option B user Observations").result, PARTIAL);
  const none = evaluateProject({ ...base, assignee: "Nobody Here" });
  assert.equal(row(none, "Option B user in the Directory").result, FAIL);
  assert.equal(row(evaluateProject(base), "Option B"), undefined, "Option A checks no second user");
});

// ---------- the page, against a mocked Procore ----------

let calls, saved;
const reply = (u) => {
  if (/\/me(\?|$)/.test(u)) return [200, { id: 1, name: "Edward Gray", login: PM_EMAIL }];
  if (/\/companies\?|\/companies$/.test(u)) return [200, [{ id: 555, name: "Kyco", is_active: true }]];
  if (/\/v1\.1\/projects\?/.test(u)) return [200, [{ id: 101, name: "Harbor Point" }, { id: 102, name: "Westgate" }]];
  if (/\/projects\/10[12]\/users\?/.test(u)) return [200, people];
  if (/\/companies\/555\/permission_templates\/10/.test(u)) return [200, { id: 10, user_access_levels: { observations: 4, images: 4, directory: 4 } }];
  if (/\/observations\/assignees\?/.test(u)) return [200, people.map(({ id, name }) => ({ id, name }))];
  if (/observations\/items\/statuses/.test(u)) return [200, [{ status: "initiated" }, { status: "ready_for_review" }, { status: "closed" }]];
  if (/\/projects\/10[12]\/vendors\?/.test(u)) return [200, vendors];
  if (/\/observations\/items\?/.test(u)) return [200, [{ id: 9 }]];
  if (/\/images\?/.test(u)) return [200, [{ id: 8 }]];
  if (/webhooks\/resources/.test(u)) return [200, [{ resource_name: "Observation Items" }, { resource_name: "Punch Items" }]];
  if (/webhooks\/hooks/.test(u)) return [403, { errors: "Forbidden" }];
  return [404, { errors: "Not found" }];
};
beforeEach(() => {
  calls = [];
  pace.gapMs = 0;
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log };
  Object.assign(process.env, ENV);
  console.log = () => {};
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    const [status, body] = reply(String(url));
    const headers = { "content-type": "application/json" };
    if (/\/observations\/items\?/.test(String(url))) headers.total = "3";
    if (/\/images\?/.test(String(url))) headers.total = "12";
    return new Response(JSON.stringify(body), { status, headers });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.log = saved.log;
});
const cookie = (data = { at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }) => seal(data, ENV.SESSION_SECRET, SESSION_COOKIE);
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const post = (body = {}, c = cookie()) => ({ method: "POST", url: "/api/procore/demo-check", body, headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${c}` } });

test("demo check: GET calls only, one table per demo project, never an email, phone or token", async () => {
  const out = res();
  await check(post(), out);
  assert.equal(out.statusCode, 200, out.body);
  assert.ok(calls.every((c) => c.method === "GET"), "only GET calls");
  const b = out.json();
  assert.deepEqual(b.projects.map((p) => p.projectId), ["101", "102"]);
  assert.equal(b.global.find((r) => r.check.startsWith("Signed-in account")).result, PASS);
  assert.equal(b.global.find((r) => r.check.startsWith("Observation webhooks")).result, PASS);
  const hp = b.projects[0];
  assert.equal(hp.rows.find((r) => r.check.startsWith("Sample Observations")).detail, "3 in the project.");
  assert.equal(hp.rows.find((r) => r.check.startsWith("Photos in Procore")).detail, "12 in the project.");
  assert.equal(hp.rows.find((r) => r.check.startsWith("PM Observations")).result, PASS);
  for (const leak of [PM_EMAIL, "c@example.com", "555-0198", "access-1", "refresh-1", "secret-never-leak"]) assert.ok(!out.body.includes(leak), `no ${leak}`);
  // Template levels are read once per company, not once per project
  assert.equal(calls.filter((c) => /permission_templates\/10/.test(c.url)).length, 1);
});

test("demo check: only the owner, never a guest demo session, sandbox only", async () => {
  process.env.DEMO_ADMIN_EMAILS = "someone.else@example.com";
  const notOwner = res();
  await check(post(), notOwner);
  assert.equal(notOwner.statusCode, 403);
  process.env.DEMO_ADMIN_EMAILS = PM_EMAIL;
  const guest = res();
  await check(post({}, cookie({ role: "demo", sid: "x", last: Date.now() })), guest);
  assert.equal(guest.statusCode, 403);
  process.env.PROCORE_API_URL = "https://api.procore.test";
  const live = res();
  await check(post(), live);
  assert.equal(live.statusCode, 403);
});

test("demo check page: says whether you're signed in, the guest demo, or not the owner", async () => {
  const status = async (headers) => {
    const out = res();
    await check({ method: "GET", url: "/api/procore/demo-check?status=1", headers: { host: "sitesnap-procore.vercel.app", ...headers } }, out);
    return out.json();
  };
  assert.deepEqual(await status({}), { signedIn: false });
  assert.deepEqual(await status({ cookie: `${SESSION_COOKIE}=${cookie({ role: "demo", sid: "x", last: Date.now() })}` }), { signedIn: true, demo: true });
  const me = await status({ cookie: `${SESSION_COOKIE}=${cookie()}` });
  assert.equal(me.owner, true);
  assert.equal(me.name, "Edward Gray");
  process.env.DEMO_ADMIN_EMAILS = "someone.else@example.com";
  assert.equal((await status({ cookie: `${SESSION_COOKIE}=${cookie()}` })).owner, false);
});

test("sign-in from the check page comes back to it; any other back= is ignored", () => {
  const cfg = config();
  const go = (q) => {
    const out = res();
    login({ method: "GET", url: `/api/procore/login?${q}`, headers: { host: "sitesnap-procore.vercel.app" } }, out);
    const sc = [].concat(out.headers["set-cookie"]).find((c) => c.startsWith("pc_state="));
    const state = new URL(out.headers.location).searchParams.get("state");
    return checkState(cfg, sc.split(";")[0].slice("pc_state=".length), state);
  };
  assert.equal(go("back=demo-check").back, "demo-check");
  assert.equal(go("back=https://evil.example").back, undefined);
  assert.equal(go("").back, undefined);
  const { state, cookie: c } = newState(cfg, { back: "nowhere" });
  assert.equal(checkState(cfg, c, state).back, undefined);
});
