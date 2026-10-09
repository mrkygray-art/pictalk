// Admin console helpers for a company's jobs: sales status and customer on any team job
// (the job document belongs to its owner, so these go through the server), and storage used.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { piccoloCallable } = require("./budget");
const { ownerOf } = require("./teams");

const SALES = ["captured", "drafted", "quoted", "won", "lost", "installed"];
const db = () => getFirestore();

async function admin(uid, roles = ["admin"]) {
  const p = (await db().doc(`users/${uid}`).get()).data();
  if (!p?.orgId || p.status !== "active" || p.tier !== "team" || !roles.includes(p.role)) {
    throw new HttpsError("permission-denied", "Only your company's admin can do that.");
  }
  return p;
}

/**
 * Set a team job's sales status and/or customer. Admins and estimators of the job's
 * company, or the job's owner when it's shared. customerId must be one of the company's.
 */
exports.updateTeamJob = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const ownerUid = ownerOf(request);
  const jobId = String(request.data?.jobId || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new HttpsError("invalid-argument", "Missing job.");
  const me = await admin(uid, ["admin", "estimator"]);
  const jobRef = db().doc(`users/${ownerUid}/jobs/${jobId}`);
  const job = (await jobRef.get()).data();
  if (!job || job.orgId !== me.orgId) throw new HttpsError("not-found", "This job could not be found.");

  const change = {};
  if ("salesStatus" in (request.data || {})) {
    const s = request.data.salesStatus;
    if (s !== null && !SALES.includes(s)) throw new HttpsError("invalid-argument", "Unknown status.");
    change.salesStatus = s ?? FieldValue.delete();
  }
  if ("customerId" in (request.data || {})) {
    const c = request.data.customerId;
    if (c !== null) {
      const cust = (await db().doc(`customers/${String(c)}`).get()).data();
      if (!cust || cust.orgId !== me.orgId) throw new HttpsError("invalid-argument", "Pick one of your company's customers.");
    }
    change.customerId = c ?? FieldValue.delete();
  }
  if (!Object.keys(change).length) throw new HttpsError("invalid-argument", "Nothing to change.");
  await jobRef.update(change);
  await db().collection("auditLog").add({
    uid, orgId: me.orgId, action: "job.update", jobId,
    before: { salesStatus: job.salesStatus || null, customerId: job.customerId || null },
    after: { salesStatus: request.data.salesStatus ?? job.salesStatus ?? null, customerId: request.data.customerId ?? job.customerId ?? null },
    at: Date.now(),
  });
  return { ok: true };
});

/** Storage the company's shared jobs use (photos, audio, finals), in bytes. Admins only. */
exports.orgStorageUsage = onCall(piccoloCallable({ timeoutSeconds: 120 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const me = await admin(uid);
  const bucket = getStorage().bucket();
  const size = async (path) => {
    if (!path) return 0;
    try {
      const [meta] = await bucket.file(path).getMetadata();
      return Number(meta.size) || 0;
    } catch {
      return 0; // expired or deleted
    }
  };
  const totals = { photos: 0, audio: 0, finals: 0, jobs: 0 };
  const jobs = await db().collectionGroup("jobs").where("orgId", "==", me.orgId).get();
  for (const j of jobs.docs) {
    totals.jobs++;
    const owner = j.ref.parent.parent.id;
    const stops = await db().collection(`users/${owner}/stops`).where("jobId", "==", j.id).get();
    for (const s of stops.docs) {
      totals.photos += await size(s.get("photoPath"));
      totals.audio += await size(s.get("audioPath"));
    }
    const [files] = await bucket.getFiles({ prefix: `finals/${owner}/${j.id}/` });
    for (const f of files) totals.finals += Number(f.metadata.size) || 0;
  }
  return { ...totals, bytes: totals.photos + totals.audio + totals.finals };
});

// ---------- activity log: settings changes and exports ----------
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

/** Company settings are saved by the app (rules allow the admin); this records the change. */
exports.auditOrgSettings = onDocumentUpdated("orgs/{orgId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (JSON.stringify([before.name, before.defaults]) === JSON.stringify([after.name, after.defaults])) return;
  await db().collection("auditLog").add({
    uid: null, orgId: event.params.orgId, action: "org.settings",
    before: { name: before.name, defaults: before.defaults || {} }, after: { name: after.name, defaults: after.defaults || {} }, at: Date.now(),
  });
});

/** The app reports each Piccolo export (files are built on the phone). */
exports.recordExport = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const ownerUid = ownerOf(request);
  const jobId = String(request.data?.jobId || "");
  const what = String(request.data?.what || "").slice(0, 40);
  const version = request.data?.version ? String(request.data.version).slice(0, 10) : "draft";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new HttpsError("invalid-argument", "Missing job.");
  const job = (await db().doc(`users/${ownerUid}/jobs/${jobId}`).get()).data();
  if (!job) throw new HttpsError("not-found", "This job could not be found.");
  if (ownerUid !== uid) {
    const me = (await db().doc(`users/${uid}`).get()).data();
    if (!job.orgId || me?.orgId !== job.orgId || me?.status !== "active") throw new HttpsError("not-found", "This job could not be found.");
  }
  await db().collection("auditLog").add({ uid, orgId: job.orgId || null, action: "piccolo.export", jobId, after: { what, version }, at: Date.now() });
  return { ok: true };
});
