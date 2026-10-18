// Step 4: a thread's Procore record, kept in step with the thread.
// GET  /api/procore/record-status?companyId=&projectId=&cid=  : what Procore says now; if it was closed in
//      Procore, the thread closes too (with a "Closed in Procore" line). Used when a thread is opened.
// POST /api/procore/record-status { companyId, projectId, cid, action: done | close | reopen } : changes the
//      record in Procore with the signed-in person's own sign-in (Procore decides who may: if they can't,
//      the answer says so plainly and nothing changes), then updates the thread.
// POST { companyId, projectId, recordType, recordId, action: "done" } (no cid): My items' Mark fixed on a record
//      that had no SiteSnap thread when the person started; only "done" (Ready for review), same PATCH, no thread
//      update (a thread started for it syncs when it's opened).
// The thread is written with firebase-admin (server-only fields procoreStatus, status, and the line).
import { config, HttpError, procoreGet, procoreId, queryOf, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { firestore } from "../_firestore.js";
import { procoreSend } from "../_procoreWrite.js";
import { ACTIONS, readPath, statusOf, updateBody } from "../_recordStatus.js";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const procoreError = (r) => {
  const e = r.json?.errors ?? r.json?.message ?? r.json?.error;
  if (!e) return null;
  return typeof e === "string" ? e : Object.entries(e).map(([k, v]) => `${k} ${[].concat(v).join(", ")}`).join("; ");
};

// A thread line written by the server ("Closed in Procore by …"); the message trigger updates the card
function eventLine(db, key, cid, event, who) {
  const now = Date.now();
  return db.collection(`procoreProjects/${key}/conversations/${cid}/messages`).add({
    authorId: who.id, authorName: who.name, text: "", transcript: "", transcriptStatus: "none", photos: [],
    voicePath: null, voiceType: null, aiDescription: null, event, via: "procore", clientCreatedAt: now, createdAt: now,
  });
}

// Mark fixed on a record with no thread: the same Procore change as Done in a thread
async function markByRecord(req, res, cfg, { companyId, projectId, recordType, recordId }) {
  const { path, body } = updateBody(recordType, "done", projectId);
  const r = await procoreSend(req, res, cfg, "PATCH", `${path}/${recordId}`, { companyId, body });
  if (!r.ok) {
    const why = procoreError(r);
    if (r.status === 403) throw new HttpError(403, "procore_refused", "Your role on this project doesn't include this. Ask your project admin.");
    throw new HttpError(r.status === 401 ? 401 : 422, "procore_refused", `Procore didn't change it${why ? `: ${why}` : "."}`);
  }
  const now = await procoreSend(req, res, cfg, "GET", `${readPath(recordType)}/${recordId}`, { companyId, query: { project_id: projectId } });
  console.log("SiteSnap record-status by record", JSON.stringify({ projectId, recordType, recordId, patch: r.status, read: now.status }));
  return { status: now.ok ? statusOf(recordType, now.json) : { value: "ready_for_review", label: "Ready for review", closed: false } };
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    const post = req.method === "POST";
    if (!post && req.method !== "GET") throw new HttpError(405, "bad_request", "Use GET or POST.");
    let input;
    if (post) {
      requireSameOriginJson(req);
      input = await readBody(req);
    } else {
      input = Object.fromEntries(queryOf(req));
    }
    const companyId = procoreId(String(input.companyId ?? ""));
    const projectId = procoreId(String(input.projectId ?? ""));
    const cid = String(input.cid ?? "");
    const action = post ? String(input.action ?? "") : null;
    const byRecord = post && !cid && ["observation", "punch_item"].includes(input.recordType) && procoreId(String(input.recordId ?? ""));
    if (!companyId || !projectId || (!byRecord && !ID_RE.test(cid))) throw new HttpError(400, "missing_ids", "Unknown thread.");
    if (byRecord && action !== "done") throw new HttpError(400, "bad_request", "Only Mark fixed works without a thread.");
    if (post && !ACTIONS.includes(action)) throw new HttpError(400, "bad_request", "Unknown change.");
    const key = `${companyId}_${projectId}`;

    // Who's asking, and that they're on this project (the same membership the Firestore rules use)
    const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
    const who = { id: String(me?.id ?? ""), name: me?.name || me?.login?.split("@")[0] || "Someone" };
    const db = await firestore();
    if (!(await db.doc(`procoreProjects/${key}/members/${who.id}`).get()).exists) throw new HttpError(403, "no_access", "You're not on this project.");
    if (byRecord) return sendJson(res, 200, await markByRecord(req, res, cfg, { companyId, projectId, recordType: input.recordType, recordId: byRecord }));
    const convRef = db.doc(`procoreProjects/${key}/conversations/${cid}`);
    const conv = (await convRef.get()).data();
    const link = conv?.procore;
    if (!link?.id || !["observation", "punch_item"].includes(link.recordType)) throw new HttpError(404, "not_found", "This thread isn't linked to a Procore record.");

    // Change it in Procore first (Procore decides who may)
    if (post) {
      const { path, body } = updateBody(link.recordType, action, projectId);
      const r = await procoreSend(req, res, cfg, "PATCH", `${path}/${link.id}`, { companyId, body });
      if (!r.ok) {
        const why = procoreError(r);
        if (r.status === 403) throw new HttpError(403, "procore_refused", action === "close" ? "Procore says you can't close this one. The project manager (or the item's final approver) closes it." : `Procore didn't allow that${why ? `: ${why}` : "."}`);
        throw new HttpError(r.status === 401 ? 401 : 422, "procore_refused", `Procore didn't change it${why ? `: ${why}` : "."}`);
      }
    }

    // What Procore says now, and the thread to match
    const now = await procoreSend(req, res, cfg, "GET", `${readPath(link.recordType)}/${link.id}`, { companyId, query: { project_id: projectId } });
    if (!now.ok) throw new HttpError(now.status === 404 ? 404 : 502, "procore_failed", now.status === 404 ? "The record is gone from Procore." : "Couldn't read the record from Procore.");
    const st = statusOf(link.recordType, now.json);
    const update = { procoreStatus: { value: st.value, label: st.label, closed: st.closed, at: Date.now() } };
    if (st.closed && conv.status !== "closed") {
      Object.assign(update, { status: "closed", statusBy: post ? who.id : "procore", statusAt: Date.now() });
      await eventLine(db, key, cid, "closed", post ? who : { id: "procore", name: "Procore" });
    } else if (!st.closed && conv.status === "closed" && action === "reopen") {
      Object.assign(update, { status: "open", statusBy: who.id, statusAt: Date.now() });
      await eventLine(db, key, cid, "reopened", who);
    }
    await convRef.set(update, { merge: true });
    sendJson(res, 200, { status: st, threadStatus: update.status ?? conv.status });
  } catch (err) {
    sendError(res, err);
  }
}
