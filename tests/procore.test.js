// Procore OAuth (api/procore/*): the state check, the code-for-token exchange, token refresh,
// /me, and the read-only directory, against a mocked Procore (response shapes from Procore's
// docs). Also checks the client secret and tokens never show up in responses or logs.
// No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import login from "../api/procore/login.js";
import logout from "../api/procore/logout.js";
import callback from "../api/procore/callback.js";
import me from "../api/procore/me.js";
import directory from "../api/procore/directory.js";
import projects from "../api/procore/projects.js";
import responsibility from "../api/procore/responsibility.js";
import { setTagStore } from "../api/_responsibilities.js";
import { serviceAccount } from "../api/_firestore.js";
import { config, newState, seal, unseal, REDIRECT_URI, SESSION_COOKIE, STATE_COOKIE } from "../api/_procore.js";

const SECRET = "test-client-secret-never-leak";
const ENV = {
  PROCORE_CLIENT_ID: "test-client-id",
  PROCORE_CLIENT_SECRET: SECRET,
  PROCORE_LOGIN_URL: "https://login-sandbox.procore.test/",
  PROCORE_API_URL: "https://sandbox.procore.test",
  SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
// Procore's documented token response (oauth-auth-grant-flow)
const TOKEN = { access_token: "access-1", token_type: "bearer", expires_in: 5400, refresh_token: "refresh-1", created_at: 1484786897 };

let calls, replies, logs, saved, tagDocs, tagStoreFails;
// In-memory stand-in for the Firestore tag store (procoreProjects/{c}_{p}/responsibilities/{userId})
const fakeTagStore = {
  async list(c, p) {
    if (tagStoreFails) throw Object.assign(new Error("down"), { code: "unavailable" });
    return new Map([...(tagDocs.get(`${c}_${p}`) ?? new Map())]);
  },
  async set(c, p, u, v) {
    const m = tagDocs.get(`${c}_${p}`) ?? new Map();
    m.set(u, v);
    tagDocs.set(`${c}_${p}`, m);
  },
  async remove(c, p, u) {
    tagDocs.get(`${c}_${p}`)?.delete(u);
  },
};
beforeEach(() => {
  tagDocs = new Map();
  tagStoreFails = false;
  setTagStore(fakeTagStore);
  saved = { fetch: globalThis.fetch, env: { ...process.env }, error: console.error, log: console.log, warn: console.warn };
  Object.assign(process.env, ENV);
  calls = [];
  replies = [];
  logs = [];
  // Mocked Procore: answers in order; records every request
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? String(init.body) : "" });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
  for (const k of ["error", "log", "warn"]) console[k] = (...a) => logs.push(a.map(String).join(" "));
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { error: saved.error, log: saved.log, warn: saved.warn });
});

// ---------- fake Vercel / Node req and res ----------
const req = (url, cookies = {}) => ({
  url,
  headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
});
function res() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    end(body) { this.body = body ?? ""; },
    json() { return JSON.parse(this.body); },
    cookie(name) {
      const all = [].concat(headers["set-cookie"] ?? []);
      const c = all.filter((x) => x.startsWith(`${name}=`)).pop();
      return c && { raw: c, value: c.slice(name.length + 1).split(";")[0] };
    },
  };
}
const run = async (handler, r) => { const out = res(); await handler(r, out); return out; };
const cfg = () => config();
const sessionCookie = (tokens) => seal(tokens, ENV.SESSION_SECRET, SESSION_COOKIE);
const freshTokens = (over = {}) => ({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600, ...over });

// Nothing secret in what went back to the browser or into the logs
function assertNoLeaks(out, extra = []) {
  const seen = [out.body, JSON.stringify(out.headers), ...logs].join("\n");
  for (const s of [SECRET, ENV.SESSION_SECRET, ...extra]) assert.ok(!seen.includes(s), `leaked ${s}`);
}

// ---------- login ----------

