// Guest demo (docs/guest-demo.md): a visitor opens /demo and lands in SiteSnap signed in as Ky's view-only Procore
// guest, with no Procore login. Everything here is server side:
//   - The guest's Procore tokens are stored once by Ky (/admin/demo-authorize) in server-only Firestore
//     sitesnapDemo/guestAuth, sealed with AES-256-GCM under DEMO_TOKEN_ENCRYPTION_KEY. They never reach a browser,
//     a log line or a URL.
//   - A demo visitor's pc_session cookie holds only { role: "demo", sid, last }; session() in _procore.js calls
//     demoTokens() here, which hands back the stored guest token for that one request.
//   - Procore refresh tokens rotate (the old one dies), so the token is refreshed in one place, single flight: one
//     refresh per server at a time (inflight), and across servers a 60-second lease in the same Firestore document.
//     The new pair is saved before it is used. Refreshes happen 5 minutes early, so while one server refreshes the
//     others keep using the still-valid access token.
//   - A refresh Procore refuses marks the demo unavailable (status "failed") and logs an [ALERT] line; /demo then
//     shows the friendly unavailable page until Ky authorizes again. Nothing loops.
// Settings (Vercel env): DEMO_ENABLED=true, DEMO_PROJECT_IDS (the allowlist, "HP:373715,WG:…" or plain ids),
// DEMO_TOKEN_ENCRYPTION_KEY (32+ characters), DEMO_ADMIN_EMAILS (who may use /admin/demo-authorize).
import { createHash, randomBytes } from "node:crypto";
import { clearCookie, demoReadOnly, HttpError, refreshTokens, seal, SESSION_COOKIE, setCookie, unseal } from "./_procore.js";
import { firestore } from "./_firestore.js";

export const AUTH_DOC = "sitesnapDemo/guestAuth";
const TOKEN_PURPOSE = "sitesnap-demo-guest-tokens-v1";
export const DEMO_IDLE_SECONDS = 2 * 60 * 60; // a demo session ends after 2 hours without a request
const TOUCH_SECONDS = 5 * 60; // the cookie's "last seen" is rewritten at most every 5 minutes
const REFRESH_EARLY_SECONDS = 5 * 60;
const LOCK_MS = 60_000; // longer than a token request can take (20 s timeout in _procore.js)
const MEMO_MS = 20_000; // a warm server re-reads the stored tokens at most this often
export const demoTiming = { waitMs: 500, waitTries: 20 }; // waiting for another server's refresh; tests shorten it
export const RATE_PER_MINUTE = 60;

// Sandbox tool pages (they write to Procore or need an admin) are never part of the demo
const BLOCKED = /^\/api\/procore\/(test-|demo-staging|seed-directory|daily-log-examples|responsibility|demo-authorize)/;

// ---------- settings ----------

