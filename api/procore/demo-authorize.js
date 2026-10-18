// /api/procore/demo-authorize (and /admin/demo-authorize, which redirects here; docs/guest-demo.md): Ky's page for
// the guest demo's one-time Procore authorization. Owner only: Ky must be signed in to SiteSnap with his own Procore
// account, and its Procore login must be in DEMO_ADMIN_EMAILS.
//   GET            the status page (stored or not, which projects, last refresh, failure) and the buttons
//   GET ?start=1   starts Procore's normal OAuth sign-in with prompt=login; Ky signs in there as the GUEST. The
//                  callback (api/procore/callback.js, same redirect URI) sees this sign-in's purpose, checks it isn't
//                  an owner account, keeps only the allowlisted projects, and stores the tokens sealed in Firestore.
//                  Ky's own SiteSnap sign-in cookie is left as it was.
//   POST { action: "refresh" | "delete" }   test a refresh now (single flight, like any visitor) / remove it
// Tokens are never shown, logged or put in a URL. The guest's name and email are never shown either.
import { randomBytes } from "node:crypto";
import { config, HttpError, newState, procoreGet, readBody, redirect, requireSameOriginJson, sendError, sendJson, setCookie, STATE_COOKIE, queryOf } from "../_procore.js";
import { allowedProjectsFor, deleteGuestAuth, demoProblem, demoSettings, forgetDemoMemo, getWithToken, guestAuthInfo, guestTokens, saveGuestAuth } from "../_demo.js";

export const PURPOSE = "demo-authorize";
const PAGE = "/api/procore/demo-authorize";

// Ky (signed in with his own Procore account, listed in DEMO_ADMIN_EMAILS), else throws
async function requireOwner(req, res, cfg, s) {
  if (!s.admins.length) throw new HttpError(403, "not_configured", "Set DEMO_ADMIN_EMAILS in Vercel first.");
  const me = await procoreGet(req, res, cfg, "/rest/v1.0/me");
  const login = String(me?.login ?? "").trim().toLowerCase();
  if (!s.admins.includes(login)) {
    // Shown only to the signed-in person (their own login), so the owner can see what to put in the setting.
    // A demo visitor never gets here: demo sessions are refused before /me (the page is blocked for them).
    throw new HttpError(403, "not_owner", `Only the app's owner can use this page. You're signed in to SiteSnap with the Procore login ${login || "(none)"}; if that's you, put exactly that in DEMO_ADMIN_EMAILS in Vercel and redeploy.`);
  }
}

// Called by the callback with the guest's fresh tokens. Returns where to send the browser.
export async function finishDemoAuthorize(cfg, tokens, s = demoSettings()) {
  try {
    const problem = demoProblem({ ...s, enabled: true });
    if (problem) return `${PAGE}?error=settings`;
    const me = await getWithToken(cfg, tokens.at, "/rest/v1.0/me");
    if (me?.id == null) return `${PAGE}?error=who`;
    // Ky's own account would turn the demo into Ky (with his admin rights): refuse it
    if (s.admins.includes(String(me.login ?? "").trim().toLowerCase())) return `${PAGE}?error=owner_account`;
    const { projects, missing } = await allowedProjectsFor(cfg, tokens.at, s);
    if (!projects.length) return `${PAGE}?error=no_projects`;
    await saveGuestAuth({ tokens, guestUserId: me.id, projects, missing }, s);
    console.log("SiteSnap demo: guest authorized · projects", projects.length, "· missing", missing.length);
    return `${PAGE}?done=1`;
  } catch (err) {
    console.error("SiteSnap demo authorize failed:", err?.code ?? err?.name ?? "Error");
    return `${PAGE}?error=failed`;
  }
}

const ERRORS = {
  settings: "The demo settings aren't complete (see Settings below).",
  who: "Procore didn't say who signed in. Try again.",
  owner_account: "That was your own (owner) Procore account, so nothing was saved. Sign out of Procore first (step 1), then sign in with the guest's email.",
  no_projects: "The guest can't open any of the DEMO_PROJECT_IDS projects, so nothing was saved. Add the guest to those projects in Procore.",
  failed: "Couldn't finish. Nothing was changed. Try again.",
};

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) + " PT" : "—");

