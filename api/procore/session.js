// POST /api/procore/session : turns the Procore sign-in (httpOnly cookie) into a SiteSnap sign-in.
// Everyone signs in with Procore; SiteSnap has no guests or separate accounts for messaging.
//  1. Asks Procore who this is (GET /rest/v1.0/me) and which projects they can open (api/_projects.js).
//  2. Records it for the Firestore rules (server only, never client-writable):
//       procoreUsers/{procoreUserId} = { name, projectKeys[], updatedAt }   (rules: no client access)
//       procoreProjects/{c}_{p}/members/{procoreUserId} = { procoreUserId, name, at }
//     and removes the member docs of projects they're no longer on, so a removed person loses the feed.
//  3. Returns a Firebase custom token for uid procore_{procoreUserId} with claim procoreUserId, which
//     the app signs in with. The rules then let them read only their projects' conversations.
// Same-origin JSON only. No email is returned or stored for other users to see.
// Guest demo (docs/guest-demo.md): the same, as the stored demo guest, named only "Guest", for the allowlisted
// projects only, and the Firebase sign-in carries demo: true (the rules and functions refuse its writes).
import { config, HttpError, procoreGet, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { listProjects, projectKey } from "../_projects.js";
import { firebaseAuth, firestore } from "../_firestore.js";

export const uidFor = (procoreUserId) => `procore_${procoreUserId}`;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req, { demoOk: true });
    const cfg = config();
    const me = await procoreGet(req, res, cfg, "/rest/v1.0/me");
    if (me?.id == null) throw new HttpError(502, "procore_failed", "Procore didn't say who you are. Try again.");
    const procoreUserId = String(me.id);
    const { projects } = await listProjects(req, res, cfg);
    const demo = !!req.demoGuest;
    // Procore only fills in the name when a company is given
    const clean = (u) => String(u?.name ?? "").trim() || [u?.first_name, u?.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
    let name = demo ? "Guest" : clean(me);
    let from = demo ? "demo" : "me";
    if (!name && projects[0]) {
      const named = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId: projects[0].companyId, query: { company_id: projects[0].companyId } }).catch(() => null);
      name = clean(named);
      from = "me with company";
    }
    if (!name) [name, from] = [String(me.login ?? "").split("@")[0].trim(), "login"];
    if (!name) [name, from] = [`Procore user ${procoreUserId}`, "id"];
    console.log("SiteSnap sign-in: name from", from, "· projects", projects.length);

    // Google errors (Firestore, Auth) name a code and a reason but never a Procore token, so log those
    let step = "firestore";
    const fail = (err) => {
      if (err instanceof HttpError) throw err;
      console.error(`SiteSnap sign-in failed at ${step}:`, err?.code ?? "", String(err?.message ?? "").replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]").slice(0, 300));
      throw new HttpError(500, "signin_failed", "Couldn't finish signing in to SiteSnap. Try again in a minute.");
    };
    try {
    const db = await firestore();
    const userRef = db.doc(`procoreUsers/${procoreUserId}`);
    const before = (await userRef.get()).data()?.projectKeys ?? [];
    const keys = projects.map(projectKey);
    const now = Date.now();
    const batch = db.batch();
    for (const k of keys) batch.set(db.doc(`procoreProjects/${k}/members/${procoreUserId}`), { procoreUserId, name, at: now });
    for (const k of before) if (!keys.includes(k)) batch.delete(db.doc(`procoreProjects/${k}/members/${procoreUserId}`));
    batch.set(userRef, { name, projectKeys: keys, updatedAt: now });
    await batch.commit();

    step = "token";
    const token = await (await firebaseAuth()).createCustomToken(uidFor(procoreUserId), { procoreUserId, ...(demo ? { demo: true } : {}) });
    sendJson(res, 200, { token, me: { procoreUserId, name, ...(demo ? { demo: true } : {}) }, projects, ...(demo ? { demo: true } : {}) });
    } catch (err) {
      fail(err);
    }
  } catch (err) {
    sendError(res, err);
  }
}
