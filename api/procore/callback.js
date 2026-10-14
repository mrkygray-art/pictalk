// /api/procore/callback : Procore sends the user back here after sign-in.
// GET ?code=&state= (the standard flow): checks the state against the cookie (once only), trades
//   the code for tokens, keeps them in an encrypted httpOnly cookie, and redirects to the app with
//   the same company / project.
// GET with nothing in the query: Procore may put the code after '#' (its iframe-helper docs say
//   so), which never reaches a server. A small page reads it, removes it from the address bar, and
//   POSTs it here (JSON, same origin); the POST runs the same checks and answers { location }.
import { randomBytes } from "node:crypto";
import {
  appUrl, checkState, clearCookie, config, exchangeCode, HttpError, queryOf, readBody, readCookies, requireSameOriginJson, redirect, saveSession, sendError, sendJson, STATE_COOKIE,
} from "../_procore.js";

// The shared part: state check (throws on a bad one), then Procore's answer. Returns where to go.
async function finish(req, res, cfg, { code, state, error }) {
  const stateCookie = readCookies(req)[STATE_COOKIE];
  clearCookie(res, STATE_COOKIE); // single use, whatever happens next
  const context = checkState(cfg, stateCookie, state);
  if (error) return appUrl(context, "denied"); // e.g. the user said no
  if (!code) throw new HttpError(400, "no_code", "Procore didn't send a sign-in code. Start again.");
  try {
    saveSession(res, cfg, await exchangeCode(cfg, String(code)));
  } catch (err) {
    console.error("Procore token exchange failed:", err?.status ?? err?.name ?? "Error");
    return appUrl(context, "error");
  }
  return appUrl(context, "connected");
}

// Reads a code after '#', takes it out of the address bar and history, and posts it back here
function fragmentPage(res) {
  const nonce = randomBytes(16).toString("base64");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connecting Procore</title>
<style nonce="${nonce}">body{margin:0;padding:24px;background:#000;color:#f2f2f7;font:17px -apple-system,"Segoe UI",Roboto,sans-serif}</style>
</head><body><p id="msg">Connecting Procore…</p>
<script nonce="${nonce}">
(async () => {
  const msg = document.getElementById("msg");
  const p = new URLSearchParams(location.hash.replace(/^#[/?]*/, ""));
  history.replaceState(null, "", location.pathname); // the code leaves the address bar and history
  if (!p.get("code") && !p.get("error")) { msg.textContent = "Procore didn't send a sign-in code. Close this tab and start again."; return; }
  try {
    const r = await fetch(location.pathname, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: p.get("code"), state: p.get("state"), error: p.get("error") }),
    });
    const j = await r.json();
    if (typeof j.location === "string" && j.location.startsWith("/") && !j.location.startsWith("//")) return location.replace(j.location);
    msg.textContent = j.message || "Procore sign-in didn't work. Start again.";
  } catch {
    msg.textContent = "Couldn't finish connecting Procore. Check your signal and start again.";
  }
})();
</script></body></html>`);
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (req.method === "POST") {
      // Same-origin JSON only: a cross-site form can't send JSON, and the Lax state cookie isn't sent cross-site anyway
      requireSameOriginJson(req);
      const body = await readBody(req);
      console.log("Procore callback: code arrived after '#'"); // which way Procore sends it (no values logged)
      return sendJson(res, 200, { location: await finish(req, res, cfg, body) });
    }
    if (req.method && req.method !== "GET") throw new HttpError(405, "bad_method", "Not allowed.");
    const q = queryOf(req);
    if (!q.has("code") && !q.has("state") && !q.has("error")) return fragmentPage(res);
    console.log("Procore callback: code arrived in the query");
    redirect(res, await finish(req, res, cfg, { code: q.get("code"), state: q.get("state"), error: q.get("error") }));
  } catch (err) {
    sendError(res, err);
  }
}
