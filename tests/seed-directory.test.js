// The sandbox test-people page (api/procore/seed-directory.js) and its cleanup rules (api/_seedDirectory.js),
// against a mocked Procore with the request shapes from Procore's reference. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import seedDirectory, { pace } from "../api/procore/seed-directory.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { SEED, cleanupPlan, projectRoleFor, removable, userBody, vendorBody } from "../api/_seedDirectory.js";

pace.gapMs = 0;
pace.spikeWaitMs = 0;

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
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    const r = routes.find((x) => x.test(u, init));
    if (!r) throw new Error(`unexpected fetch ${init.method ?? "GET"} ${u}`);
    const { status = 200, body = {} } = typeof r.reply === "function" ? r.reply(u, init) : r.reply;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { log: saved.log, error: saved.error });
});

const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = (method, body) => ({
  method, url: "/api/procore/seed-directory", body,
  headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` },
});
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const run = async (r) => { const out = res(); await seedDirectory(r, out); return out; };
const on = (method, re, reply) => routes.push({ test: (u, init) => (init.method ?? "GET") === method && re.test(u), reply });
const ids = { companyId: "4291776", projectId: "373235" };

const ME = { id: 7, name: "Ky Gray", email_address: "mrkygray@gmail.com", vendor: { id: 90, name: "SiteSnap AI" } };
const USERS = [
  ME,
  { id: 8, name: "Test Architect", last_name: "Architect", email_address: "implementation+arch@procore.com", vendor: { id: 91, name: "Architect TEST Company" } },
  { id: 9, name: "Old Tester", last_name: "Tester", email_address: "mrkygray+old@gmail.com", vendor: { id: 92, name: "SonLetric" } },
  { id: 10, name: "Someone Else", last_name: "Else", email_address: "someone@example.com", vendor: { id: 93, name: "Mystery Co" } },
  { id: 11, name: "Marcus Hale", last_name: "Hale", email_address: "mrkygray+mhale@gmail.com", vendor: { id: 92, name: "SonLetric" } },
];
const VENDORS = [
  { id: 90, name: "SiteSnap AI" }, { id: 91, name: "Architect TEST Company" }, { id: 92, name: "SonLetric", email_address: "mrkygray+sonletric@gmail.com" },
  { id: 93, name: "Mystery Co" }, { id: 94, name: "Ironbridge Construction Group" },
];

function sandbox() {
  on("GET", /\/rest\/v1\.0\/projects\/373235\?/, { body: { id: 373235, name: "Sandbox Test Project" } });
  on("GET", /\/rest\/v1\.0\/me\?/, { body: ME });
  on("GET", /\/rest\/v1\.3\/companies\/4291776\/users\?/, { body: USERS });
  on("GET", /\/rest\/v1\.0\/companies\/4291776\/users\/inactive\?/, { status: 403, body: {} });
  // Person ids differ from user ids; David-style records already made inactive show contact.is_active false
  on("GET", /\/rest\/v1\.0\/companies\/4291776\/people\?/, { body: USERS.map((u) => ({ id: u.id + 1000, user_id: u.id, contact: { is_active: true } })) });
  on("GET", /\/rest\/v1\.0\/vendors\?/, { body: VENDORS });
  on("GET", /\/rest\/v1\.0\/companies\/4291776\/vendors\/inactive\?/, { body: [] });
}

test("cleanup plan keeps the signed-in person, Procore's test records and their company; reuses the new test records", () => {
  const p = cleanupPlan({ users: USERS, vendors: VENDORS, meId: 7 });
  const u = Object.fromEntries(p.users.map((r) => [r.id, r]));
  const v = Object.fromEntries(p.vendors.map((r) => [r.id, r]));
  assert.equal(u[7].action, "keep");
  assert.equal(u[8].action, "keep");
  assert.deepEqual([u[9].action, u[9].checked], ["remove", true]);
  assert.deepEqual([u[10].action, u[10].checked], ["ask", false]);
  assert.equal(u[11].action, "reuse");
  assert.equal(v[90].action, "keep");
  assert.equal(v[91].action, "keep");
  assert.deepEqual([v[92].action, v[92].checked], ["remove", true]);
  assert.equal(v[93].action, "ask");
  assert.equal(v[94].action, "reuse");
  // Even if asked, keep and reuse rows can't be removed
  const pick = removable(p, [7, 8, 9, 10, 11], [90, 91, 92, 93, 94]);
  assert.deepEqual(pick.users.map((r) => r.id), [9, 10]);
  assert.deepEqual(pick.vendors.map((r) => r.id), [92, 93]);
});

test("request bodies follow Ky's sheet: CA / US, no permission template, not an employee, phone extension", () => {
  assert.equal(SEED.length, 4);
  assert.equal(SEED.flatMap((c) => c.users).length, 16);
  const c = SEED[1];
  const vb = vendorBody("4291776", c.vendor);
  assert.equal(vb.company_id, 4291776);
  assert.equal(vb.vendor.trade_name, "VoltLine Electrical Contractors");
  assert.deepEqual([vb.vendor.labor_union, vb.vendor.union_member, vb.vendor.state_code, vb.vendor.country_code], ["IBEW Local 11", true, "CA", "US"]);
  assert.equal(vendorBody("1", SEED[0].vendor).vendor.labor_union, undefined);
  const ub = userBody(c.users[2], 55, c.vendor).user;
  assert.equal(ub.email_address, "mrkygray+ktanaka@gmail.com");
  assert.deepEqual([ub.job_title, ub.business_phone, ub.business_phone_extension, ub.vendor_id, ub.is_employee, ub.is_active], ["Journeyman Electrician", "(310) 555-0120", 103, 55, false, true]);
  assert.equal("default_permission_template_id" in ub, false);
  assert.equal("projectRole" in ub, false);
  assert.equal("email_address" in userBody(c.users[2], 55, c.vendor, { update: true }).user, false);
});

test("GET shows the page; it only runs against Procore's sandbox", async () => {
  assert.match((await run(req("GET"))).body, /Check What's There/);
  process.env.PROCORE_API_URL = "https://api.procore.com";
  const prod = await run(req("GET"));
  assert.equal(prod.statusCode, 403);
  assert.equal(prod.json().error, "not_sandbox");
});

test("plan changes nothing", async () => {
  sandbox();
  const out = await run(req("POST", { action: "plan", ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.equal(b.seed[0].vendor, "already there, will be updated");
  assert.equal(b.seed[1].vendor, "new");
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("cleanup deactivates people through Procore's people list (person ids), only removable rows", async () => {
  sandbox();
  on("POST", /\/rest\/v2\.0\/companies\/4291776\/people\/bulk_deactivate$/, { body: {} });
  on("PATCH", /\/rest\/v1\.0\/vendors\/\d+$/, { body: { id: 1 } });
  const out = await run(req("POST", { action: "cleanup", ...ids, userIds: [7, 8, 9, 11], vendorIds: [91, 92] }));
  assert.equal(out.statusCode, 200, out.body);
  const writes = calls.filter((c) => c.method !== "GET");
  assert.deepEqual(writes.map((c) => `${c.method} ${c.url.replace(ENV.PROCORE_API_URL, "")}`), ["POST /rest/v2.0/companies/4291776/people/bulk_deactivate", "PATCH /rest/v1.0/vendors/92"]);
  assert.deepEqual(writes[0].body, { ids: [1009] });
  assert.equal(writes[1].body.vendor.is_active, false);
});

test("someone already inactive in the people list isn't offered for removal again", async () => {
  sandbox();
  routes.splice(routes.findIndex((r) => r.test("https://sandbox.procore.test/rest/v1.0/companies/4291776/people?page=1", {})), 1,
    { test: (u) => /\/people\?/.test(u), reply: { body: USERS.map((u) => ({ id: u.id + 1000, user_id: u.id, contact: { is_active: u.id !== 9 } })) } });
  const b = (await run(req("POST", { action: "plan", ...ids }))).json();
  assert.equal(b.users.find((u) => u.id === 9).action, "keep");
});

test("company: updates an existing test company and adds it to the project", async () => {
  sandbox();
  on("PATCH", /\/rest\/v1\.0\/vendors\/94$/, { body: { id: 94 } });
  on("GET", /\/projects\/373235\/vendors\?/, { body: [] });
  on("POST", /\/projects\/373235\/vendors\/94\/actions\/add$/, { body: {} });
  const out = await run(req("POST", { action: "company", index: 0, ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  assert.ok(out.json().steps.every((s) => s.ok), out.body);
});

function personRoutes({ roles = ["Project Manager", "Superintendent", "Architect"], userList = [], inactive = false } = {}) {
  sandbox();
  routes.splice(routes.findIndex((r) => r.test("https://sandbox.procore.test/rest/v1.3/companies/4291776/users?page=1", {})), 1,
    { test: (u, init) => (init.method ?? "GET") === "GET" && /\/rest\/v1\.3\/companies\/4291776\/users\?/.test(u), reply: { body: userList } });
  routes.splice(routes.findIndex((r) => r.test("https://sandbox.procore.test/rest/v1.0/companies/4291776/people?page=1", {})), 1,
    { test: (u) => /\/people\?/.test(u), reply: { body: [{ id: 5555, user_id: 301, contact: { is_active: !inactive } }] } });
  on("POST", /\/rest\/v1\.3\/companies\/4291776\/users$/, { status: 201, body: { id: 301 } });
  on("PATCH", /\/rest\/v1\.3\/companies\/4291776\/users\/301$/, { body: { id: 301 } });
  on("POST", /people\/bulk_activate$/, { body: {} });
  on("GET", /\/projects\/373235\/users\?/, { body: [] });
  on("POST", /\/projects\/373235\/users\/301\/actions\/add$/, { body: {} });
  on("GET", /\/rest\/v1\.0\/project_roles\?/, { body: roles.map((role, i) => ({ id: i, role, user_id: null })) });
  on("POST", /\/rest\/v1\.0\/project_roles$/, { status: 201, body: {} });
  on("GET", /\/rest\/v2\.0\/companies\/4291776\/roles\?/, { body: { data: [{ name: "Project Manager" }, { name: "Superintendent" }] } });
}
const writes = () => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url.replace(ENV.PROCORE_API_URL, "")}`);

test("person: creates them in the right company, adds them to the project, General Contractor becomes Superintendent", async () => {
  personRoutes();
  const out = await run(req("POST", { action: "person", index: 0, person: 1, ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(writes(), ["POST /rest/v1.3/companies/4291776/users", "POST /rest/v1.0/projects/373235/users/301/actions/add", "POST /rest/v1.0/project_roles"]);
  const created = calls.find((c) => c.method === "POST" && /\/users$/.test(c.url)).body.user;
  assert.deepEqual([created.email_address, created.vendor_id], ["mrkygray+dokafor@gmail.com", 94]);
  assert.equal(calls.at(-1).body.project_role.role, "Superintendent");
  assert.ok(out.json().steps.every((s) => s.ok), out.body);
});

test("person: a site lead gets Superintendent from the company's roles when the project doesn't list it yet", async () => {
  personRoutes({ roles: ["Project Manager"] });
  const out = await run(req("POST", { action: "person", index: 0, person: 1, ...ids }));
  assert.equal(calls.at(-1).body.project_role.role, "Superintendent");
  assert.ok(out.json().steps.every((s) => s.ok), out.body);
});

test("person: an existing, inactive one is updated and made active again; a Worker gets no role", async () => {
  personRoutes({ userList: [{ id: 301, email_address: "mrkygray+tbrandt@gmail.com" }], inactive: true });
  const out = await run(req("POST", { action: "person", index: 0, person: 2, ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(writes(), ["PATCH /rest/v1.3/companies/4291776/users/301", "POST /rest/v2.0/companies/4291776/people/bulk_activate", "POST /rest/v1.0/projects/373235/users/301/actions/add"]);
  assert.match(out.json().steps.at(-1).detail, /no "Worker" role/);
  assert.doesNotMatch(out.body, /access-1|refresh-1|never-leak/);
});

test("a 429 waits and tries once more", async () => {
  personRoutes();
  let n = 0;
  routes.unshift({ test: (u, init) => (init.method ?? "GET") === "POST" && /\/project_roles$/.test(u), reply: () => (++n === 1 ? { status: 429, body: { message: "rate limit" } } : { status: 201, body: {} }) });
  const out = await run(req("POST", { action: "person", index: 0, person: 0, ...ids }));
  assert.equal(n, 2);
  assert.ok(out.json().steps.every((s) => s.ok), out.body);
});

test("person: a company too new for Procore's search is found by the id the company step handed on", async () => {
  personRoutes();
  routes.unshift({ test: (u) => /\/rest\/v1\.0\/vendors\?.*filters/.test(u), reply: { body: [] } });
  on("GET", /\/rest\/v1\.0\/vendors\/3798033\?/, { body: { id: 3798033, name: "VoltLine Electric Inc." } });
  const out = await run(req("POST", { action: "person", index: 1, person: 0, vendorId: "3798033", ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(calls.find((c) => c.method === "POST" && /\/users$/.test(c.url)).body.user.vendor_id, 3798033);
  assert.ok(out.json().steps.every((s) => s.ok), out.body);
});

test("role: creates Superintendent shaped like the Project Manager role, once", async () => {
  sandbox();
  let roles = [{ id: "1", name: "Project Manager", type: "user", display_on_company_home: true }];
  on("GET", /\/rest\/v2\.0\/companies\/4291776\/roles\?/, () => ({ body: { data: roles } }));
  on("POST", /\/rest\/v2\.0\/companies\/4291776\/roles$/, (u, init) => { roles = [...roles, JSON.parse(init.body).project_role]; return { status: 201, body: { data: {} } }; });
  const first = await run(req("POST", { action: "role", ...ids }));
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(calls.find((c) => c.method === "POST").body, { project_role: { name: "Superintendent", type: "user", add_to_project_team: true, display_on_company_home: true } });
  assert.ok(first.json().steps[0].ok);
  const again = await run(req("POST", { action: "role", ...ids }));
  assert.equal(again.json().steps[0].detail, "already there");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("role names: exact first (any case), then the closest for General Contractor, else none", () => {
  assert.equal(projectRoleFor("Project Manager", ["project manager", "Architect"]), "project manager");
  assert.equal(projectRoleFor("General Contractor", ["Foreman", "Superintendent"]), "Superintendent");
  assert.equal(projectRoleFor("Worker", ["Superintendent"]), null);
});