export function demoSettings(env = process.env) {
  const ids = String(env.DEMO_PROJECT_IDS ?? "").split(",").map((s) => s.trim().split(":").pop().trim()).filter((id) => /^\d{1,20}$/.test(id));
  return {
    enabled: env.DEMO_ENABLED === "true",
    projectIds: [...new Set(ids)],
    key: String(env.DEMO_TOKEN_ENCRYPTION_KEY ?? ""),
    admins: String(env.DEMO_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

// What's missing for the demo to run (names only, never values), else null
export function demoProblem(s = demoSettings()) {
  if (!s.enabled) return "DEMO_ENABLED isn't true";
  if (!s.projectIds.length) return "DEMO_PROJECT_IDS has no project ids";
  if (s.key.length < 32) return "DEMO_TOKEN_ENCRYPTION_KEY is missing or shorter than 32 characters";
  return null;
}

// An alert for Ky (Vercel logs; search for "[ALERT] SiteSnap demo"). The reason is a short code, never a token.
export function demoAlert(reason) {
  console.error(`[ALERT] SiteSnap demo authorization needs attention: ${reason}. Open /admin/demo-authorize to authorize the guest again.`);
}

const unavailable = () => new HttpError(503, "demo_unavailable", "The demo is temporarily unavailable. Please try again later.");

// ---------- the stored guest authorization ----------

const sealTokens = (t, key) => seal({ at: t.at, rt: t.rt, exp: t.exp }, key, TOKEN_PURPOSE);
const openTokens = (blob, key) => unseal(blob, key, TOKEN_PURPOSE);
const authRef = async () => (await firestore()).doc(AUTH_DOC);

let memo = null; // { t, doc, until } on this server
let inflight = null; // this server's refresh, shared by every request waiting on it
export const forgetDemoMemo = () => { memo = null; inflight = null; };

// The stored document (status, guestUserId, projects, …) without the sealed tokens, or null
export async function guestAuthInfo() {
  const snap = await (await authRef()).get();
  if (!snap.exists) return null;
  const { tokens, ...info } = snap.data() ?? {};
  return { ...info, hasTokens: !!tokens };
}

// Saved by /admin/demo-authorize after Ky signs in as the guest. projects = the allowlisted ones the guest can open.
export async function saveGuestAuth({ tokens, guestUserId, projects, missing }, s = demoSettings()) {
  const now = Date.now();
  await (await authRef()).set({
    tokens: sealTokens(tokens, s.key), exp: tokens.exp, guestUserId: String(guestUserId), projects, missing: missing ?? [],
    status: "ok", failure: null, lock: null, authorizedAt: now, refreshedAt: now,
  });
  forgetDemoMemo();
}

export async function deleteGuestAuth() {
  await (await authRef()).delete();
  forgetDemoMemo();
}

// Marks the demo unavailable, unless someone has stored newer tokens since (then their pair is the good one)
async function markFailed(reason, seenAt, s) {
  const db = await firestore();
  const ref = db.doc(AUTH_DOC);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d?.tokens || openTokens(d.tokens, s.key)?.at !== seenAt) return;
    tx.set(ref, { status: "failed", failure: { reason, at: Date.now() }, lock: null }, { merge: true });
  }).catch(() => {});
  demoAlert(reason);
  forgetDemoMemo();
}

const fresh = (t, failedAt) => t && t.at !== failedAt && Date.now() / 1000 < t.exp - REFRESH_EARLY_SECONDS;
const usable = (t, failedAt) => t && t.at !== failedAt && Date.now() / 1000 < t.exp - 30;

/**
 * The guest's access token plus { guestUserId, projects }. Refreshes (single flight) when it's within 5 minutes of
 * expiring, or when failedAt (an access token Procore just answered 401 to) is still the stored one.
 * Throws 503 demo_unavailable when there's no usable authorization.
 */
export async function guestTokens(cfg, { failedAt = null, s = demoSettings() } = {}) {
  if (memo && memo.until > Date.now() && fresh(memo.t, failedAt)) return withInfo(memo.t, memo.doc);
  const snap = await (await authRef()).get();
  const doc = snap.exists ? snap.data() : null;
  if (!doc?.tokens || doc.status === "failed") throw unavailable();
  const t = openTokens(doc.tokens, s.key);
  if (!t) {
    demoAlert("stored tokens can't be opened (DEMO_TOKEN_ENCRYPTION_KEY changed?)");
    throw unavailable();
  }
  if (fresh(t, failedAt)) {
    memo = { t, doc, until: Date.now() + MEMO_MS };
    return withInfo(t, doc);
  }
  inflight ??= refreshOnce(cfg, t, failedAt, s).finally(() => { inflight = null; });
  const next = await inflight;
  return withInfo(next, doc);
}

const withInfo = (t, doc) => ({ at: t.at, exp: t.exp, guestUserId: String(doc.guestUserId ?? ""), projects: doc.projects ?? [] });

