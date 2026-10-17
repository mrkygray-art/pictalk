// Guest demo (docs/guest-demo.md; api/_demo.js, api/procore/demo.js, api/procore/demo-authorize.js).
// Mocked Procore, an in-memory Firestore (with transactions) and a fake token signer; no emulators needed.
// Follows the spec's acceptance tests: /demo with no login, exactly the allowlisted projects, 403 for any other
// project, no guest name/email/tokens anywhere, every write refused, single-flight refresh across visitors,
// the unavailable page, Exit demo, and normal sign-ins untouched.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import demoStart from "../api/procore/demo.js";
import authorize, { finishDemoAuthorize } from "../api/procore/demo-authorize.js";
import sessionHandler from "../api/procore/session.js";
import meHandler from "../api/procore/me.js";
import projectsHandler from "../api/procore/projects.js";
import logoutHandler from "../api/procore/logout.js";
import recordsHandler from "../api/procore/records.js";
import { setAuth, setStore } from "../api/_firestore.js";
import { config, demoBudget, forgetDemoCache, procoreGet, rateLimitWait, seal, SESSION_COOKIE, unseal } from "../api/_procore.js";
import { procoreSend } from "../api/_procoreWrite.js";
import { AUTH_DOC, demoSettings, demoTiming, forgetDemoMemo, forgetRateLimits, guestTokens, saveGuestAuth } from "../api/_demo.js";

const ENV = {
  PROCORE_CLIENT_ID: "test-client-id",
  PROCORE_CLIENT_SECRET: "test-client-secret-never-leak",
  PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test",
  SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  DEMO_ENABLED: "true",
  DEMO_PROJECT_IDS: "HP:101,WG:102,LV:103",
  DEMO_TOKEN_ENCRYPTION_KEY: "demo-key-for-tests-at-least-32-characters",
  DEMO_ADMIN_EMAILS: "Owner@Example.com",
  FIREBASE_SERVICE_ACCOUNT_B64: "",
};
const HOST = "sitesnap-procore.vercel.app";
const GUEST = { id: 777, login: "guest-secret@example.com", name: "Gina Guestperson" };
const PROJECTS = [
  { companyId: "9", companyName: "Sandbox Co", projectId: "101", name: "Harbor Point" },
  { companyId: "9", companyName: "Sandbox Co", projectId: "102", name: "Westgate" },
  { companyId: "9", companyName: "Sandbox Co", projectId: "103", name: "Lakeview" },
];

// ---------- in-memory Firestore (doc get/set/delete, batch, runTransaction run one at a time) ----------
let docs;
let lock = Promise.resolve();
const ref = (path) => ({
  path,
  get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }),
  set: async (v, opts) => { docs.set(path, opts?.merge ? { ...(docs.get(path) ?? {}), ...v } : v); },
  delete: async () => { docs.delete(path); },
});
const fakeDb = {
  doc: ref,
  batch: () => {
    const ops = [];
    return { set: (r, v) => ops.push(() => docs.set(r.path, v)), delete: (r) => ops.push(() => docs.delete(r.path)), commit: async () => ops.forEach((op) => op()) };
  },
  runTransaction: (fn) => {
    const run = lock.then(async () => {
      const writes = [];
      const out = await fn({ get: (r) => r.get(), set: (r, v, opts) => writes.push(() => r.set(v, opts)) });
      for (const w of writes) await w();
      return out;
    });
    lock = run.catch(() => {});
    return run;
  },
};
let tokens; // Firebase custom tokens made
const fakeAuth = { createCustomToken: async (uid, claims) => { tokens.push({ uid, claims }); return `custom-token-for-${uid}`; } };

