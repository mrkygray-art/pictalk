// The sandbox test-people page (api/procore/seed-directory.js) and its cleanup rules (api/_seedDirectory.js),
// against a mocked Procore with the request shapes from Procore's reference. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import seedDirectory, { pace } from "../api/procore/seed-directory.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { SEED, cleanupPlan, permissionTemplateFor, projectRoleFor, removable, userBody, vendorBody } from "../api/_seedDirectory.js";

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

test("the seed is Ky's sheet in full: 4 companies, 4 people each, nothing else", () => {
  assert.deepEqual(SEED.map((c) => c.vendor.name), ["Ironbridge Construction Group", "VoltLine Electric Inc.", "ClearFlow Plumbing & Mechanical", "Summit Framing & Drywall"]);
  assert.deepEqual(SEED.map((c) => c.users.length), [4, 4, 4, 4]);
  const people = SEED.flatMap((c) => c.users);
  assert.deepEqual(["PM", "GC", "Worker"].map((t) => people.filter((u) => u.roleType === t).length), [4, 4, 8]);
  // Emails follow mrkygray+<first initial><last name>, all lowercase, unique
  for (const u of people) assert.equal(u.email_address, `mrkygray+${u.first_name[0]}${u.last_name}@gmail.com`.toLowerCase());
  assert.equal(new Set(people.map((u) => u.email_address)).size, 16);
  // Only PMs get a Project Role; the tag says the role type
  assert.ok(people.every((u) => (u.roleType === "PM" ? u.projectRole === "Project Manager" : u.projectRole === null)));
  const lena = userBody(SEED[2].users[3], 9, SEED[2].vendor).user;
  assert.deepEqual([lena.email_address, lena.job_title, lena.initials, lena.mobile_phone, lena.business_phone, lena.business_phone_extension, lena.notes],
    ["mrkygray+lkowalski@gmail.com", "HVAC Technician", "LK", "(424) 555-0154", "(424) 555-0140", 304, "SiteSnap test data. Role type: Worker."]);
  const v = vendorBody("1", SEED[3].vendor).vendor;
  assert.deepEqual([v.trade_name, v.email_address, v.labor_union, v.license_number], ["Summit Interiors", "mrkygray+SummitCompany@gmail.com", "Carpenters Local 721", "CA-C9-698330"]);
});

