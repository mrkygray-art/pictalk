// POST /api/procore/session (api/procore/session.js): a Procore sign-in becomes a SiteSnap sign-in.
// Mocked Procore (shapes from Procore's reference), an in-memory Firestore and a fake token signer.
// Checks: who it signs in, which project memberships it records and removes, same-origin JSON only,
// nothing secret in the answer. No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import session, { uidFor } from "../api/procore/session.js";
import { setAuth, setStore } from "../api/_firestore.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "test-client-id",
  PROCORE_CLIENT_SECRET: "test-client-secret-never-leak",
  PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test",
  SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};

// In-memory Firestore: doc(path).get/set/delete and batch()
let docs, tokens, calls, replies, saved;
const fakeDb = {
  doc: (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  }),
  batch: () => {
    const ops = [];
    return {
      set: (ref, v) => ops.push(() => docs.set(ref.path, v)),
      delete: (ref) => ops.push(() => docs.delete(ref.path)),
      commit: async () => ops.forEach((op) => op()),
    };
  },
};
const fakeAuth = { createCustomToken: async (uid, claims) => { tokens.push({ uid, claims }); return `custom-token-for-${uid}`; } };

beforeEach(() => {
  docs = new Map();
  tokens = [];
  calls = [];
  replies = [];
  saved = { fetch: globalThis.fetch, env: { ...process.env }, error: console.error };
  Object.assign(process.env, ENV);
  setStore(fakeDb);
  setAuth(fakeAuth);
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.error = saved.error;
});

const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const post = (headers = {}) => ({
  method: "POST",
  url: "/api/procore/session",
  headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}`, ...headers },
  body: {},
});
function res() {
  const headers = {};
  return {
    statusCode: 200, headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    end(b) { this.body = b ?? ""; },
    json() { return JSON.parse(this.body); },
  };
}
const run = async (r) => { const out = res(); await session(r, out); return out; };

// me, companies, projects per company (in that order)
const procoreSaysOn = (projects) => {
  replies.push({ body: { id: 101, login: "fred@example.com", name: "Fred Foreman" } });
  replies.push({ body: [{ id: 4291776, name: "Kyco Builders", is_active: true }] });
  replies.push({ body: projects.map(([id, name]) => ({ id, name })) });
};

test("signs in the Procore user and records every project they can open", async () => {
  procoreSaysOn([[373235, "001 - Test"], [373236, "002 - Annex"]]);
  const out = await run(post());
  assert.equal(out.statusCode, 200);
  const body = out.json();
  assert.equal(body.token, "custom-token-for-procore_101");
  assert.deepEqual(body.me, { procoreUserId: "101", name: "Fred Foreman" });
  assert.equal(body.projects.length, 2);
  assert.deepEqual(tokens, [{ uid: uidFor("101"), claims: { procoreUserId: "101" } }]);
  assert.deepEqual(docs.get("procoreProjects/4291776_373235/members/101").name, "Fred Foreman");
  assert.ok(docs.has("procoreProjects/4291776_373236/members/101"));
  assert.deepEqual(docs.get("procoreUsers/101").projectKeys, ["4291776_373235", "4291776_373236"]);
  assert.ok(!out.body.includes("fred@example.com"), "no email in the answer");
  assert.ok(!out.body.includes("access-1") && !out.body.includes(ENV.PROCORE_CLIENT_SECRET), "no Procore token or secret");
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ["/rest/v1.0/me", "/rest/v1.0/companies", "/rest/v1.1/projects"]);
});

test("a project they were removed from loses their membership (so its feed is gone)", async () => {
  docs.set("procoreUsers/101", { projectKeys: ["4291776_373235", "4291776_999"] });
  docs.set("procoreProjects/4291776_999/members/101", { procoreUserId: "101" });
  procoreSaysOn([[373235, "001 - Test"]]);
  const out = await run(post());
  assert.equal(out.statusCode, 200);
  assert.ok(!docs.has("procoreProjects/4291776_999/members/101"));
  assert.ok(docs.has("procoreProjects/4291776_373235/members/101"));
});

test("on no projects: signed in, nothing to read", async () => {
  replies.push({ body: { id: 101, login: "fred@example.com", name: "Fred Foreman" } });
  replies.push({ body: [] });
  const out = await run(post());
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json().projects, []);
  assert.deepEqual(docs.get("procoreUsers/101").projectKeys, []);
});

test("Procore leaves the name out without a company: it asks again with one, else uses the login's first part", async () => {
  replies.push({ body: { id: 7, login: "pat.pm@example.com", name: null } });
  replies.push({ body: [{ id: 1, name: "Co", is_active: true }] });
  replies.push({ body: [{ id: 2, name: "P" }] });
  replies.push({ body: { id: 7, name: "Pat PM" } });
  const out = await run(post());
  assert.equal(out.json().me.name, "Pat PM");
  assert.equal(calls[3].headers["Procore-Company-Id"], "1");
});

test("refuses without a Procore sign-in, a GET, a form post, or another site; nothing written", async () => {
  const noCookie = await run({ ...post(), headers: { ...post().headers, cookie: "" } });
  assert.equal(noCookie.statusCode, 401);
  assert.equal((await run({ ...post(), method: "GET" })).statusCode, 405);
  assert.equal((await run(post({ "content-type": "application/x-www-form-urlencoded" }))).statusCode, 415);
  assert.equal((await run(post({ origin: "https://evil.example" }))).statusCode, 403);
  assert.equal(docs.size, 0);
  assert.equal(tokens.length, 0);
  assert.equal(calls.length, 0);
});
