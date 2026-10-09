// Shared team jobs. Jobs stay under their owner (users/{owner}/jobs/{jobId}); a job with
// orgId is shared with that company, and the security rules decide who sees what:
//   admin, estimator  everything (drafts, working copy, finals, prices)
//   field             the job, its stops and photos, and the price-free work order view
//   installer         only the price-free work order view, and only for jobs assigned to them
// Prices can't be hidden field-by-field inside a document, so this file keeps
// users/{owner}/jobs/{jobId}/views/workorder: the working copy without costs or prices.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { piccoloCallable } = require("./budget");

const PRICE_ROLES = ["admin", "estimator"];
const db = () => getFirestore();

const profileOf = async (uid) => (await db().doc(`users/${uid}`).get()).data() || null;
const activeTeam = (p) => !!(p?.orgId && p.status === "active" && p.tier === "team");

/**
 * Who may work on a job in Piccolo (draft, edit, finalize, export with prices): its owner,
 * or an active admin / estimator of the company it's shared with. Returns the job.
 */
async function piccoloAccess(callerUid, ownerUid, jobId) {
  const job = (await db().doc(`users/${ownerUid}/jobs/${jobId}`).get()).data();
  if (!job) throw new HttpsError("not-found", "This job could not be found.");
  if (callerUid === ownerUid) return job;
  const me = await profileOf(callerUid);
  if (job.orgId && activeTeam(me) && me.orgId === job.orgId && PRICE_ROLES.includes(me.role)) return job;
  // Same message as a missing job, so it doesn't reveal other people's jobs
  throw new HttpsError("not-found", "This job could not be found.");
}
exports.piccoloAccess = piccoloAccess;

/** The owner path from a request: the caller's own jobs unless ownerUid is given. */
function ownerOf(request) {
  const owner = request.data?.ownerUid ? String(request.data.ownerUid) : request.auth.uid;
  if (!/^[A-Za-z0-9]{1,128}$/.test(owner)) throw new HttpsError("invalid-argument", "Unknown job owner.");
  return owner;
}
exports.ownerOf = ownerOf;

// ---------- sharing new jobs, and keeping stops in step ----------

/** A team member's new job is shared with their company. */
exports.shareNewJobWithTeam = onDocumentCreated("users/{uid}/jobs/{jobId}", async (event) => {
  const job = event.data?.data();
  if (!job || job.orgId || job.isDemo) return;
  const owner = await profileOf(event.params.uid);
  if (!activeTeam(owner)) return;
  await event.data.ref.update({ orgId: owner.orgId });
});

/** A stop carries its job's orgId, so teammates' reads can be checked by the rules. */
exports.syncStopOrg = onDocumentWritten("users/{uid}/stops/{stopId}", async (event) => {
  const stop = event.data?.after?.exists ? event.data.after.data() : null;
  if (!stop) return;
  const job = stop.jobId ? (await db().doc(`users/${event.params.uid}/jobs/${stop.jobId}`).get()).data() : null;
  const orgId = job?.orgId || null;
  if ((stop.orgId || null) === orgId) return; // already right (also ends the loop)
  await event.data.after.ref.update({ orgId: orgId ?? FieldValue.delete() });
});

// ---------- the price-free work order ----------

const stripPrices = (line) => {
  const out = { ...line };
  delete out.unitCost;
  delete out.unitPrice;
  delete out.priceSource;
  return out;
};

/** Keeps views/workorder in step with the working copy (and the job's sharing). */
async function writeWorkOrderView(ownerUid, jobId) {
  const jobRef = db().doc(`users/${ownerUid}/jobs/${jobId}`);
  const [job, working] = await Promise.all([jobRef.get(), jobRef.collection("working").doc("current").get()]);
  const viewRef = jobRef.collection("views").doc("workorder");
  if (!job.exists || !working.exists) return viewRef.delete();
  const w = working.data();
  return viewRef.set({
    orgId: job.get("orgId") || null,
    assignedTo: job.get("assignedTo") || [],
    workOrder: w.workOrder || null,
    bom: (w.bom || []).map(stripPrices),
    questions: w.questions || [],
    draftVersion: w.draftVersion || null,
    updatedAt: w.updatedAt || Date.now(),
  });
}
exports.writeWorkOrderView = writeWorkOrderView;

exports.workOrderView = onDocumentWritten("users/{uid}/jobs/{jobId}/working/current", async (event) => {
  await writeWorkOrderView(event.params.uid, event.params.jobId);
});

// ---------- owner: share or stop sharing; admin: assign ----------

exports.setJobSharing = onCall(piccoloCallable({ timeoutSeconds: 60 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const jobId = String(request.data?.jobId || "");
  const shared = request.data?.shared === true;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new HttpsError("invalid-argument", "Missing job.");
  const me = await profileOf(uid);
  if (!activeTeam(me)) throw new HttpsError("failed-precondition", "Join or start a company to share jobs.");
  const jobRef = db().doc(`users/${uid}/jobs/${jobId}`);
  const job = (await jobRef.get()).data();
  if (!job) throw new HttpsError("not-found", "This job could not be found.");
  if (job.isDemo) throw new HttpsError("failed-precondition", "The sample job can't be shared.");
  const orgId = shared ? me.orgId : null;

  const batch = db().batch();
  batch.update(jobRef, { orgId: orgId ?? FieldValue.delete(), ...(shared ? {} : { assignedTo: FieldValue.delete() }) });
  for (const s of (await db().collection(`users/${uid}/stops`).where("jobId", "==", jobId).get()).docs) {
    batch.update(s.ref, { orgId: orgId ?? FieldValue.delete() });
  }
  batch.set(db().collection("auditLog").doc(), { uid, orgId: me.orgId, action: shared ? "job.share" : "job.unshare", jobId, at: Date.now() });
  await batch.commit();
  await writeWorkOrderView(uid, jobId);
  return { shared };
});

exports.assignJob = onCall(piccoloCallable({ timeoutSeconds: 60 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const ownerUid = ownerOf(request);
  const jobId = String(request.data?.jobId || "");
  const assignees = [...new Set((Array.isArray(request.data?.assignees) ? request.data.assignees : []).map(String))].slice(0, 20);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new HttpsError("invalid-argument", "Missing job.");
  const me = await profileOf(uid);
  const jobRef = db().doc(`users/${ownerUid}/jobs/${jobId}`);
  const job = (await jobRef.get()).data();
  if (!job || !job.orgId || !activeTeam(me) || me.orgId !== job.orgId || me.role !== "admin") {
    throw new HttpsError("permission-denied", "Only your company's admin can assign this job.");
  }
  for (const a of assignees) {
    const p = await profileOf(a);
    if (!p || p.orgId !== job.orgId || p.status !== "active") throw new HttpsError("invalid-argument", "Everyone assigned has to be on your team.");
  }
  await jobRef.update({ assignedTo: assignees });
  await db().collection("auditLog").add({ uid, orgId: job.orgId, action: "job.assign", jobId, after: { assignees }, at: Date.now() });
  await writeWorkOrderView(ownerUid, jobId);
  logger.info("Job assigned", { ownerUid, jobId, assignees: assignees.length });
  return { assignees };
});
