// Procore OAuth (authorization code grant) for the Vercel functions in api/procore/.
// Server only: the client secret and tokens never reach the browser. Tokens live in an
// encrypted httpOnly cookie (AES-256-GCM, key derived from SESSION_SECRET), so no database.
// Endpoints and fields follow Procore's docs (checked 2026-10-13):
//   OAuth: developers.procore.com/documentation/oauth-auth-grant-flow and /oauth-endpoints
//   GET /rest/v1.0/me, GET /rest/v1.0/projects/{project_id}/users (Procore-Company-Id header)
// Never log or return the client secret, a token, or a cookie value.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const REDIRECT_URI = "https://sitesnap-procore.vercel.app/api/procore/callback";
export const STATE_COOKIE = "pc_state";
export const SESSION_COOKIE = "pc_session";
const COOKIE_PATH = "/api/procore";
const STATE_SECONDS = 10 * 60; // Procore's authorization code also lasts 10 minutes
const SESSION_SECONDS = 30 * 24 * 60 * 60; // the refresh token has no fixed expiry; ask again after 30 days
const REFRESH_EARLY_SECONDS = 120; // refresh a little before the 1.5-hour access token runs out

const ENV = ["PROCORE_CLIENT_ID", "PROCORE_CLIENT_SECRET", "PROCORE_LOGIN_URL", "PROCORE_API_URL", "SESSION_SECRET"];

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Server settings. Missing ones are named (names only, never values).
export function config(env = process.env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) throw new HttpError(500, "not_configured", `Procore isn't set up on this server (missing ${missing.join(", ")}).`);
  return {
    clientId: env.PROCORE_CLIENT_ID,
    clientSecret: env.PROCORE_CLIENT_SECRET,
    loginUrl: env.PROCORE_LOGIN_URL.replace(/\/+$/, ""),
    apiUrl: env.PROCORE_API_URL.replace(/\/+$/, ""),
    sessionSecret: env.SESSION_SECRET,
    redirectUri: REDIRECT_URI,
  };
}

// Procore company and project ids are whole numbers; anything else (blank, {{procore...}}) is dropped
export function procoreId(value) {
  const v = (value ?? "").trim();
  return /^\d{1,20}$/.test(v) ? v : null;
}

// ---------- encrypted cookie values ----------

const keyFor = (secret) => Buffer.from(hkdfSync("sha256", secret, "", "sitesnap-procore-cookie-v1", 32));