async function refreshOnce(cfg, seen, failedAt, s) {
  const db = await firestore();
  const ref = db.doc(AUTH_DOC);
  const owner = randomBytes(8).toString("hex");
  // Take the lease, unless another server already stored a newer pair or holds the lease
  const got = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d?.tokens || d.status === "failed") return { gone: true };
    const cur = openTokens(d.tokens, s.key);
    if (!cur) return { gone: true };
    if (cur.at !== seen.at) return { newer: cur };
    if (d.lock?.until > Date.now()) return { busy: cur };
    tx.set(ref, { lock: { owner, until: Date.now() + LOCK_MS } }, { merge: true });
    return { mine: cur };
  });
  if (got.gone) throw unavailable();
  if (got.newer) return remember(got.newer);
  if (got.busy) {
    // Another server is refreshing: the current access token usually still works (refreshes start 5 minutes early)
    if (usable(got.busy, failedAt)) return got.busy;
    return waitForNewer(ref, seen.at, s);
  }

  let next;
  try {
    next = await refreshTokens(cfg, got.mine.rt);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      await markFailed("Procore refused the refresh token", seen.at, s);
      throw unavailable();
    }
    await ref.set({ lock: null }, { merge: true }).catch(() => {});
    console.error("SiteSnap demo: token refresh didn't reach Procore:", err?.name ?? "Error");
    throw new HttpError(503, "demo_busy", "The demo couldn't reach Procore. Try again in a minute.");
  }
  // Save the new pair before using it: the old refresh token no longer works
  for (let attempt = 0; ; attempt++) {
    try {
      await ref.set({ tokens: sealTokens(next, s.key), exp: next.exp, refreshedAt: Date.now(), lock: null, status: "ok", failure: null }, { merge: true });
      break;
    } catch (err) {
      if (attempt >= 2) {
        console.error("SiteSnap demo: couldn't save refreshed tokens:", err?.code ?? err?.name ?? "Error");
        demoAlert("refreshed tokens couldn't be saved");
        throw unavailable();
      }
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return remember(next);
}

function remember(t) {
  if (memo) memo = { ...memo, t, until: Date.now() + MEMO_MS };
  return t;
}

async function waitForNewer(ref, oldAt, s) {
  for (let i = 0; i < demoTiming.waitTries; i++) {
    await new Promise((r) => setTimeout(r, demoTiming.waitMs));
    const d = (await ref.get()).data();
    if (d?.status === "failed") throw unavailable();
    const cur = d?.tokens ? openTokens(d.tokens, s.key) : null;
    if (cur && cur.at !== oldAt) return remember(cur);
  }
  throw new HttpError(503, "demo_busy", "The demo is busy. Try again in a minute.");
}

// ---------- demo sessions ----------

// Starts a demo session in this browser (replaces any Procore sign-in cookie here)
export function startDemoSession(res, cfg, now = Date.now()) {
  const value = seal({ role: "demo", sid: randomBytes(12).toString("base64url"), last: now }, cfg.sessionSecret, SESSION_COOKIE);
  setCookie(res, SESSION_COOKIE, value, DEMO_IDLE_SECONDS);
}

/** session() for a demo cookie: idle expiry, read-only, allowlist, rate limit, then the guest's token. */
export async function demoTokens(req, res, cfg, cookie, { force = false } = {}) {
  const s = demoSettings();
  if (demoProblem(s)) {
    clearCookie(res, SESSION_COOKIE);
    throw new HttpError(401, "demo_expired", "The demo is off right now.");
  }
  const now = Date.now();
  if (!(now - Number(cookie.last) <= DEMO_IDLE_SECONDS * 1000)) {
    clearCookie(res, SESSION_COOKIE);
    throw new HttpError(401, "demo_expired", "The demo timed out. Open the demo link again.");
  }
  if (!req.demoChecked) {
    req.demoChecked = true; // once per request, however many Procore calls it makes
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (BLOCKED.test(path)) throw new HttpError(403, "demo_read_only", "This page isn't part of the demo.");
    if (!["GET", "HEAD"].includes(req.method ?? "GET") && !req.demoPostOk) throw demoReadOnly();
    await rateLimit(req);
    if (now - cookie.last > TOUCH_SECONDS * 1000) {
      setCookie(res, SESSION_COOKIE, seal({ ...cookie, last: now }, cfg.sessionSecret, SESSION_COOKIE), DEMO_IDLE_SECONDS);
    }
  }
  const t = await guestTokens(cfg, { failedAt: force ? req.demoAt ?? null : null, s });
  req.demoAt = t.at;
  req.demoGuest = { userId: t.guestUserId, projects: t.projects.filter((p) => s.projectIds.includes(String(p.projectId))) };
  return { at: t.at, exp: t.exp, demo: true, allowed: s.projectIds };
}

// ---------- rate limit: RATE_PER_MINUTE requests per IP per minute (Firestore, so it holds across servers) ----------

const local = new Map(); // a quick first check on this server, so a flood doesn't cost Firestore writes
export const forgetRateLimits = () => local.clear();

function ipOf(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || String(req.headers?.["x-real-ip"] ?? "") || req.socket?.remoteAddress || "unknown";
}

export async function rateLimit(req, s = demoSettings()) {
  const minute = Math.floor(Date.now() / 60_000);
  // Hashed with the demo key: no raw IP address is stored
  const id = createHash("sha256").update(`${s.key}|${ipOf(req)}`).digest("hex").slice(0, 32);
  const seen = local.get(id);
  const count = seen?.minute === minute ? seen.count + 1 : 1;
  local.set(id, { minute, count });
  if (local.size > 5000) local.delete(local.keys().next().value);
  if (count > RATE_PER_MINUTE) throw tooMany();
  const db = await firestore();
  const ref = db.doc(`sitesnapDemo/rate/ips/${id}`);
  const total = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    const n = d?.minute === minute ? (d.count ?? 0) + 1 : 1;
    tx.set(ref, { minute, count: n });
    return n;
  });
  if (total > RATE_PER_MINUTE) throw tooMany();
}
const tooMany = () => new HttpError(429, "demo_busy", "Too many requests from here. Wait a minute and try again.");