test("cleanup plan: the earlier expansion set is offered for removal; its lkowalski / druiz records are reused", () => {
  const users = [ME,
    { id: 20, name: "Carla Vasquez", email_address: "mrkygray+cvasquez@gmail.com", vendor: { id: 95, name: "Summit Roofing & Waterproofing" } },
    { id: 21, name: "Lena Kowalski", email_address: "mrkygray+lkowalski@gmail.com", vendor: { id: 96, name: "Pacific Concrete & Foundations" } },
    { id: 22, name: "Dominic Ruiz", email_address: "mrkygray+druiz@gmail.com", vendor: { id: 97, name: "Sentinel Low Voltage & Security" } },
  ];
  const vendors = [{ id: 90, name: "SiteSnap AI" }, { id: 95, name: "Summit Roofing & Waterproofing", email_address: "mrkygray+SummitRoofingCompany@gmail.com" },
    { id: 96, name: "Pacific Concrete & Foundations", email_address: "mrkygray+PacificConcreteCompany@gmail.com" }, { id: 98, name: "Summit Framing & Drywall" }];
  const p = cleanupPlan({ users, vendors, meId: 7 });
  const u = Object.fromEntries(p.users.map((r) => [r.id, r]));
  const v = Object.fromEntries(p.vendors.map((r) => [r.id, r]));
  assert.deepEqual([u[20].action, u[20].checked], ["remove", true]);
  assert.equal(u[21].action, "reuse");
  assert.equal(u[22].action, "reuse");
  assert.deepEqual([v[95].action, v[95].checked], ["remove", true]);
  assert.deepEqual([v[96].action, v[96].checked], ["remove", true]);
  assert.equal(v[98].action, "reuse");
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

const TEMPLATES = [
  { id: 71, name: "Architect/Engineer - External" }, { id: 72, name: "Foreman / Superintendent - Internal" },
  { id: 73, name: "Owner/Client - External" }, { id: 74, name: "Project Manager - Internal" }, { id: 75, name: "Subcontractor - External" },
];
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
  on("GET", /\/projects\/373235\/permission_templates/, { body: TEMPLATES });
  on("PATCH", /\/projects\/373235\/permission_template_assignments$/, { body: {} });
}
const writes = () => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url.replace(ENV.PROCORE_API_URL, "")}`);

test("person: a PM is created in the right company, added to the project, and given Project Manager", async () => {
  personRoutes();
  const out = await run(req("POST", { action: "person", index: 0, person: 0, ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(writes(), ["POST /rest/v1.3/companies/4291776/users", "POST /rest/v1.0/projects/373235/users/301/actions/add", "PATCH /rest/v1.0/projects/373235/permission_template_assignments", "POST /rest/v1.0/project_roles"]);
  const created = calls.find((c) => c.method === "POST" && /\/users$/.test(c.url)).body.user;
  assert.deepEqual([created.email_address, created.vendor_id], ["mrkygray+mhale@gmail.com", 94]);
  assert.equal(calls.at(-1).body.project_role.role, "Project Manager");
  assert.ok(out.json().steps.every((s) => s.ok), out.body);
});

test("person: a supervisor (GC) gets no Project Role and no role calls", async () => {
  personRoutes();
  const out = await run(req("POST", { action: "person", index: 0, person: 1, ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(writes(), ["POST /rest/v1.3/companies/4291776/users", "POST /rest/v1.0/projects/373235/users/301/actions/add", "PATCH /rest/v1.0/projects/373235/permission_template_assignments"]);
  assert.ok(!calls.some((c) => /project_roles|\/roles/.test(c.url)));
  // Diane is Ironbridge (the GC) staff: Internal
  assert.deepEqual(calls.find((c) => c.method === "PATCH").body, { permission_template_assignments: { user_id: 301, permission_template_id: 72 } });
  assert.match(out.json().steps.at(-1).detail, /none \(role type GC\)/);
});

test("person: an existing, inactive one is updated and made active again", async () => {
  personRoutes({ userList: [{ id: 301, email_address: "mrkygray+tbrandt@gmail.com" }], inactive: true });
  const out = await run(req("POST", { action: "person", index: 0, person: 2, ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(writes(), ["PATCH /rest/v1.3/companies/4291776/users/301", "POST /rest/v2.0/companies/4291776/people/bulk_activate", "POST /rest/v1.0/projects/373235/users/301/actions/add", "PATCH /rest/v1.0/projects/373235/permission_template_assignments"]);
  assert.doesNotMatch(out.body, /access-1|refresh-1|never-leak/);
});

test("person: a PM on a project without the Project Manager role is reported, not guessed", async () => {
  personRoutes({ roles: ["Architect"] });
  const out = await run(req("POST", { action: "person", index: 0, person: 0, ...ids }));
  const last = out.json().steps.at(-1);
  assert.equal(last.ok, false);
  assert.match(last.detail, /no "Project Manager" role/);
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

test("role names: matched in any case; none wanted, none given", () => {
  assert.equal(projectRoleFor("Project Manager", ["project manager", "Architect"]), "project manager");
  assert.equal(projectRoleFor("Project Manager", ["Architect"]), null);
  assert.equal(projectRoleFor(null, ["Project Manager"]), null);
});

test("verify: finds each person, checks company, email, tag, project and roles, and reports problems", async () => {
  sandbox();
  const two = SEED;
  const vend = two.map((c, i) => ({ id: 500 + i, name: c.vendor.name }));
  let id = 600;
  const people = two.flatMap((c, i) => c.users.map((u) => ({
    id: ++id, name: `${u.first_name} ${u.last_name}`, email_address: u.email_address, job_title: u.job_title,
    notes: `SiteSnap test data. Role type: ${u.roleType}.`, vendor: { id: 500 + i, name: c.vendor.name }, roleType: u.roleType,
  })));
  people[1].vendor = { id: 501, name: "VoltLine Electric Inc." }; // Diane in the wrong company
  const all = [ME, ...people];
  routes.splice(routes.findIndex((r) => r.test("https://sandbox.procore.test/rest/v1.3/companies/4291776/users?page=1", {})), 1,
    { test: (u, init) => (init.method ?? "GET") === "GET" && /\/rest\/v1\.3\/companies\/4291776\/users\?/.test(u), reply: { body: all } });
  routes.splice(routes.findIndex((r) => r.test("https://sandbox.procore.test/rest/v1.0/companies/4291776/people?page=1", {})), 1,
    { test: (u) => /\/people\?/.test(u), reply: { body: all.map((u) => ({ id: u.id + 1000, user_id: u.id, contact: { is_active: true } })) } });
  routes.splice(routes.findIndex((r) => r.test("https://sandbox.procore.test/rest/v1.0/vendors?page=1", {})), 1,
    { test: (u) => /\/rest\/v1\.0\/vendors\?/.test(u), reply: { body: [...VENDORS, ...vend] } });
  people[4].permission_template = { id: 74, name: "Project Manager - Internal" }; // Rosa, a sub PM: should be external
  for (const [i, u] of people.entries()) u.permission_template ??= { id: i < 4 ? (u.roleType === "PM" ? 74 : 72) : 75, name: permissionTemplateFor(i < 4 ? SEED[0] : SEED[1], u) };
  on("GET", /\/projects\/373235\/users\?/, { body: all });
  on("GET", /\/rest\/v1\.0\/project_roles\?/, { body: people.filter((u) => u.roleType === "PM").map((u) => ({ role: "Project Manager", user_id: u.id })) });
  const out = await run(req("POST", { action: "verify", ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  const steps = out.json().steps;
  assert.equal(steps.length, 6);
  assert.match(steps[0].detail, /Diane Okafor: company is VoltLine/);
  assert.match(steps[1].detail, /Rosa Mendez: template is Project Manager - Internal, expected Subcontractor - External/);
  assert.ok(steps.slice(2, 4).every((s) => s.ok), out.body);
  assert.ok(steps[4].ok);
  assert.match(steps[5].detail, /4 PM, 4 GC, 8 Worker.*17 people \(16 SiteSnap test people/);
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("permission templates follow Ky's matching: 1 PM Internal, 3 Foreman / Superintendent Internal, 12 Subcontractor External", () => {
  const counts = {};
  for (const c of SEED) for (const u of c.users) { const t = permissionTemplateFor(c, u); counts[t] = (counts[t] ?? 0) + 1; }
  assert.deepEqual(counts, { "Project Manager - Internal": 1, "Foreman / Superintendent - Internal": 3, "Subcontractor - External": 12 });
  // Sub PMs stay external
  assert.equal(permissionTemplateFor(SEED[1], SEED[1].users[0]), "Subcontractor - External");
});

test("templates: sets each person's template, skips one already right, reports someone missing", async () => {
  sandbox();
  const c = SEED[2]; // ClearFlow: Greg, Alicia, Omar, Lena
  const listed = [
    { id: 401, email_address: c.users[0].email_address, vendor: { id: 95, name: c.vendor.name } },
    { id: 402, email_address: c.users[1].email_address, vendor: { id: 95, name: c.vendor.name } },
  ];
  routes.splice(routes.findIndex((r) => r.test("https://sandbox.procore.test/rest/v1.3/companies/4291776/users?page=1", {})), 1,
    { test: (u) => /\/rest\/v1\.3\/companies\/4291776\/users\?/.test(u), reply: { body: listed } });
  on("GET", /\/projects\/373235\/permission_templates/, { body: TEMPLATES });
  on("GET", /\/projects\/373235\/users\?/, { body: [{ id: 401, permission_template: { id: 75, name: "Subcontractor - External" } }, { id: 402, permission_template: null }] });
  on("PATCH", /\/projects\/373235\/permission_template_assignments$/, { body: {} });
  const out = await run(req("POST", { action: "templates", index: 2, ...ids }));
  assert.equal(out.statusCode, 200, out.body);
  const steps = out.json().steps;
  assert.equal(steps[0].detail, "already set");
  assert.ok(steps[1].ok);
  assert.deepEqual(calls.filter((x) => x.method === "PATCH").map((x) => x.body), [{ permission_template_assignments: { user_id: 402, permission_template_id: 75 } }]);
  assert.equal(steps[2].ok, false);
  assert.match(steps[2].detail, /not in the directory/);
});
