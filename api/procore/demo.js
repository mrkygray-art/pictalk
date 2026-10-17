// GET /demo (vercel.json rewrites it here): starts a view-only guest demo session (docs/guest-demo.md) and sends the
// visitor to the project picker, already signed in as the demo guest. No Procore login, no popup, no third-party
// cookie: one first-party httpOnly cookie (SameSite=Lax) that holds no tokens.
// ?project=<id> opens one of the allowlisted projects straight away.
// When the stored guest authorization is missing or can't be refreshed, this shows a plain "temporarily
// unavailable" page. It never sends a visitor to Procore's login.
import { config, procoreId, queryOf, redirect } from "../_procore.js";
import { demoAlert, demoProblem, demoSettings, guestTokens, rateLimit, startDemoSession } from "../_demo.js";

const SUPPORT = "supportprojectsai@gmail.com"; // the public support address (never Ky's own)
const PORTFOLIO = "https://ky-gray-portfolio.vercel.app";

export function unavailablePage(res, { status = 503, title = "The demo is temporarily unavailable", line = "Please try again later or contact Ky." } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const mail = `mailto:${SUPPORT}?subject=${encodeURIComponent("SiteSnap AI demo")}`;
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>SiteSnap AI demo</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f2f2f7;font:17px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;padding:24px 16px}
h1{font-size:24px;margin:0 0 12px}
p{color:#c7c2b8;margin:0 0 16px}
a{color:#ffc24d}
a.btn{display:inline-block;background:#ffb000;color:#1a1200;text-decoration:none;font-weight:700;border-radius:12px;padding:12px 18px;margin-right:12px}
</style></head><body><main>
<h1>${title}</h1>
<p>${line}</p>
<p><a class="btn" href="${mail}">Email Ky</a><a href="${PORTFOLIO}">Ky's portfolio</a></p>
</main></body></html>`);
}

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    if (req.method && req.method !== "GET" && req.method !== "HEAD") return unavailablePage(res, { status: 405, title: "Open the demo link", line: "Use the Try the live demo link." });
    const cfg = config();
    const s = demoSettings();
    const problem = demoProblem(s);
    if (problem) {
      if (s.enabled) demoAlert(problem); // switched on but not set up
      return unavailablePage(res);
    }
    try {
      await rateLimit(req, s);
    } catch {
      return unavailablePage(res, { status: 429, title: "Too many tries", line: "Wait a minute, then open the demo link again." });
    }
    let guest;
    try {
      guest = await guestTokens(cfg, { s }); // also refreshes it if it's about to run out
    } catch (err) {
      if (err?.code === "demo_unavailable") demoAlert("a visitor opened /demo but the guest authorization is missing or failed");
      return unavailablePage(res);
    }
    startDemoSession(res, cfg);
    const want = procoreId(queryOf(req).get("project"));
    const p = want && guest.projects.find((x) => String(x.projectId) === want && s.projectIds.includes(want));
    const q = new URLSearchParams({ demo: "1", ...(p ? { companyId: p.companyId, projectId: p.projectId } : {}) });
    redirect(res, `/?${q}`);
  } catch (err) {
    console.error("SiteSnap demo start failed:", err?.code ?? err?.name ?? "Error");
    unavailablePage(res);
  }
}