function page(res, body, status = 200) {
  const nonce = randomBytes(16).toString("base64");
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Demo authorization</title>
<style nonce="${nonce}">
body{margin:0;background:#000;color:#f2f2f7;font:16px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:40rem;margin:0 auto;padding:24px 16px}
h1{font-size:24px;margin:0 0 4px}.card{background:#1c1a17;border-radius:14px;padding:14px 16px;margin:14px 0}
.ok{color:#7ddc8f}.bad{color:#ff8a7a}small,.muted{color:#a8a296}
a.btn,button{display:inline-block;background:#ffb000;color:#1a1200;border:0;font:inherit;font-weight:700;border-radius:12px;padding:10px 16px;margin:6px 8px 6px 0;text-decoration:none;cursor:pointer}
button.ghost{background:#2b2823;color:#f2f2f7}ul{padding-left:20px;margin:6px 0}code{color:#ffc24d}
</style></head><body><main>${body}</main>
<script nonce="${nonce}">
for (const b of document.querySelectorAll("button[data-action]")) b.addEventListener("click", async () => {
  if (b.dataset.action === "delete" && !confirm("Remove the stored guest authorization? The demo stops working until you authorize again.")) return;
  b.disabled = true;
  const out = document.getElementById("out");
  try {
    const r = await fetch(location.pathname, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: b.dataset.action }) });
    const j = await r.json();
    out.textContent = j.message || (r.ok ? "Done." : "Didn't work.");
    if (r.ok) setTimeout(() => location.replace(location.pathname), 1200);
  } catch { out.textContent = "Couldn't reach the server."; }
  b.disabled = false;
});
</script></body></html>`);
}

function statusPage(res, { s, info, q }) {
  const problem = demoProblem(s);
  const msg = q.get("done") ? `<p class="ok"><strong>Saved.</strong> The guest authorization is stored. Open <a href="/demo">/demo</a> in a private window to try it.</p>`
    : q.get("error") ? `<p class="bad"><strong>${esc(ERRORS[q.get("error")] ?? ERRORS.failed)}</strong></p>` : "";
  const stored = !info?.hasTokens ? `<p class="bad">No guest authorization is stored. The demo shows "temporarily unavailable".</p>`
    : `<p class="${info.status === "failed" ? "bad" : "ok"}"><strong>${info.status === "failed" ? "Failed: authorize again" : "Working"}</strong>${info.failure ? ` · ${esc(info.failure.reason)} (${when(info.failure.at)})` : ""}</p>
<p><small>Guest Procore user id ${esc(info.guestUserId)} · authorized ${when(info.authorizedAt)} · last refresh ${when(info.refreshedAt)} · access token good until ${when((info.exp ?? 0) * 1000)}</small></p>
<p>Projects the demo shows:</p><ul>${(info.projects ?? []).map((p) => `<li>${esc(p.name)} <small>(${esc(p.projectId)})</small></li>`).join("")}</ul>
${info.missing?.length ? `<p class="bad">The guest can't open: ${info.missing.map(esc).join(", ")}</p>` : ""}`;
  page(res, `<h1>Guest demo authorization</h1><p class="muted">Owner only. Tokens are stored encrypted on the server and are never shown.</p>${msg}
<div class="card"><strong>Stored authorization</strong>${stored}
${info?.hasTokens ? `<button class="ghost" data-action="refresh">Test a Refresh Now</button><button class="ghost" data-action="delete">Remove It</button>` : ""}<p id="out" class="muted"></p></div>
<div class="card"><strong>Authorize the guest</strong>
<p>1. Sign out of Procore in this browser (Procore remembers your own login). A Procore tab opens; close it when it says you're signed out.</p>
<a class="btn" href="/api/procore/logout" target="_blank" rel="noopener">Sign Out of Procore</a>
<p>2. Sign in with the <strong>guest's</strong> Procore email and password, and approve SiteSnap AI. Your own SiteSnap sign-in here stays as it is.</p>
<a class="btn" href="${PAGE}?start=1">Authorize the Guest</a></div>
<div class="card"><strong>Settings</strong>
<p class="${problem ? "bad" : "ok"}">${problem ? esc(problem) : "DEMO_ENABLED, DEMO_PROJECT_IDS and DEMO_TOKEN_ENCRYPTION_KEY are set."}</p>
<p><small>Allowlist: ${s.projectIds.map(esc).join(", ") || "none"} · ${s.admins.length} owner email(s)</small></p></div>`);
}

export default async function handler(req, res) {
  const cfg = (() => { try { return config(); } catch (err) { return err; } })();
  const s = demoSettings();
  if (req.method === "POST") {
    try {
      if (cfg instanceof Error) throw cfg;
      requireSameOriginJson(req); // a demo session is refused here
      await requireOwner(req, res, cfg, s);
      const { action } = await readBody(req);
      if (action === "delete") {
        await deleteGuestAuth();
        return sendJson(res, 200, { ok: true, message: "Removed. The demo now shows \"temporarily unavailable\"." });
      }
      if (action === "refresh") {
        const info = await guestAuthInfo();
        if (!info?.hasTokens) throw new HttpError(404, "not_found", "Nothing stored yet.");
        // Same single-flight path a visitor uses, with the current token treated as used up
        forgetDemoMemo();
        const before = await guestTokens(cfg, { s });
        const after = await guestTokens(cfg, { failedAt: before.at, s });
        return sendJson(res, 200, { ok: after.at !== before.at, message: after.at !== before.at ? "Refreshed and saved." : "Procore kept the same token." });
      }
      throw new HttpError(400, "bad_request", "Unknown action.");
    } catch (err) {
      return sendError(res, err);
    }
  }
  try {
    if (cfg instanceof Error) throw cfg;
    const q = queryOf(req);
    await requireOwner(req, res, cfg, s);
    if (q.get("start") === "1") {
      const { state, cookie, maxAge } = newState(cfg, { purpose: PURPOSE });
      setCookie(res, STATE_COOKIE, cookie, maxAge);
      const params = new URLSearchParams({ client_id: cfg.clientId, response_type: "code", redirect_uri: cfg.redirectUri, state, prompt: "login" });
      return redirect(res, `${cfg.loginUrl}/oauth/authorize?${params}`);
    }
    statusPage(res, { s, info: await guestAuthInfo().catch(() => null), q });
  } catch (err) {
    const signIn = err?.status === 401;
    page(res, `<h1>Guest demo authorization</h1>
<p class="bad">${signIn ? "Sign in to SiteSnap with your own Procore account first, then open this page again." : esc(err instanceof HttpError ? err.message : "Something went wrong.")}</p>
${signIn ? `<a class="btn" href="/api/procore/login">Sign In with Procore</a>` : ""}`, signIn ? 401 : err?.status ?? 500);
  }
}