// ---------- mocked Procore ----------
let calls, refreshes, refreshReply, nextAt;
function procore(url, init = {}) {
  const u = new URL(url);
  calls.push({ url: String(url), method: init.method ?? "GET", auth: init.headers?.Authorization ?? "" });
  if (u.pathname === "/oauth/token") {
    refreshes++;
    if (refreshReply === "refuse") return json({ error: "invalid_grant" }, 400);
    const n = ++nextAt;
    return json({ access_token: `guest-access-${n}`, refresh_token: `guest-refresh-${n}`, expires_in: 5400, created_at: Math.floor(Date.now() / 1000) });
  }
  if (u.pathname === "/rest/v1.0/me") return json(GUEST);
  if (u.pathname === "/rest/v1.0/companies") return json([{ id: 9, name: "Sandbox Co" }]);
  if (u.pathname === "/rest/v1.1/projects") return json([{ id: 101, name: "Harbor Point" }, { id: 102, name: "Westgate" }, { id: 103, name: "Lakeview" }, { id: 555, name: "SiteSnap" }, { id: 556, name: "Sandbox Test Project" }]);
  if (/\/projects\/\d+\/users/.test(u.pathname)) return json([{ id: 777, name: GUEST.name, email_address: GUEST.login }, { id: 12, name: "Tyler Brandt", job_title: "Foreman" }]);
  if (/\/projects\/\d+/.test(u.pathname)) return json({ id: 1, ok: true });
  return json({ unexpected: String(url) }, 404);
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let saved;
beforeEach(() => {
  docs = new Map();
  tokens = [];
  calls = [];
  refreshes = 0;
  refreshReply = "ok";
  nextAt = 1;
  saved = { fetch: globalThis.fetch, env: { ...process.env }, error: console.error, log: console.log, wait: rateLimitWait.maxMs, budget: demoBudget.perMinute, timing: { ...demoTiming } };
  Object.assign(process.env, ENV);
  setStore(fakeDb);
  setAuth(fakeAuth);
  forgetDemoMemo();
  forgetDemoCache();
  forgetRateLimits();
  rateLimitWait.maxMs = 0;
  demoTiming.waitMs = 5;
  console.error = (...a) => { errors.push(a.join(" ")); };
  console.log = () => {};
  errors = [];
  globalThis.fetch = async (url, init) => procore(url, init);
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.error = saved.error;
  console.log = saved.log;
  rateLimitWait.maxMs = saved.wait;
  demoBudget.perMinute = saved.budget;
  Object.assign(demoTiming, saved.timing);
  setStore(null);
  setAuth(null);
});
let errors = [];

// The guest authorization as Ky's authorize step stores it (token valid for an hour unless given)
async function storeGuest({ exp = Math.floor(Date.now() / 1000) + 3600 } = {}) {
  await saveGuestAuth({ tokens: { at: "guest-access-1", rt: "guest-refresh-1", exp }, guestUserId: 777, projects: PROJECTS, missing: [] });
}

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
const cookieFrom = (out) => [].concat(out.getHeader("set-cookie") ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith(`${SESSION_COOKIE}=`) && c.length > SESSION_COOKIE.length + 1);
const req = ({ method = "GET", url = "/", cookie, ip = "203.0.113.5", body, headers = {} } = {}) => ({
  method, url, body,
  headers: { host: HOST, "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(method === "POST" ? { "content-type": "application/json", origin: `https://${HOST}` } : {}), ...headers },
});
async function startDemo(url = "/demo") {
  const out = res();
  await demoStart(req({ url }), out);
  return out;
}
const demoCookie = async () => cookieFrom(await startDemo());
// Nothing secret or identifying about the guest in a response
function assertClean(text) {
  for (const bad of ["guest-access", "guest-refresh", GUEST.login, GUEST.name, ENV.DEMO_TOKEN_ENCRYPTION_KEY, ENV.PROCORE_CLIENT_SECRET]) {
    assert.ok(!String(text).includes(bad), `response must not contain ${bad}`);
  }
}

// ---------- settings ----------

test("settings: DEMO_PROJECT_IDS takes the demo-staging form (HP:101) or plain ids", () => {
  assert.deepEqual(demoSettings({ DEMO_PROJECT_IDS: "HP:101, WG:102,LV:103" }).projectIds, ["101", "102", "103"]);
  assert.deepEqual(demoSettings({ DEMO_PROJECT_IDS: "101,102,abc,,103" }).projectIds, ["101", "102", "103"]);
  assert.deepEqual(demoSettings({ DEMO_ADMIN_EMAILS: " A@B.com ,c@d.com" }).admins, ["a@b.com", "c@d.com"]);
});

// ---------- acceptance 1: /demo signs in with no login ----------

test("/demo: sets a demo session cookie (httpOnly, Secure, Lax, no tokens) and redirects to the picker", async () => {
  await storeGuest();
  const out = await startDemo();
  assert.equal(out.statusCode, 302);
  assert.equal(out.getHeader("location"), "/?demo=1");
  assert.equal(out.getHeader("x-robots-tag"), "noindex, nofollow");
  const set = [].concat(out.getHeader("set-cookie")).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  assert.match(set, /HttpOnly; Secure; SameSite=Lax; Max-Age=7200/);
  const value = unseal(set.split(";")[0].slice(SESSION_COOKIE.length + 1), ENV.SESSION_SECRET, SESSION_COOKIE);
  assert.equal(value.role, "demo");
  assert.ok(!("at" in value) && !("rt" in value), "the cookie holds no Procore tokens");
  assertClean(set);
  assert.ok(!calls.some((c) => c.url.includes("/oauth/authorize")), "never sends the visitor to Procore's login");
});

test("/demo?project= opens an allowlisted project, and ignores any other id", async () => {
  await storeGuest();
  assert.equal((await startDemo("/demo?project=102")).getHeader("location"), "/?demo=1&companyId=9&projectId=102");
  assert.equal((await startDemo("/demo?project=555")).getHeader("location"), "/?demo=1");
});

// ---------- acceptance 2 + 3: exactly the three projects; the guest's identity never shows ----------

test("demo session: SiteSnap sign-in is 'Guest' with the three projects only, and the Firebase token says demo", async () => {
  await storeGuest();
  const cookie = await demoCookie();
  const out = res();
  await sessionHandler(req({ method: "POST", url: "/api/procore/session", cookie, body: {} }), out);
  assert.equal(out.statusCode, 200, out.body);
  const body = out.json();
  assert.equal(body.demo, true);
  assert.equal(body.me.name, "Guest");
  assert.deepEqual(body.projects.map((p) => p.projectId), ["101", "102", "103"]);
  assert.deepEqual(tokens[0].claims, { procoreUserId: "777", demo: true });
  assertClean(out.body);
  // members recorded only for the demo projects, named Guest
  const members = [...docs.keys()].filter((k) => k.includes("/members/"));
  assert.deepEqual(members.sort(), ["procoreProjects/9_101/members/777", "procoreProjects/9_102/members/777", "procoreProjects/9_103/members/777"]);
  assert.equal(docs.get("procoreUsers/777").name, "Guest");

  const pr = res();
  await projectsHandler(req({ url: "/api/procore/projects", cookie }), pr);
  assert.deepEqual(pr.json().projects.map((p) => p.name), ["Harbor Point", "Westgate", "Lakeview"]);
  const me = res();
  await meHandler(req({ url: "/api/procore/me?companyId=9", cookie }), me);
  assert.deepEqual(me.json(), { name: "Guest", email: null });
  assertClean(pr.body + me.body);
});

test("demo session: any other project id is refused with 403 before reaching Procore", async () => {
  await storeGuest();
  const cookie = await demoCookie();
  const cfg = config();
  const r = req({ url: "/api/procore/directory?companyId=9&projectId=555", cookie });
  await assert.rejects(procoreGet(r, res(), cfg, "/rest/v1.0/projects/555/users", { companyId: "9" }), (e) => e.status === 403 && e.code === "demo_project");
  await assert.rejects(procoreGet(req({ cookie }), res(), cfg, "/rest/v1.0/observations/items", { companyId: "9", query: { project_id: "556" } }), (e) => e.status === 403);
  assert.ok(!calls.some((c) => c.url.includes("555") || c.url.includes("556")));
  // an allowlisted one works
  assert.ok(await procoreGet(req({ cookie }), res(), cfg, "/rest/v1.0/projects/101/users", { companyId: "9" }));
});

test("demo session: the guest's own entry is left out of the project directory", async () => {
  await storeGuest();
  const cookie = await demoCookie();
  const { default: directory } = await import("../api/procore/directory.js");
  const out = res();
  await directory(req({ url: "/api/procore/directory?companyId=9&projectId=101", cookie }), out);
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(out.json().people.map((p) => p.name), ["Tyler Brandt"]);
  assertClean(out.body);
});

// ---------- acceptance 4: every write refused ----------

test("demo session: POSTs are refused with the view-only answer, before anything reaches Procore", async () => {
  await storeGuest();
  const cookie = await demoCookie();
  const out = res();
  await recordsHandler(req({ method: "POST", url: "/api/procore/records", cookie, body: { companyId: "9", projectId: "101" } }), out);
  assert.equal(out.statusCode, 403);
  assert.deepEqual(out.json(), { error: "demo_read_only", message: "This is a view-only demo.", demo: true });
  assert.equal(calls.length, 0);
});

test("demo session: the Procore write module refuses POST/PATCH/DELETE even if a handler tried", async () => {
  await storeGuest();
  const cookie = await demoCookie();
  const cfg = config();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = req({ cookie });
    r.demoPostOk = true; // even past the first guard
    await assert.rejects(procoreSend(r, res(), cfg, method, "/rest/v1.0/projects/101/punch_items", { companyId: "9", body: {} }), (e) => e.code === "demo_read_only");
  }
  assert.ok(!calls.some((c) => c.method !== "GET"));
});

test("demo session: sandbox tool pages are not part of the demo", async () => {
  await storeGuest();
  const cookie = await demoCookie();
  const r = req({ url: "/api/procore/test-records", cookie });
  await assert.rejects(procoreGet(r, res(), config(), "/rest/v1.0/me"), (e) => e.status === 403 && e.code === "demo_read_only");
});

// ---------- acceptance 6 + 7: single-flight refresh, new tokens saved ----------

test("refresh: many visitors at once with an expiring token cause exactly one refresh, and the new pair is saved first", async () => {
  await storeGuest({ exp: Math.floor(Date.now() / 1000) + 60 }); // inside the 5-minute window
  const cfg = config();
  const results = await Promise.all(Array.from({ length: 8 }, () => guestTokens(cfg)));
  assert.equal(refreshes, 1);
  assert.ok(results.every((t) => t.at === "guest-access-2"));
  const stored = docs.get(AUTH_DOC);
  assert.equal(stored.lock, null);
  assert.equal(stored.status, "ok");
  assert.ok(!stored.tokens.includes("guest-"), "tokens are sealed at rest");
});

test("refresh: a second server finding the lease taken keeps using the still-valid token (no second refresh)", async () => {
  await storeGuest({ exp: Math.floor(Date.now() / 1000) + 120 });
  docs.get(AUTH_DOC).lock = { owner: "other-server", until: Date.now() + 60_000 };
  const t = await guestTokens(config());
  assert.equal(t.at, "guest-access-1");
  assert.equal(refreshes, 0);
});

test("refresh: an expired token waits for the other server's new pair instead of refreshing again", async () => {
  await storeGuest({ exp: Math.floor(Date.now() / 1000) - 10 });
  docs.get(AUTH_DOC).lock = { owner: "other-server", until: Date.now() + 60_000 };
  const waiting = guestTokens(config());
  // the other server finishes
  setTimeout(() => saveGuestAuth({ tokens: { at: "guest-access-9", rt: "guest-refresh-9", exp: Math.floor(Date.now() / 1000) + 5400 }, guestUserId: 777, projects: PROJECTS }), 15);
  assert.equal((await waiting).at, "guest-access-9");
  assert.equal(refreshes, 0);
});

test("refresh: after expiry the next /demo still works and the stored pair moved on", async () => {
  await storeGuest({ exp: Math.floor(Date.now() / 1000) - 100 });
  const out = await startDemo();
  assert.equal(out.statusCode, 302);
  assert.equal(refreshes, 1);
  const again = await guestTokens(config());
  assert.equal(again.at, "guest-access-2");
  assert.equal(refreshes, 1);
});

// ---------- acceptance 8: failure page, never Procore's login ----------

test("unavailable: with nothing stored, /demo shows the friendly page (support email, no Procore login)", async () => {
  const out = await startDemo();
  assert.equal(out.statusCode, 503);
  assert.match(out.body, /The demo is temporarily unavailable/);
  assert.match(out.body, /mailto:supportprojectsai@gmail\.com/);
  assert.ok(!out.body.includes("procore.test"));
  assert.ok(!out.getHeader("set-cookie"));
  assert.ok(errors.some((e) => e.includes("[ALERT] SiteSnap demo")), "logs an alert for Ky");
});

test("unavailable: a refused refresh marks the demo failed once, alerts, and doesn't loop", async () => {
  await storeGuest({ exp: Math.floor(Date.now() / 1000) - 100 });
  refreshReply = "refuse";
  assert.equal((await startDemo()).statusCode, 503);
  assert.equal(docs.get(AUTH_DOC).status, "failed");
  assert.equal((await startDemo()).statusCode, 503);
  assert.equal(refreshes, 1, "no second refresh after it failed");
  assert.ok(errors.some((e) => e.includes("[ALERT]")));
});

test("unavailable: DEMO_ENABLED off or no key = the same page", async () => {
  await storeGuest();
  process.env.DEMO_ENABLED = "false";
  assert.equal((await startDemo()).statusCode, 503);
  process.env.DEMO_ENABLED = "true";
  process.env.DEMO_TOKEN_ENCRYPTION_KEY = "short";
  assert.equal((await startDemo()).statusCode, 503);
});

// ---------- session expiry, rate limit ----------

test("demo session: ends after 2 hours idle (asks to open the demo link again)", async () => {
  await storeGuest();
  const old = seal({ role: "demo", sid: "x", last: Date.now() - 2 * 60 * 60 * 1000 - 1000 }, ENV.SESSION_SECRET, SESSION_COOKIE);
  const out = res();
  await sessionHandler(req({ method: "POST", url: "/api/procore/session", cookie: `${SESSION_COOKIE}=${old}`, body: {} }), out);
  assert.equal(out.statusCode, 401);
  assert.equal(out.json().error, "demo_expired");
});

test("rate limit: more than 60 requests a minute from one address are turned away", async () => {
  await storeGuest();
  for (let i = 0; i < 60; i++) assert.equal((await startDemo()).statusCode, 302);
  const out = await startDemo();
  assert.equal(out.statusCode, 429);
  // another address is fine
  const other = res();
  await demoStart(req({ url: "/demo", ip: "198.51.100.7" }), other);
  assert.equal(other.statusCode, 302);
});

test("cache: the same read by many visitors reaches Procore once within the cache window", async () => {
  await storeGuest();
  const cfg = config();
  for (let i = 0; i < 5; i++) {
    const cookie = await demoCookie();
    await procoreGet(req({ cookie, ip: `198.51.100.${i}` }), res(), cfg, "/rest/v1.0/projects/101/users", { companyId: "9" });
  }
  assert.equal(calls.filter((c) => c.url.includes("/projects/101/users")).length, 1);
});

// ---------- acceptance 9 + 10: Exit demo; normal sign-ins untouched ----------

test("Exit demo: logout clears the demo cookie (allowed for a demo session)", async () => {
  await storeGuest();
  const cookie = await demoCookie();
  const out = res();
  await logoutHandler(req({ method: "POST", url: "/api/procore/logout", cookie, body: {} }), out);
  assert.equal(out.statusCode, 200);
  assert.ok([].concat(out.getHeader("set-cookie")).some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && c.includes("Max-Age=0")));
});

