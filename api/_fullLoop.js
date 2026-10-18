// Full-loop demo mode (Ky's SITESNAP_FULL_LOOP_DEMO_SPEC.md v4, sections 4, 6 and 7; docs/FULL_LOOP_DEMO.md).
// Ky's own Procore sign-in (the PM, DEMO_ACTOR_PM) runs the whole loop live in the three demo projects:
// capture → Observation in Procore → close-out → PM close. While FULL_LOOP_DEMO=true, every Procore call made
// with a signed-in person's token goes through guardFullLoop():
//   - project allowlist: a call naming a project (/projects/{id} in the path, or project_id) outside
//     DEMO_PROJECT_IDS is refused, and the project picker lists only those projects;
//   - action allowlist: reads go through; the only writes are the loop's own (WRITES below);
//   - kill switch: FULL_LOOP_DEMO=false (and a redeploy) turns all of this off, and the loop's endpoints refuse.
// It's its own flag: DEMO_ENABLED is the public view-only guest demo (api/_demo.js), whose sessions keep their
// own read-only guard and are never affected by this one. The sandbox tool pages (TOOL_PAGES) have their own
// owner/admin guards and are exempt, so demo staging can still add people while the demo is on.
// The owner (Ky: a Procore login in DEMO_ADMIN_EMAILS) is never limited (Ky, 2026-10-18: "Edward Gray should have
// full rights, I am the admin"): every project, every tool, the normal card. ownerToken() asks Procore's /me once per
// access token and remembers it for a while on this server (never the token itself: a hash of it).
import { createHash } from "node:crypto";
import { HttpError } from "./_procore.js";

export const DEMO_TAG = "[SS-DEMO]"; // the marker on everything the demo creates (api/procore/records.js adds it)

const TOOL_PAGES = /^\/api\/procore\/(test-|demo-staging|demo-check|demo-seed|demo-authorize|seed-directory|daily-log-examples)/;

// The loop's Procore writes (spec section 7, item 3): create an Observation (and send its assignee email),
// upload a photo (upload slot, Photos album + image), add a response, change status. Nothing else, no deletes
// (Reset demo, spec step 8, will add its own marked-items-only path).
const WRITES = [
  ["POST", /^\/rest\/v1\.0\/observations\/items$/],
  ["POST", /^\/rest\/v1\.0\/observations\/items\/\d+\/send_email$/],
  ["PATCH", /^\/rest\/v1\.0\/observations\/items\/\d+$/],
  ["POST", /^\/rest\/v1\.0\/observations\/items\/\d+\/response_logs$/],
  ["POST", /^\/rest\/v1\.1\/projects\/\d+\/uploads$/],
  ["POST", /^\/rest\/v1\.0\/image_categories$/],
  ["POST", /^\/rest\/v1\.0\/images$/],
];

export function fullLoopSettings(env = process.env) {
  const ids = String(env.DEMO_PROJECT_IDS ?? "").split(",").map((s) => s.trim().split(":").pop().trim()).filter((id) => /^\d{1,20}$/.test(id));
  return {
    enabled: env.FULL_LOOP_DEMO === "true",
    projectIds: [...new Set(ids)],
    pm: String(env.DEMO_ACTOR_PM ?? "").trim().toLowerCase(),
    assignee: String(env.DEMO_ACTOR_ASSIGNEE ?? "").trim().toLowerCase(),
    admins: String(env.DEMO_ADMIN_EMAILS ?? "").split(/[,;\s]+/).map((x) => x.replace(/^["'<]+|["'>]+$/g, "").trim().toLowerCase()).filter(Boolean),
  };
}

// ---------- the owner is never limited ----------

const OWNER_MS = 10 * 60 * 1000;
const owners = new Map(); // sha256(access token) -> { owner, until }
export const forgetOwners = () => owners.clear();

/** Is this access token the owner's (a login in DEMO_ADMIN_EMAILS)? Asks /me once, then remembers it. */
export async function ownerToken(cfg, at, s = fullLoopSettings()) {
  if (!at || !s.admins.length) return false;
  const key = createHash("sha256").update(String(at)).digest("hex");
  const hit = owners.get(key);
  if (hit && hit.until > Date.now()) return hit.owner;
  let owner;
  try {
    const r = await fetch(`${cfg.apiUrl}/rest/v1.0/me`, { headers: { Authorization: `Bearer ${at}`, Accept: "application/json" } });
    if (!r.ok) return false; // not known: limited this time, asked again next time
    owner = s.admins.includes(String((await r.json())?.login ?? "").trim().toLowerCase());
  } catch {
    return false;
  }
  if (owners.size > 1000) owners.delete(owners.keys().next().value);
  owners.set(key, { owner, until: Date.now() + OWNER_MS });
  return owner;
}

/** Demo mode limits this signed-in person here (on, not a tool page, not the owner). tokens from session(). */
export async function limited(req, cfg, tokens, s = fullLoopSettings()) {
  if (!s.enabled || tokens?.demo || isToolPage(req)) return false;
  return !(await ownerToken(cfg, tokens?.at, s));
}

// What's missing for the demo to run (setting names only), else null
export function fullLoopProblem(s = fullLoopSettings()) {
  if (!s.enabled) return "FULL_LOOP_DEMO isn't true";
  if (!s.projectIds.length) return "DEMO_PROJECT_IDS has no project ids";
  return null;
}

const pathOf = (req) => new URL(req?.url ?? "/", "http://localhost").pathname;
export const isToolPage = (req) => TOOL_PAGES.test(pathOf(req));

const outside = () => new HttpError(403, "loop_project", "Demo mode is on: SiteSnap only works in the demo projects right now.");

/**
 * Throws 403 when demo mode is on and this Procore call is outside the demo; does nothing when it's off.
 * The project can be named in the path (/projects/{id}), the query or the JSON body (project_id); a write must
 * name one, so nothing reaches a project the check can't see.
 */
export function guardFullLoop(req, method, path, { query, body } = {}, s = fullLoopSettings()) {
  if (!s.enabled || isToolPage(req)) return;
  const ids = [...String(path).matchAll(/\/projects\/(\d+)/g)].map((m) => m[1]);
  for (const v of [query?.project_id, body?.project_id]) if (v != null) ids.push(String(v));
  if (ids.some((id) => !s.projectIds.includes(id))) throw outside();
  const m = String(method ?? "GET").toUpperCase();
  if (m === "GET" || m === "HEAD") return;
  if (!ids.length) throw outside();
  const bare = String(path).split("?")[0];
  if (!WRITES.some(([wm, re]) => wm === m && re.test(bare))) {
    console.error("SiteSnap demo mode refused a write:", m, bare.replace(/\d+/g, "{id}"));
    throw new HttpError(403, "loop_action", "Demo mode is on: only Observations can be sent to Procore right now.");
  }
}

/** guardFullLoop for a real Procore call: skipped for the owner, guest sessions (own guard) and tool pages. */
export async function guardCall(req, cfg, tokens, method, path, opts, s = fullLoopSettings()) {
  if (!(await limited(req, cfg, tokens, s))) return;
  guardFullLoop(req, method, path, opts, s);
}

/** The project picker's list while demo mode is on: only the demo projects (the owner and tool pages see all). */
export async function demoProjectsOnly(req, cfg, tokens, projects, s = fullLoopSettings()) {
  if (!(await limited(req, cfg, tokens, s))) return projects;
  return projects.filter((p) => s.projectIds.includes(String(p.projectId)));
}
