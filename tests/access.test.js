// Who Procore will accept for a Punch Item / Observation (api/_access.js, api/procore/access.js), against a mocked
// Procore shaped like the sandbox (2026-10-15) and an in-memory copy of the saved template levels. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import access from "../api/procore/access.js";
import { accessFor, keepLevels, setAccessStore, STALE_MS } from "../api/_access.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const T = {
  pm: { id: 1, name: "Project Manager - Internal", levels: { punch_list: 4, observations: 4, task_items: 4, directory: 4, budgeting: 4 } },
  sub: { id: 2, name: "Subcontractor - External", levels: { punch_list: 3, observations: 3, task_items: 1, directory: 1 } },
  arch: { id: 3, name: "Architect/Engineer - External", levels: { punch_list: 3, observations: 1, task_items: 1, directory: 1 } },
  owner: { id: 4, name: "Owner/Client - External", levels: { punch_list: 1, observations: 1, task_items: 1, directory: 1 } },
};
const tpl = (t) => ({ id: t.id, name: t.name, category: "x", project_specific: false, type: "x" });
const USERS = [
  { id: 481274, name: "Edward Gray", email_address: "e@example.com", permission_template: tpl(T.pm) },
  { id: 900, name: "Tyler Brandt", email_address: "t@example.com", permission_template: tpl(T.sub) },
  { id: 901, name: "Test Architect", email_address: "a@example.com", permission_template: tpl(T.arch) },
  { id: 902, name: "Olive Owner", email_address: "o@example.com", permission_template: tpl(T.owner) },
  { id: 903, name: "No Template", email_address: "n@example.com", permission_template: null },
];
let calls, saved, kept, admin, obsList;
beforeEach(() => {
  calls = [];
  kept = null;
  admin = true;
  obsList = true;
  saved = { fetch: globalThis.fetch, env: { ...process.env }, error: console.error };
  Object.assign(process.env, ENV);
  console.error = () => {};
  setAccessStore({ read: async () => kept, write: async (_c, v) => { kept = structuredClone(v); } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (/\/projects\/373235\/users\?/.test(u)) return json(200, USERS);
    if (/\/observations\/assignees\?/.test(u)) return obsList ? json(200, USERS.filter((x) => [481274, 900].includes(x.id)).map((x) => ({ id: x.id, name: x.name }))) : json(403, { errors: "no" });
    const m = u.match(/\/companies\/4291776\/permission_templates\/(\d+)/);
    if (m) {
      if (!admin) return json(403, { errors: "Forbidden" });
      const t = Object.values(T).find((x) => String(x.id) === m[1]);
      return json(200, { id: t.id, name: t.name, user_access_levels: t.levels, permissions: {} });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.error = saved.error;
  setAccessStore(null);
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const run = async () => {
  const out = res();
  await access({ method: "GET", url: "/api/procore/access?companyId=4291776&projectId=373235", headers: { host: "sitesnap-procore.vercel.app", cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  return out;
};

test("levels: only None (1) blocks; no template blocks everything", () => {
  const templates = Object.fromEntries(Object.values(T).map((t) => [String(t.id), keepLevels({ name: t.name, user_access_levels: t.levels })]));
  assert.deepEqual(templates["1"], { name: "Project Manager - Internal", punch_list: 4, observations: 4, task_items: 4, directory: 4 }, "only the tools SiteSnap uses are kept");
  assert.deepEqual(accessFor(USERS[2], templates, null).observation, { ok: false, why: '"Architect/Engineer - External" has no access to Observations' });
  assert.equal(accessFor(USERS[2], templates, null).punch_item.ok, true);
  assert.equal(accessFor(USERS[3], templates, null).punch_item.ok, false);
  assert.deepEqual(accessFor(USERS[4], templates, null).punch_item, { ok: false, why: "no permission template in Procore" });
  assert.equal(accessFor(USERS[1], {}, null).punch_item.ok, null, "levels not known yet: no warning");
  assert.equal(accessFor({ ...USERS[1], permission_template: tpl({ id: 9, name: "Viewer" }) }, { 9: { punch_list: 2 } }, null).punch_item.ok, true, "Read Only isn't treated as a no (not seen yet)");
});

test("an admin opens it: levels are read from Procore and saved; Procore's Observation list decides Observations", async () => {
  const out = await run();
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.equal(b.levelsKnown, true);
  assert.equal(b.observationList, true);
  assert.equal(b.people["900"].punch_item.ok, true);
  assert.equal(b.people["901"].observation.ok, false, "not on Procore's Observation list");
  assert.equal(b.people["902"].punch_item.ok, false);
  assert.match(b.people["902"].punch_item.why, /Owner\/Client - External" has no access to Punch List/);
  assert.equal(b.people["903"].observation.why, "no permission template in Procore");
  assert.equal(Object.keys(kept.templates).length, 4, "saved for everyone");
  assert.ok(!/example\.com|access-1|secret-never-leak/.test(out.body), "no emails or tokens");
});

test("not an admin: Procore refuses the levels, the saved copy is used and kept; nothing saved over it", async () => {
  admin = false;
  const first = await run();
  assert.equal(first.json().levelsKnown, false);
  assert.equal(first.json().people["902"].punch_item.ok, null, "not known: no warning");
  assert.equal(kept, null);
  assert.equal(calls.filter((u) => /permission_templates/.test(u)).length, 1, "stops at the first refusal");

  admin = true;
  await run(); // an admin fills it in
  admin = false;
  calls = [];
  const later = await run();
  assert.equal(later.json().people["902"].punch_item.ok, false, "everyone gets the admin's copy");
  assert.ok(!calls.some((u) => /permission_templates/.test(u)), "fresh copy: no template calls");
});

test("the saved copy is refreshed after a day, or when a template SiteSnap hasn't seen shows up", async () => {
  await run();
  calls = [];
  kept.at = Date.now() - STALE_MS - 1000;
  await run();
  assert.equal(calls.filter((u) => /permission_templates/.test(u)).length, 4, "stale: read again");
  calls = [];
  delete kept.templates["3"];
  await run();
  assert.ok(calls.some((u) => /permission_templates\/3/.test(u)), "a new template: read again");
});

test("without Procore's Observation list, Observations fall back to the template levels", async () => {
  obsList = false;
  const b = (await run()).json();
  assert.equal(b.observationList, false);
  assert.equal(b.people["901"].observation.ok, false);
  assert.equal(b.people["900"].observation.ok, true);
});
