// The read-only permissions check page (api/procore/test-permissions.js) against a mocked Procore.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import check, { pace } from "../api/procore/test-permissions.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
let calls, saved;
const people = [
  { id: 481274, name: "Edward Gray", email_address: "e@example.com", mobile_phone: "555-0100", permission_template: { id: 1, name: "Project Manager - Internal" } },
  { id: 900, name: "Tyler Brandt", email_address: "t@example.com", permission_template: { id: 2, name: "Subcontractor - External" } },
  { id: 901, name: "Lisa Hubbard", email_address: "l@example.com", permission_template: null },
];
const reply = (u) => {
  if (/\/me\?/.test(u)) return [200, { id: 481274, name: "Edward Gray" }];
  if (/\/projects\/373235\/users\?/.test(u)) return [200, people];
  if (/\/projects\/373235\/users\/481274/.test(u)) return [200, people[0]];
  if (/\/projects\/373235\/permission_templates\?|\/projects\/373235\/permission_templates$/.test(u)) return [200, [{ id: 1, name: "Project Manager - Internal" }, { id: 2, name: "Subcontractor - External" }]];
  if (/\/companies\/4291776\/permission_templates\/2/.test(u)) return [200, { id: 2, name: "Subcontractor - External", user_access_levels: { punch_list: "standard", observations: "standard", tasks: "none", directory: "read_only", budgeting: "none" } }];
  if (/potential_distribution_members/.test(u) && /observations/.test(u)) return [200, [{ id: 481274, name: "Edward Gray", email_address: "e@example.com" }, { id: 900, name: "Tyler Brandt" }]];
  if (/\/companies\?|\/projects\?/.test(u)) return [200, /companies/.test(u) ? [{ id: 4291776, name: "Kyco", is_active: true }] : [{ id: 373235, name: "Sandbox Test Project" }]];
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
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.log = saved.log;
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}

test("permissions check: read only, says who's missing from each list, never shows emails, phones or tokens", async () => {
  const out = res();
  await check({ method: "POST", url: "/api/procore/test-permissions", body: { companyId: "4291776", projectId: "373235" }, headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  assert.equal(out.statusCode, 200, out.body);
  assert.ok(calls.every((c) => c.method === "GET"), "only GET calls");
  const b = out.json();
  assert.match(b.who, /Project Manager - Internal/);
  const obs = b.steps.find((s) => s.name.startsWith("Observations: who can be on the distribution (documented)"));
  assert.ok(obs.ok);
  assert.match(obs.detail, /Not in it: Lisa Hubbard/);
  assert.match(b.steps[0].detail, /3 people; 2 have a permission template/);
  const sub = b.steps.find((s) => s.name === 'What "Subcontractor - External" allows');
  assert.ok(sub.ok);
  assert.match(sub.detail, /punch_list: standard; observations: standard; tasks: none; directory: read_only/);
  assert.ok(!/budgeting/.test(sub.detail), "only the tools SiteSnap uses");
  assert.ok(b.steps.some((s) => s.status === 404), "a template Procore won't show reads as not readable");
  assert.ok(!/example\.com|555-0100|access-1|secret-never-leak/.test(out.body), out.body);
});

test("permissions check: sandbox only", async () => {
  process.env.PROCORE_API_URL = "https://api.procore.com";
  const out = res();
  await check({ method: "GET", url: "/api/procore/test-permissions", headers: {} }, out);
  assert.equal(out.statusCode, 403);
});