// ---------- Procore calls with a given token (only for /admin/demo-authorize, before anything is stored) ----------

export async function getWithToken(cfg, at, path, { companyId, query } = {}) {
  const url = `${cfg.apiUrl}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${at}`, Accept: "application/json", ...(companyId ? { "Procore-Company-Id": String(companyId) } : {}) } });
  if (!resp.ok) throw new HttpError(resp.status === 403 || resp.status === 404 ? resp.status : 502, "procore_failed", `Procore answered ${resp.status}.`);
  return resp.json();
}

// The guest's projects in the allowlist (and which allowlisted ones it can't open), from a fresh sign-in
export async function allowedProjectsFor(cfg, at, s = demoSettings()) {
  const companies = await getWithToken(cfg, at, "/rest/v1.0/companies");
  const found = [];
  for (const c of Array.isArray(companies) ? companies : []) {
    if (c?.id == null || c.is_active === false) continue;
    let list;
    try {
      list = await getWithToken(cfg, at, "/rest/v1.1/projects", { companyId: c.id, query: { company_id: c.id, view: "compact", per_page: 300 } });
    } catch (err) {
      if (err?.status === 403 || err?.status === 404) continue;
      throw err;
    }
    for (const p of Array.isArray(list) ? list : []) {
      if (p?.id == null || !s.projectIds.includes(String(p.id))) continue;
      found.push({ companyId: String(c.id), companyName: c.name ?? null, projectId: String(p.id), name: p.name || `Project ${p.id}` });
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return { projects: found, missing: s.projectIds.filter((id) => !found.some((p) => p.projectId === id)) };
}
