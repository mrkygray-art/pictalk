// Procore OAuth (api/procore/*): the state check, the code-for-token exchange, token refresh,
// /me, and the read-only directory, against a mocked Procore (response shapes from Procore's
// docs). Also checks the client secret and tokens never show up in responses or logs.
// No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import login from "../api/procore/login.js";
import callback from "../api/procore/callback.js";
import me from "../api/procore/me.js";
import directory from "../api/procore/directory.js";
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

let calls, replies, logs, saved;
beforeEach(() => {
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
  const out = await run(directory, req("/api/procore/directory?companyId=123&projectId=456", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 200);
  const { people } = out.json();
  assert.equal(people.length, 102);
  assert.deepEqual(people[0], { id: 1, name: "Person 1", company: "Acme Electric", role: "Superintendent" });
  assert.deepEqual(people[100], { id: 900, name: "Jane Doe", company: "Doe Plumbing", role: null });
  assert.deepEqual(people[101], { id: 901, name: "No Title", company: null, role: "Subcontractor" });
  assert.ok(!JSON.stringify(people).includes("@example.com"), "only name, company, role are returned");

  assert.deepEqual(calls.map((c) => c.url), [
    "https://sandbox.procore.test/rest/v1.0/projects/456/users?page=1&per_page=100",
    "https://sandbox.procore.test/rest/v1.0/projects/456/users?page=2&per_page=100",
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

test("directory passes on Procore's 403 as no access", async () => {
  replies.push({ status: 403, body: { error: "forbidden" } });
  const out = await run(directory, req("/api/procore/directory?companyId=123&projectId=456", { [SESSION_COOKIE]: sessionCookie(freshTokens()) }));
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().error, "no_access");
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