test("normal sign-in: unaffected (own token, own name, all projects, no demo claim)", async () => {
  await storeGuest();
  const normal = seal({ at: "ky-access", rt: "ky-refresh", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
  const out = res();
  await sessionHandler(req({ method: "POST", url: "/api/procore/session", cookie: `${SESSION_COOKIE}=${normal}`, body: {} }), out);
  assert.equal(out.statusCode, 200, out.body);
  const body = out.json();
  assert.equal(body.demo, undefined);
  assert.equal(body.me.name, GUEST.name); // (the mock answers /me the same for everyone)
  assert.equal(body.projects.length, 5);
  assert.deepEqual(tokens[0].claims, { procoreUserId: "777" });
  assert.ok(calls.every((c) => c.url.includes("/oauth/") || c.auth === "Bearer ky-access"));
});

// ---------- /admin/demo-authorize ----------

test("authorize: owner only; a non-owner and a demo visitor are refused", async () => {
  await storeGuest();
  const notOwner = seal({ at: "someone", rt: "r", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
  const out = res();
  await authorize(req({ url: "/api/procore/demo-authorize?start=1", cookie: `${SESSION_COOKIE}=${notOwner}` }), out);
  assert.equal(out.statusCode, 403); // the mock's /me is the guest, not in DEMO_ADMIN_EMAILS
  assert.ok(!out.getHeader("location"));
  const demo = res();
  await authorize(req({ url: "/api/procore/demo-authorize", cookie: await demoCookie() }), demo);
  assert.equal(demo.statusCode, 403);
  assertClean(out.body + demo.body);
});

test("authorize: the owner starts Procore's sign-in with prompt=login and a demo-authorize state", async () => {
  globalThis.fetch = async (url, init) => (new URL(url).pathname === "/rest/v1.0/me" ? json({ id: 1, login: "owner@example.com" }) : procore(url, init));
  const ky = seal({ at: "ky-access", rt: "ky-refresh", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
  const out = res();
  await authorize(req({ url: "/api/procore/demo-authorize?start=1", cookie: `${SESSION_COOKIE}=${ky}` }), out);
  assert.equal(out.statusCode, 302);
  const loc = new URL(out.getHeader("location"));
  assert.equal(loc.pathname, "/oauth/authorize");
  assert.equal(loc.searchParams.get("prompt"), "login");
  assert.equal(loc.searchParams.get("redirect_uri"), "https://sitesnap-procore.vercel.app/api/procore/callback");
  // the owner's own sign-in cookie isn't touched
  assert.ok(![].concat(out.getHeader("set-cookie") ?? []).some((c) => c.startsWith(`${SESSION_COOKIE}=`)));
});

test("authorize: stores the guest's tokens sealed with only the allowlisted projects; refuses an owner account", async () => {
  const cfg = config();
  const where = await finishDemoAuthorize(cfg, { at: "guest-access-1", rt: "guest-refresh-1", exp: Math.floor(Date.now() / 1000) + 5400 });
  assert.equal(where, "/api/procore/demo-authorize?done=1");
  const d = docs.get(AUTH_DOC);
  assert.deepEqual(d.projects.map((p) => p.name), ["Harbor Point", "Lakeview", "Westgate"]); // not SiteSnap or the Sandbox project
  assert.equal(d.guestUserId, "777");
  assert.ok(!JSON.stringify(d).includes("guest-access-1") && !JSON.stringify(d).includes(GUEST.login));

  docs.clear();
  globalThis.fetch = async (url, init) => (new URL(url).pathname === "/rest/v1.0/me" ? json({ id: 1, login: "OWNER@example.com" }) : procore(url, init));
  assert.equal(await finishDemoAuthorize(cfg, { at: "ky", rt: "ky", exp: 1e10 }), "/api/procore/demo-authorize?error=owner_account");
  assert.ok(!docs.has(AUTH_DOC));
});