// purpose is bound in as associated data, so a state cookie can't be replayed as a session cookie
export function seal(data, secret, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

// null when missing, tampered with, sealed for another purpose, or under another secret
export function unseal(value, secret, purpose) {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

// ---------- cookies ----------

export function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// httpOnly + Secure + SameSite=Lax: sent on the top-level redirect back from Procore, never to scripts
export function setCookie(res, name, value, maxAge) {
  const cookie = `${name}=${value}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [prev] : []), cookie]);
}
export const clearCookie = (res, name) => setCookie(res, name, "", 0);

// ---------- responses ----------

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

export function sendError(res, err) {
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code, message: err.message });
  console.error("Procore request failed:", err?.name ?? "Error"); // no message: it could hold a token
  return sendJson(res, 502, { error: "procore_failed", message: "Couldn't reach Procore. Try again." });
}

export const queryOf = (req) => new URL(req.url, "http://localhost").searchParams;

// Back to the app (same company / project), always a path on this site, never an outside URL
export function appUrl({ companyId, projectId }, status) {
  const q = new URLSearchParams();
  if (companyId) q.set("companyId", companyId);
  if (projectId) q.set("projectId", projectId);
  q.set("procore", status);
  return `/?${q}`;
}

// ---------- state (CSRF protection for the sign-in round trip) ----------

// A random state for /oauth/authorize, plus the sealed cookie that remembers it and the context
export function newState(cfg, context, now = Date.now()) {
  const state = randomBytes(32).toString("base64url");
  const cookie = seal({ state, ...context, exp: now + STATE_SECONDS * 1000 }, cfg.sessionSecret, STATE_COOKIE);
  return { state, cookie, maxAge: STATE_SECONDS };
}

// The context ({ companyId, projectId }) when Procore's state matches the cookie's; else throws
export function checkState(cfg, cookieValue, returned, now = Date.now()) {
  const saved = unseal(cookieValue, cfg.sessionSecret, STATE_COOKIE);
  if (!saved) throw new HttpError(400, "bad_state", "This sign-in link has expired or was opened in another browser. Start again.");
  if (now > saved.exp) throw new HttpError(400, "bad_state", "This sign-in took too long. Start again.");
  const a = Buffer.from(String(returned ?? ""));
  const b = Buffer.from(saved.state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(400, "bad_state", "This sign-in didn't come from this browser. Start again.");
  }
  return { companyId: procoreId(saved.companyId), projectId: procoreId(saved.projectId) };
}

// ---------- tokens ----------

async function tokenRequest(cfg, fields) {
  const resp = await fetch(`${cfg.loginUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, ...fields }),
  });
  if (!resp.ok) throw new HttpError(resp.status === 401 || resp.status === 400 ? 401 : 502, "token_failed", "Procore didn't accept the sign-in. Connect Procore again.");
  const json = await resp.json();
  if (!json.access_token || !json.refresh_token) throw new HttpError(502, "token_failed", "Procore sent back an unexpected answer.");
  const issued = Number(json.created_at) || Math.floor(Date.now() / 1000);
  return { at: json.access_token, rt: json.refresh_token, exp: issued + (Number(json.expires_in) || 5400) };
}

export const exchangeCode = (cfg, code) => tokenRequest(cfg, { grant_type: "authorization_code", code });
// Procore returns a new refresh token each time and the old one stops working, so always save it
export const refreshTokens = (cfg, refreshToken) => tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });

export const saveSession = (res, cfg, tokens) => setCookie(res, SESSION_COOKIE, seal(tokens, cfg.sessionSecret, SESSION_COOKIE), SESSION_SECONDS);

// The signed-in user's tokens, refreshed (and the cookie rewritten) when the access token is about to expire
export async function session(req, res, cfg, { force = false } = {}) {
  let tokens = unseal(readCookies(req)[SESSION_COOKIE], cfg.sessionSecret, SESSION_COOKIE);
  if (!tokens) throw new HttpError(401, "not_connected", "Connect Procore first.");
  if (force || Date.now() / 1000 > tokens.exp - REFRESH_EARLY_SECONDS) {
    try {
      tokens = await refreshTokens(cfg, tokens.rt);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) clearCookie(res, SESSION_COOKIE);
      throw err.status === 401 ? new HttpError(401, "not_connected", "Your Procore sign-in ran out. Connect Procore again.") : err;
    }
    saveSession(res, cfg, tokens);
  }
  return tokens;
}

// Read-only GET on the Procore API. Retries once with fresh tokens if Procore says the token is bad.
export async function procoreGet(req, res, cfg, path, { companyId, query } = {}) {
  let tokens = await session(req, res, cfg);
  const url = `${cfg.apiUrl}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const call = (t) => fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${t.at}`, Accept: "application/json", ...(companyId ? { "Procore-Company-Id": companyId } : {}) },
  });
  let resp = await call(tokens);
  if (resp.status === 401) {
    tokens = await session(req, res, cfg, { force: true });
    resp = await call(tokens);
  }
  if (resp.status === 401) throw new HttpError(401, "not_connected", "Connect Procore again.");
  if (resp.status === 403) throw new HttpError(403, "no_access", "Your Procore account doesn't have access to this.");
  if (resp.status === 404) throw new HttpError(404, "not_found", "Procore couldn't find that company or project.");
  if (!resp.ok) throw new HttpError(502, "procore_failed", `Procore answered ${resp.status}. Try again.`);
  return resp.json();
}