test("login redirects to Procore's /oauth/authorize with a random state saved in an httpOnly cookie", async () => {
  const out = await run(login, req("/api/procore/login?companyId=123&projectId=456"));
  assert.equal(out.statusCode, 302);
  const loc = new URL(out.getHeader("location"));
  assert.equal(loc.origin + loc.pathname, "https://login-sandbox.procore.test/oauth/authorize");
  assert.equal(loc.searchParams.get("client_id"), "test-client-id");
  assert.equal(loc.searchParams.get("response_type"), "code");
  assert.equal(loc.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(REDIRECT_URI, "https://sitesnap-procore.vercel.app/api/procore/callback");
  const state = loc.searchParams.get("state");
  assert.match(state, /^[A-Za-z0-9_-]{43}$/); // 32 random bytes

  const c = out.cookie(STATE_COOKIE);
  assert.match(c.raw, /HttpOnly/);
  assert.match(c.raw, /Secure/);
  assert.match(c.raw, /SameSite=Lax/);
  assert.match(c.raw, /Max-Age=600/);
  assert.match(c.raw, /Path=\/api\/procore/);
  assert.ok(!c.value.includes(state), "the cookie is sealed, not the plain state");
  const opened = unseal(c.value, ENV.SESSION_SECRET, STATE_COOKIE);
  assert.equal(opened.state, state);
  assert.equal(opened.companyId, "123");
  assert.equal(opened.projectId, "456");
  assert.equal(calls.length, 0);
  assertNoLeaks(out);
});

test("each login gets its own state; unfilled {{procore...}} ids aren't carried", async () => {
  const a = await run(login, req("/api/procore/login?companyId={{procore.company.id}}&projectId=%7B%7Bprocore.project.id%7D%7D"));
  const b = await run(login, req("/api/procore/login"));
  const sa = new URL(a.getHeader("location")).searchParams.get("state");
  const sb = new URL(b.getHeader("location")).searchParams.get("state");
  assert.notEqual(sa, sb);
  const opened = unseal(a.cookie(STATE_COOKIE).value, ENV.SESSION_SECRET, STATE_COOKIE);
  assert.equal(opened.companyId, null);
  assert.equal(opened.projectId, null);
});

test("without server settings, login refuses and names only the missing variables", async () => {
  delete process.env.PROCORE_CLIENT_SECRET;
  const out = await run(login, req("/api/procore/login"));
  assert.equal(out.statusCode, 500);
  assert.equal(out.json().error, "not_configured");
  assert.match(out.json().message, /PROCORE_CLIENT_SECRET/);
  assert.equal(out.getHeader("location"), undefined);
});

// ---------- callback: state check ----------

const startedState = (context = { companyId: "123", projectId: "456" }, now) => newState(cfg(), context, now);

test("callback refuses when the state cookie is missing, wrong, expired, or not ours; Procore is never called", async () => {
  const good = startedState();
  const cases = {
    "no cookie": req(`/api/procore/callback?code=abc&state=${good.state}`),
    "wrong state": req(`/api/procore/callback?code=abc&state=${"x".repeat(43)}`, { [STATE_COOKIE]: good.cookie }),
    "no state": req("/api/procore/callback?code=abc", { [STATE_COOKIE]: good.cookie }),
    "expired": (() => {
      const old = startedState(undefined, Date.now() - 11 * 60 * 1000);
      return req(`/api/procore/callback?code=abc&state=${old.state}`, { [STATE_COOKIE]: old.cookie });
    })(),
    "other secret": req(`/api/procore/callback?code=abc&state=${good.state}`, {
      [STATE_COOKIE]: seal({ state: good.state, exp: Date.now() + 60000 }, "some-other-secret", STATE_COOKIE),
    }),
    "session cookie passed off as state": req(`/api/procore/callback?code=abc&state=${good.state}`, {
      [STATE_COOKIE]: seal({ state: good.state, exp: Date.now() + 60000 }, ENV.SESSION_SECRET, SESSION_COOKIE),
    }),
    "tampered cookie": req(`/api/procore/callback?code=abc&state=${good.state}`, {
      [STATE_COOKIE]: good.cookie.slice(0, -2) + (good.cookie.endsWith("A") ? "BB" : "AA"),
    }),
  };
  for (const [name, r] of Object.entries(cases)) {
    const out = await run(callback, r);
    assert.equal(out.statusCode, 400, name);
    assert.equal(out.json().error, "bad_state", name);
    assert.match(out.cookie(STATE_COOKIE).raw, /Max-Age=0/, `${name}: state cookie cleared`);
    assert.equal(out.cookie(SESSION_COOKIE), undefined, `${name}: no session`);
  }
  assert.equal(calls.length, 0, "no token exchange without a valid state");
});

test("callback with a valid state but Procore's error (user said no) goes back to the app, no exchange", async () => {
  const s = startedState();
  const out = await run(callback, req(`/api/procore/callback?error=access_denied&state=${s.state}`, { [STATE_COOKIE]: s.cookie }));
  assert.equal(out.statusCode, 302);
  assert.equal(out.getHeader("location"), "/?companyId=123&projectId=456&procore=denied");
  assert.equal(calls.length, 0);
});

// ---------- callback: token exchange ----------

test("callback trades the code at /oauth/token, keeps the tokens in an encrypted httpOnly cookie, returns to the same project", async () => {
  const s = startedState();
  replies.push({ body: TOKEN });
  const out = await run(callback, req(`/api/procore/callback?code=the-code&state=${s.state}`, { [STATE_COOKIE]: s.cookie }));

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, "https://login-sandbox.procore.test/oauth/token");
  assert.equal(call.method, "POST");
  assert.equal(call.headers["Content-Type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(call.body);
  assert.deepEqual(Object.fromEntries(body), {
    client_id: "test-client-id",
    client_secret: SECRET, // sent to Procore only
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
    code: "the-code",
  });

  assert.equal(out.statusCode, 302);
  assert.equal(out.getHeader("location"), "/?companyId=123&projectId=456&procore=connected");
  assert.match(out.cookie(STATE_COOKIE).raw, /Max-Age=0/);
  const session = out.cookie(SESSION_COOKIE);
  assert.match(session.raw, /HttpOnly/);
  assert.match(session.raw, /Secure/);
  assert.match(session.raw, /SameSite=Lax/);
  assert.deepEqual(unseal(session.value, ENV.SESSION_SECRET, SESSION_COOKIE), {
    at: "access-1", rt: "refresh-1", exp: TOKEN.created_at + 5400,
  });
  assertNoLeaks(out, ["access-1", "refresh-1"]);
});

test("a failed token exchange goes back to the app with procore=error and no session", async () => {
  const s = startedState({ companyId: "9", projectId: null });
  replies.push({ status: 400, body: { error: "invalid_grant", error_description: "The provided authorization grant is invalid" } });
  const out = await run(callback, req(`/api/procore/callback?code=old-code&state=${s.state}`, { [STATE_COOKIE]: s.cookie }));
  assert.equal(out.statusCode, 302);
  assert.equal(out.getHeader("location"), "/?companyId=9&procore=error");
  assert.equal(out.cookie(SESSION_COOKIE), undefined);
  assertNoLeaks(out, ["old-code"]);
});

test("callback with a valid state but no code is refused", async () => {
  const s = startedState();
  const out = await run(callback, req(`/api/procore/callback?state=${s.state}`, { [STATE_COOKIE]: s.cookie }));
  assert.equal(out.statusCode, 400);
  assert.equal(out.json().error, "no_code");
  assert.equal(calls.length, 0);
});

// ---------- /me and token refresh ----------

test("/me returns the user's name and email (company_id + Procore-Company-Id so Procore includes the name)", async () => {
  replies.push({ body: { id: 160586, login: "carl.contractor@example.com", name: "Carl Contractor" } });
  const out = await run(me, req("/api/procore/me?companyId=123", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json(), { name: "Carl Contractor", email: "carl.contractor@example.com" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sandbox.procore.test/rest/v1.0/me?company_id=123");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.Authorization, "Bearer access-1");
  assert.equal(calls[0].headers["Procore-Company-Id"], "123");
  assert.equal(out.cookie(SESSION_COOKIE), undefined, "no refresh needed");
  assertNoLeaks(out, ["access-1", "refresh-1"]);
});

test("/me without a Procore session is 401 and calls nothing", async () => {
  const out = await run(me, req("/api/procore/me"));
  assert.equal(out.statusCode, 401);
  assert.equal(out.json().error, "not_connected");
  assert.equal(calls.length, 0);
});

test("an expired access token is refreshed first; the new refresh token is saved", async () => {
  replies.push({ body: { ...TOKEN, access_token: "access-2", refresh_token: "refresh-2", created_at: Math.floor(Date.now() / 1000) } });
  replies.push({ body: { id: 1, login: "a@example.com", name: "A" } });
  const expired = freshTokens({ exp: Math.floor(Date.now() / 1000) - 10 });
  const out = await run(me, req("/api/procore/me", { [SESSION_COOKIE]: sessionCookie(expired) }));
  assert.equal(out.statusCode, 200);
  assert.equal(calls[0].url, "https://login-sandbox.procore.test/oauth/token");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), {
    client_id: "test-client-id", client_secret: SECRET, redirect_uri: REDIRECT_URI, grant_type: "refresh_token", refresh_token: "refresh-1",
  });
  assert.equal(calls[1].headers.Authorization, "Bearer access-2");
  assert.equal(calls[1].headers["Procore-Company-Id"], undefined, "no company given, no header");
  const now = unseal(out.cookie(SESSION_COOKIE).value, ENV.SESSION_SECRET, SESSION_COOKIE);
  assert.equal(now.at, "access-2");
  assert.equal(now.rt, "refresh-2");
  assertNoLeaks(out, ["access-1", "access-2", "refresh-1", "refresh-2"]);
});

test("a token Procore rejects (401) is refreshed once and the call retried", async () => {
  replies.push({ status: 401, body: { error: "Invalid Token" } });
  replies.push({ body: { ...TOKEN, access_token: "access-2", refresh_token: "refresh-2" } });
  replies.push({ body: { id: 1, login: "a@example.com", name: "A" } });
  const out = await run(me, req("/api/procore/me", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(calls.map((c) => c.method), ["GET", "POST", "GET"]);
  assert.equal(calls[2].headers.Authorization, "Bearer access-2");
});

test("when the refresh token is refused, the session is cleared and the app is told to connect again", async () => {
  replies.push({ status: 401, body: { error: "invalid_grant" } });
  const expired = freshTokens({ exp: 0 });
  const out = await run(me, req("/api/procore/me", { [SESSION_COOKIE]: sessionCookie(expired) }));
  assert.equal(out.statusCode, 401);
  assert.equal(out.json().error, "not_connected");
  assert.match(out.cookie(SESSION_COOKIE).raw, /Max-Age=0/);
  assertNoLeaks(out, ["refresh-1"]);
});

// ---------- directory (read-only) ----------

// One user per Procore view (List Project Users: Normal View and Compact View)
const normalUser = (i) => ({
  id: i, name: `Person ${i}`, first_name: "Person", last_name: String(i), email_address: `p${i}@example.com`, job_title: "Superintendent",
  vendor: { id: 5, name: "Acme Electric", is_connected: false }, permission_template: { id: 2, name: "Project Manager", project_specific: false, type: "project" },
});

test("directory lists the project's people (name, company, role) with the Procore-Company-Id header, page by page", async () => {
  replies.push({ body: Array.from({ length: 100 }, (_, i) => normalUser(i + 1)) });
  replies.push({ body: [
    { id: 900, first_name: "Jane", last_name: "Doe", name: "Jane Doe", initials: "JD", vendor: { id: 6, name: "Doe Plumbing" } }, // compact view
    { id: 901, name: "No Title", vendor: null, job_title: "", permission_template: { id: 3, name: "Subcontractor" } },
  ] });
  replies.push({ body: [] }); // project roles: none
  replies.push({ body: { id: 7, login: "pm@example.com", name: "Pat PM" } }); // me
  const out = await run(directory, req("/api/procore/directory?companyId=123&projectId=456", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  const { people, canTag, labels, rolesAvailable, tagsAvailable } = out.json();
  assert.equal(people.length, 102);
  assert.deepEqual(people[0], { id: 1, name: "Person 1", firstName: "Person", lastName: "1", title: "Superintendent", company: "Acme Electric", role: "Superintendent", roleSource: "job_title", tag: null });
  assert.deepEqual(people[100], { id: 900, name: "Jane Doe", firstName: "Jane", lastName: "Doe", title: null, company: "Doe Plumbing", role: null, roleSource: null, tag: null });
  assert.deepEqual(people[101], { id: 901, name: "No Title", firstName: null, lastName: null, title: null, company: null, role: "Subcontractor", roleSource: "permission_template", tag: null });
  assert.equal(out.json().compact, false, "a mix of normal and compact rows is the normal view");
  assert.ok(!JSON.stringify(out.json()).includes("@example.com"), "no emails go back to the browser");
  assert.equal(canTag, false, "nobody is a PM in the project roles");
  assert.deepEqual(labels, ["PM", "Superintendent", "Purchasing", "Sub foreman"]);
  assert.equal(rolesAvailable, true);
  assert.equal(tagsAvailable, true);

  assert.deepEqual(calls.map((c) => c.url), [
    "https://sandbox.procore.test/rest/v1.0/projects/456/users?page=1&per_page=100",
    "https://sandbox.procore.test/rest/v1.0/projects/456/users?page=2&per_page=100",
    "https://sandbox.procore.test/rest/v1.0/project_roles?project_id=456&page=1&per_page=100",
    "https://sandbox.procore.test/rest/v1.0/me?company_id=123",
  ]);
  for (const c of calls) {
    assert.equal(c.method, "GET", "read-only");
    assert.equal(c.headers["Procore-Company-Id"], "123");
    assert.equal(c.headers.Authorization, "Bearer access-1");
  }
});

test("directory needs real company and project ids; placeholders are refused before calling Procore", async () => {
  for (const q of ["?companyId=123", "?projectId=456", "?companyId={{procore.company.id}}&projectId=456", "?companyId=123&projectId=../me"]) {
    const out = await run(directory, req(`/api/procore/directory${q}`, { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
    assert.equal(out.statusCode, 400, q);
    assert.equal(out.json().error, "missing_ids", q);
  }
  assert.equal(calls.length, 0);
});

test("directory turns Procore's 403 into a plain no-directory-access message", async () => {
  replies.push({ status: 403, body: { error: "forbidden" } });
  const out = await run(directory, req("/api/procore/directory?companyId=123&projectId=456", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().error, "no_directory");
  assert.equal(out.json().message, "You don't have access to this project's directory in Procore.");
});

test("directory says when Procore gave only the compact view (no Directory read permission)", async () => {
  replies.push({ body: [
    { id: 1, first_name: "Jane", last_name: "Doe", name: "Jane Doe", initials: "JD", vendor: { id: 6, name: "Doe Plumbing" } },
    { id: 2, first_name: "Al", last_name: "Ray", name: "Al Ray", initials: "AR", vendor: null },
  ] });
  replies.push({ body: [] }); // project roles
  replies.push({ body: { id: 7, login: "x@example.com", name: "X" } }); // me
  const out = await run(directory, req("/api/procore/directory?companyId=123&projectId=456", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  assert.equal(out.json().compact, true);
  assert.equal(out.json().people[0].title, null);
});

// ---------- projects (the project picker) ----------

test("projects lists the user's projects across their companies, one call after another, read-only", async () => {
  replies.push({ body: [{ id: 123, name: "Kyco Builders", is_active: true }, { id: 124, name: "Old Co", is_active: false }, { id: 125, name: "Sub Co", is_active: true }] });
  replies.push({ body: [{ id: 456, name: "Tower B" }, { id: 457, name: "Annex" }] });
  replies.push({ body: [{ id: 900, name: "Clinic" }] });
  const out = await run(projects, req("/api/procore/projects", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json().projects, [
    { companyId: "123", companyName: "Kyco Builders", projectId: "457", name: "Annex" },
    { companyId: "125", companyName: "Sub Co", projectId: "900", name: "Clinic" },
    { companyId: "123", companyName: "Kyco Builders", projectId: "456", name: "Tower B" },
  ]);
  assert.deepEqual(calls.map((c) => c.url), [
    "https://sandbox.procore.test/rest/v1.0/companies?page=1&per_page=100",
    "https://sandbox.procore.test/rest/v1.1/projects?company_id=123&view=compact&page=1&per_page=100",
    "https://sandbox.procore.test/rest/v1.1/projects?company_id=125&view=compact&page=1&per_page=100",
  ], "inactive companies are skipped");
  assert.equal(calls[0].headers["Procore-Company-Id"], undefined, "List Companies doesn't take the company header");
  assert.equal(calls[1].headers["Procore-Company-Id"], "123");
  assert.equal(calls[2].headers["Procore-Company-Id"], "125");
  for (const c of calls) assert.equal(c.method, "GET");
  assertNoLeaks(out, ["access-1", "refresh-1"]);
});

test("projects pages through big lists; a company that refuses (403) doesn't hide the rest", async () => {
  replies.push({ body: [{ id: 1, name: "A", is_active: true }, { id: 2, name: "B", is_active: true }] });
  replies.push({ body: Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, name: `P${String(i).padStart(3, "0")}` })) });
  replies.push({ body: [{ id: 2000, name: "Last" }] });
  replies.push({ status: 403, body: { error: "app not connected" } });
  const out = await run(projects, req("/api/procore/projects", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  assert.equal(out.json().projects.length, 101);
  assert.equal(out.json().refused, 1);
  assert.ok(calls[2].url.includes("company_id=1&view=compact&page=2&per_page=100"));
});

test("projects with no companies or no projects is an empty list, not an error", async () => {
  replies.push({ body: [] });
  const out = await run(projects, req("/api/procore/projects", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json().projects, []);
});

test("projects without a Procore session is 401 and calls nothing", async () => {
  const out = await run(projects, req("/api/procore/projects"));
  assert.equal(out.statusCode, 401);
  assert.equal(out.json().error, "not_connected");
  assert.equal(calls.length, 0);
});

// ---------- callback: a code after '#' (read by the page, posted back) ----------

const postReq = (body, cookies = {}, headers = {}) => ({
  method: "POST",
  url: "/api/procore/callback",
  headers: {
    host: "sitesnap-procore.vercel.app",
    origin: "https://sitesnap-procore.vercel.app",
    "content-type": "application/json",
    cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
    ...headers,
  },
  body,
});

test("callback with nothing in the query serves the '#' reader page and leaves the state cookie alone", async () => {
  const out = await run(callback, { method: "GET", url: "/api/procore/callback", headers: {} });
  assert.equal(out.statusCode, 200);
  assert.match(out.getHeader("content-type"), /text\/html/);
  assert.equal(out.getHeader("referrer-policy"), "no-referrer");
  const csp = out.getHeader("content-security-policy");
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(out.body.includes(`<script nonce="${nonce}">`));
  assert.ok(out.body.includes("history.replaceState"), "takes the code out of the address bar");
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(out.body), "stores nothing in the browser");
  assert.equal(out.getHeader("set-cookie"), undefined, "state cookie kept for the POST");
  assert.equal(calls.length, 0);
});

test("a code posted from the '#' page goes through the same state check and token exchange", async () => {
  const s = startedState();
  replies.push({ body: TOKEN });
  const out = await run(callback, postReq({ code: "hash-code", state: s.state }, { [STATE_COOKIE]: s.cookie }));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json(), { location: "/?companyId=123&projectId=456&procore=connected" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://login-sandbox.procore.test/oauth/token");
  assert.equal(new URLSearchParams(calls[0].body).get("code"), "hash-code");
  assert.equal(new URLSearchParams(calls[0].body).get("grant_type"), "authorization_code");
  assert.match(out.cookie(STATE_COOKIE).raw, /Max-Age=0/);
  assert.equal(unseal(out.cookie(SESSION_COOKIE).value, ENV.SESSION_SECRET, SESSION_COOKIE).at, "access-1");
  assert.ok(!out.body.includes("access-1"), "the token never goes back to the page");
  assert.ok(logs.some((l) => l.includes("after '#'")), "logs which way the code came");
  assertNoLeaks(out, ["access-1", "refresh-1", "hash-code"]);
});

test("the '#' POST also reads a raw JSON body (plain Node request, not pre-parsed)", async () => {
  const s = startedState();
  replies.push({ body: TOKEN });
  const r = postReq(undefined, { [STATE_COOKIE]: s.cookie });
  r[Symbol.asyncIterator] = async function* () { yield JSON.stringify({ code: "c", state: s.state }); };
  const out = await run(callback, r);
  assert.equal(out.statusCode, 200);
  assert.equal(out.json().location, "/?companyId=123&projectId=456&procore=connected");
});

test("the '#' POST refuses a wrong state, no cookie, another site, or a non-JSON form; Procore is never called", async () => {
  const s = startedState();
  const cases = {
    "wrong state": [postReq({ code: "c", state: "y".repeat(43) }, { [STATE_COOKIE]: s.cookie }), 400, "bad_state"],
    "no cookie": [postReq({ code: "c", state: s.state }), 400, "bad_state"],
    "other site": [postReq({ code: "c", state: s.state }, { [STATE_COOKIE]: s.cookie }, { origin: "https://evil.example" }), 403, "bad_origin"],
    "form post": [postReq("code=c", { [STATE_COOKIE]: s.cookie }, { "content-type": "application/x-www-form-urlencoded" }), 415, "bad_request"],
    "not json": [postReq("{nope", { [STATE_COOKIE]: s.cookie }), 400, "bad_request"],
  };
  for (const [name, [r, status, error]] of Object.entries(cases)) {
    const out = await run(callback, r);
    assert.equal(out.statusCode, status, name);
    assert.equal(out.json().error, error, name);
    assert.equal(out.cookie(SESSION_COOKIE), undefined, name);
  }
  assert.equal(calls.length, 0);
});

test("the '#' POST with Procore's error goes back to the app as denied", async () => {
  const s = startedState();
  const out = await run(callback, postReq({ error: "access_denied", state: s.state }, { [STATE_COOKIE]: s.cookie }));
  assert.equal(out.json().location, "/?companyId=123&projectId=456&procore=denied");
  assert.equal(calls.length, 0);
});

// ---------- tokens never reach browser storage or the build ----------

test("no Procore token or secret in localStorage / sessionStorage or a VITE_ variable", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx|html)$/.test(name)) files.push(p);
    }
  };
  walk(join(root, "src"));
  walk(join(root, "api"));
  assert.ok(files.some((f) => f.endsWith("ProcorePanel.jsx")) && files.some((f) => f.endsWith("_procore.js")), "scanned the Procore files");
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.ok(!/VITE_[A-Z0-9_]*(PROCORE|SESSION|SECRET|TOKEN)/.test(text), `${f}: secret-looking VITE_ variable`);
    if (/procore/i.test(f) || f.includes(`${join("api", "")}`)) {
      assert.ok(!/localStorage|sessionStorage|indexedDB|idb-keyval/.test(text), `${f}: browser storage near Procore code`);
    }
  }
  for (const f of readdirSync(root).filter((n) => n.startsWith(".env"))) {
    assert.ok(!/^\s*VITE_[A-Z0-9_]*(PROCORE|SESSION|SECRET|TOKEN)/m.test(readFileSync(join(root, f), "utf8")), `${f}: secret in a VITE_ variable`);
  }
});

// ---------- directory ?shape=1 (diagnostic: field names and counts, never values) ----------

test("directory ?shape=1 lists field names and how many are filled, with no values", async () => {
  replies.push({ body: [
    { ...normalUser(1), mobile_phone: "555-0100", business_phone: "", job_title: "Superintendent" },
    { id: 2, name: "No Title", first_name: "No", last_name: "Title", email_address: "nt@example.com", job_title: null, vendor: null, permission_template: { id: 3, name: "Subcontractor" } },
  ] });
  const out = await run(directory, req("/api/procore/directory?companyId=123&projectId=456&shape=1", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  const shape = out.json();
  assert.equal(shape.users, 2);
  const f = Object.fromEntries(shape.fields.map((x) => [x.path, x.filled]));
  assert.equal(f.job_title, 1);
  assert.equal(f.vendor, 1);
  assert.equal(f["vendor.name"], 1);
  assert.equal(f["permission_template.name"], 2);
  assert.equal(f.business_phone, 0, "empty strings don't count");
  assert.equal(f.mobile_phone, 1);
  for (const leak of ["555-0100", "@example.com", "Superintendent", "Acme Electric", "Subcontractor", "No Title"]) {
    assert.ok(!out.body.includes(leak), `no values: ${leak}`);
  }
  assert.equal(calls.length, 1, "first page only");
  assert.equal(calls[0].url, "https://sandbox.procore.test/rest/v1.0/projects/456/users?page=1&per_page=100");
  assert.equal(calls[0].method, "GET");
});

test("directory ?shape=1 still needs a Procore session and real ids", async () => {
  const noSession = await run(directory, req("/api/procore/directory?companyId=123&projectId=456&shape=1"));
  assert.equal(noSession.statusCode, 401);
  const noIds = await run(directory, req("/api/procore/directory?shape=1", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(noIds.statusCode, 400);
  assert.equal(calls.length, 0);
});

// ---------- responsibilities: Project Roles first, then title, template, PM tag ----------

const dirReq = () => req("/api/procore/directory?companyId=123&projectId=456", { [SESSION_COOKIE]: sessionCookie(freshTokens()) });
const sandboxUsers = () => [
  { id: 7, name: "Pat PM", job_title: null, vendor: { id: 1, name: "GC Inc" } },
  { id: 8, name: "Sam Super", job_title: "Field Lead", vendor: null },
  { id: 9, name: "Lee Buyer", job_title: null, vendor: null, permission_template: null },
  { id: 10, name: "Nobody Set", job_title: null, vendor: null },
];

test("Project Roles win over job title; several roles join; inactive roles and roles without a user are skipped", async () => {
  replies.push({ body: sandboxUsers() });
  replies.push({ body: [
    { id: 1, name: "Pat PM", role: "Project Manager", user_id: 7, is_active: true },
    { id: 2, name: "Sam Super", role: "Superintendent", user_id: 8, is_active: true },
    { id: 3, name: "Sam Super", role: "Safety Lead", user_id: 8 },
    { id: 4, name: "Old Super", role: "Superintendent", user_id: 10, is_active: false },
    { id: 5, name: "A Contact", role: "Architect", user_id: null, contact_id: 55 },
  ] });
  replies.push({ body: { id: 7, login: "pat@example.com", name: "Pat PM" } });
  tagDocs.set("123_456", new Map([["9", { label: "Purchasing" }], ["8", { label: "Sub foreman" }]]));
  const out = await run(directory, dirReq());
  const byId = Object.fromEntries(out.json().people.map((p) => [p.id, p]));
  assert.deepEqual([byId[7].role, byId[7].roleSource], ["Project Manager", "project_team"]);
  assert.deepEqual([byId[8].role, byId[8].roleSource, byId[8].tag], ["Superintendent, Safety Lead", "project_team", "Sub foreman"], "a Procore role beats a tag");
  assert.deepEqual([byId[9].role, byId[9].roleSource], ["Purchasing", "tag"], "the tag fills in when Procore has nothing");
  assert.deepEqual([byId[10].role, byId[10].roleSource], [null, null], "an inactive role doesn't count");
  assert.equal(out.json().canTag, true, "the signed-in user is the Project Manager");
});

test("a Project Executive can tag; other roles can't", async () => {
  for (const [role, expected] of [["Project Executive", true], ["Superintendent", false], ["Foreman", false]]) {
    replies.push({ body: sandboxUsers() });
    replies.push({ body: [{ id: 1, role, user_id: 7 }] });
    replies.push({ body: { id: 7, name: "Pat" } });
    const out = await run(directory, dirReq());
    assert.equal(out.json().canTag, expected, role);
  }
});

test("without permission to read Project Roles (403) the list still loads, with no roles and no tagging", async () => {
  replies.push({ body: sandboxUsers() });
  replies.push({ status: 403, body: { errors: "User does not have the required permissions" } });
  replies.push({ body: { id: 7, name: "Pat" } });
  const out = await run(directory, dirReq());
  assert.equal(out.statusCode, 200);
  assert.equal(out.json().rolesAvailable, false);
  assert.equal(out.json().canTag, false);
  assert.equal(out.json().people.find((p) => p.id === 8).roleSource, "job_title");
});

test("if SiteSnap's tag store is down the list still loads, without tags or tagging", async () => {
  tagStoreFails = true;
  replies.push({ body: sandboxUsers() });
  replies.push({ body: [{ id: 1, role: "Project Manager", user_id: 7 }] });
  replies.push({ body: { id: 7, name: "Pat" } });
  const out = await run(directory, dirReq());
  assert.equal(out.statusCode, 200);
  assert.equal(out.json().tagsAvailable, false);
  assert.equal(out.json().canTag, false);
  assert.ok(logs.some((l) => l.includes("Responsibility tags unavailable")));
});

// POST /api/procore/responsibility
const tagReq = (body, headers = {}) => ({
  method: "POST",
  url: "/api/procore/responsibility",
  headers: {
    host: "sitesnap-procore.vercel.app",
    origin: "https://sitesnap-procore.vercel.app",
    "content-type": "application/json",
    cookie: `${SESSION_COOKIE}=${sessionCookie(freshTokens())}`,
    ...headers,
  },
  body,
});
const asPM = () => {
  replies.push({ body: { id: 7, login: "pat@example.com", name: "Pat PM" } }); // me
  replies.push({ body: [{ id: 1, role: "Project Manager", user_id: 7 }] }); // project roles
};

test("a project's PM tags a person: checked against Procore, saved server-side with who set it", async () => {
  asPM();
  replies.push({ body: { id: 9, name: "Lee Buyer" } }); // the person is on the project
  const out = await run(responsibility, tagReq({ companyId: "123", projectId: "456", userId: 9, label: "Purchasing" }));
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.json(), { userId: 9, tag: "Purchasing" });
  const saved = tagDocs.get("123_456").get("9");
  assert.equal(saved.label, "Purchasing");
  assert.equal(saved.setByProcoreUserId, "7");
  assert.equal(saved.setByName, "Pat PM");
  assert.equal(typeof saved.setAt, "number");
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ["GET", "https://sandbox.procore.test/rest/v1.0/me?company_id=123"],
    ["GET", "https://sandbox.procore.test/rest/v1.0/project_roles?project_id=456&page=1&per_page=100"],
    ["GET", "https://sandbox.procore.test/rest/v1.0/projects/456/users/9"],
  ], "read-only on Procore");
  assert.ok(calls.every((c) => c.headers["Procore-Company-Id"] === "123"));
});

test("label null removes the tag", async () => {
  tagDocs.set("123_456", new Map([["9", { label: "PM" }]]));
  asPM();
  replies.push({ body: { id: 9 } });
  const out = await run(responsibility, tagReq({ companyId: "123", projectId: "456", userId: "9", label: null }));
  assert.equal(out.statusCode, 200);
  assert.equal(tagDocs.get("123_456").has("9"), false);
});

test("someone who isn't the project's PM can't tag (403 not_pm), and nothing is saved", async () => {
  replies.push({ body: { id: 8, name: "Sam Super" } });
  replies.push({ body: [{ id: 2, role: "Superintendent", user_id: 8 }] });
  const out = await run(responsibility, tagReq({ companyId: "123", projectId: "456", userId: 9, label: "PM" }));
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().error, "not_pm");
  assert.equal(tagDocs.size, 0);
});

test("tagging someone Procore says isn't on the project is refused, nothing saved", async () => {
  asPM();
  replies.push({ status: 403, body: { errors: "forbidden" } });
  const out = await run(responsibility, tagReq({ companyId: "123", projectId: "456", userId: 999, label: "PM" }));
  assert.equal(out.statusCode, 403);
  assert.equal(tagDocs.size, 0);
});

test("tagging refuses bad input before calling Procore: wrong label, missing or non-numeric ids, GET, form posts, another site, no session", async () => {
  const cases = [
    [tagReq({ companyId: "123", projectId: "456", userId: 9, label: "Boss" }), 400, "bad_label"],
    [tagReq({ companyId: "123", projectId: "456", label: "PM" }), 400, "missing_ids"],
    [tagReq({ companyId: "{{procore.company.id}}", projectId: "456", userId: 9, label: "PM" }), 400, "missing_ids"],
    [{ ...tagReq({}), method: "GET" }, 405, "bad_method"],
    [tagReq("userId=9", { "content-type": "application/x-www-form-urlencoded" }), 415, "bad_request"],
    [tagReq({ companyId: "123", projectId: "456", userId: 9, label: "PM" }, { origin: "https://evil.example" }), 403, "bad_origin"],
  ];
  for (const [r, status, error] of cases) {
    const out = await run(responsibility, r);
    assert.equal(out.statusCode, status, error);
    assert.equal(out.json().error, error);
  }
  const noSession = await run(responsibility, tagReq({ companyId: "123", projectId: "456", userId: 9, label: "PM" }, { cookie: "" }));
  assert.equal(noSession.statusCode, 401);
  assert.equal(calls.length, 0);
  assert.equal(tagDocs.size, 0);
});

// ---------- Firestore credentials (FIREBASE_SERVICE_ACCOUNT_B64) ----------

test("the Firestore key must be base64 JSON for sitesnap-procore; errors never echo the key", () => {
  const fakeKey = {
    type: "service_account",
    project_id: "sitesnap-procore",
    client_email: "x@sitesnap-procore.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  assert.equal(serviceAccount({ FIREBASE_SERVICE_ACCOUNT_B64: b64(fakeKey) }).client_email, fakeKey.client_email);
  assert.equal(serviceAccount({ FIREBASE_SERVICE_ACCOUNT_B64: ` ${b64(fakeKey)}\n` }).project_id, "sitesnap-procore", "stray spaces / newline tolerated");
  const bad = {
    missing: {},
    "not base64 json": { FIREBASE_SERVICE_ACCOUNT_B64: "not-a-key" },
    "raw json pasted": { FIREBASE_SERVICE_ACCOUNT_B64: JSON.stringify(fakeKey) },
    "not a service account": { FIREBASE_SERVICE_ACCOUNT_B64: b64({ ...fakeKey, type: "authorized_user" }) },
    "PicTalk's key": { FIREBASE_SERVICE_ACCOUNT_B64: b64({ ...fakeKey, project_id: "pictalk-6cbff" }) },
  };
  for (const [name, env] of Object.entries(bad)) {
    assert.throws(() => serviceAccount(env), (err) => {
      assert.equal(err.code, "not_configured", name);
      assert.ok(!err.message.includes("PRIVATE KEY") && !err.message.includes("FAKE"), `${name}: no key in the message`);
      return true;
    });
  }
});

// ---------- signing out, and signing in as someone else ----------

test("Sign out clears SiteSnap's Procore session (so a reload doesn't sign straight back in); other sites can't", async () => {
  const signedIn = { [SESSION_COOKIE]: sessionCookie(freshTokens()) };
  const post = (origin) => ({ ...req("/api/procore/logout", signedIn), method: "POST", body: {}, headers: { ...req("/api/procore/logout", signedIn).headers, host: "sitesnap-procore.vercel.app", origin, "content-type": "application/json" } });
  const out = await run(logout, post("https://sitesnap-procore.vercel.app"));
  assert.equal(out.statusCode, 200, out.body);
  assert.match(out.cookie(SESSION_COOKIE).raw, /Max-Age=0/);
  const evil = await run(logout, post("https://evil.example"));
  assert.equal(evil.statusCode, 403);
  const put = await run(logout, { ...req("/api/procore/logout", signedIn), method: "PUT" });
  assert.equal(put.statusCode, 405);
});

test("GET logout only sends the browser to Procore's own sign-out page; SiteSnap's session isn't touched", async () => {
  const out = await run(logout, { ...req("/api/procore/logout", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }), method: "GET" });
  assert.equal(out.statusCode, 302);
  assert.equal(out.getHeader("location"), "https://login-sandbox.procore.test/logout");
  assert.equal(out.cookie(SESSION_COOKIE), undefined, "a link from another site can't sign you out of SiteSnap");
});

test("'Use a different Procore account' asks Procore for its login screen; a plain sign-in doesn't", async () => {
  const fresh = new URL((await run(login, req("/api/procore/login?companyId=123&projectId=456&fresh=1"))).getHeader("location"));
  assert.equal(fresh.searchParams.get("prompt"), "login");
  const plain = new URL((await run(login, req("/api/procore/login?companyId=123&projectId=456"))).getHeader("location"));
  assert.equal(plain.searchParams.get("prompt"), null);
});

