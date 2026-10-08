// Guests (anonymous accounts): 7-day job expiry, daily cleanup, merging a guest into an
// existing account, and the "Try Piccolo" sample job.
//
// Expiry only applies to guest accounts created on or after GUEST_EXPIRY_START (ms). Leave
// it unset in production until Piccolo launches, then set it to the launch time, so guests
// from before (all of today's PicTalk users) are never affected. Unset outside the emulator
// means no expiry at all (fail-safe).
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { piccoloCallable } = require("./budget");
const DEMO = require("./demoJob");

const DAY = 24 * 60 * 60 * 1000;
const GUEST_DAYS = 7;
const db = () => getFirestore();
const isAnon = (user) => user.providerData.length === 0;

function expiryStart() {
  if (process.env.GUEST_EXPIRY_START) return Number(process.env.GUEST_EXPIRY_START);
  return process.env.FUNCTIONS_EMULATOR === "true" ? 0 : Infinity;
}

async function userOrNull(uid) {
  try {
    return await getAuth().getUser(uid);
  } catch (err) {
    if (err.code === "auth/user-not-found") return null;
    throw err;
  }
}

// ---------- expiry ----------

/** A new job by a guest gets expiresAt (7 days). The app can't set or change it (rules). */
exports.setGuestExpiry = onDocumentCreated("users/{uid}/jobs/{jobId}", async (event) => {
  const job = event.data?.data();
  if (!job || job.expiresAt || job.isDemo) return;
  const user = await userOrNull(event.params.uid);
  if (!user || !isAnon(user)) return;
  if (Date.parse(user.metadata.creationTime) < expiryStart()) return; // guests from before launch keep their jobs
  await event.data.ref.update({ expiresAt: Date.now() + GUEST_DAYS * DAY });
});

/** A guest saved their work: their jobs stop expiring (sample jobs still expire). */
async function clearGuestExpiry(uid) {
  const snap = await db().collection(`users/${uid}/jobs`).where("expiresAt", ">", 0).get();
  const batch = db().batch();
  let n = 0;
  for (const d of snap.docs) {
    if (d.get("isDemo")) continue;
    batch.update(d.ref, { expiresAt: FieldValue.delete() });
    n++;
  }
  if (n) await batch.commit();
  return n;
}
exports.clearGuestExpiry = clearGuestExpiry;

// ---------- deleting a job and everything in it ----------

async function deleteFile(bucket, path) {
  if (!path) return;
  await bucket.file(path).delete().catch((err) => {
    if (err.code !== 404) logger.warn("Delete file failed", { path, error: String(err?.message || err) });
  });
}

/** Removes a job, its stops, its photos and audio, its exports, and everything under it. */
async function deleteJobData(uid, jobId) {
  const bucket = getStorage().bucket();
  const jobRef = db().doc(`users/${uid}/jobs/${jobId}`);
  const stops = await db().collection(`users/${uid}/stops`).where("jobId", "==", jobId).get();
  for (const s of stops.docs) {
    await deleteFile(bucket, s.get("photoPath"));
    await deleteFile(bucket, s.get("audioPath"));
    await s.ref.delete();
  }
  for (const note of (await jobRef.collection("wrapUpNotes").get()).docs) {
    for (const seg of note.get("segments") || []) await deleteFile(bucket, seg.audioPath);
  }
  for (const prefix of [`exports/${uid}/${jobId}/`, `finals/${uid}/${jobId}/`]) {
    await bucket.deleteFiles({ prefix }).catch((err) => logger.warn("Delete folder failed", { prefix, error: String(err?.message || err) }));
  }
  await db().recursiveDelete(jobRef);
  return stops.size;
}

/**
 * Delete guest jobs (and sample jobs) whose expiresAt has passed. A job whose owner has
 * since signed in is kept and its expiry cleared. Returns counts (exported for tests).
 */
async function runCleanup(now = Date.now()) {
  const due = await db().collectionGroup("jobs").where("expiresAt", "<", now).limit(500).get();
  const result = { deleted: 0, kept: 0, stops: 0 };
  for (const d of due.docs) {
    const uid = d.ref.parent.parent.id;
    const user = d.get("isDemo") ? null : await userOrNull(uid);
    if (user && !isAnon(user)) {
      await d.ref.update({ expiresAt: FieldValue.delete() });
      result.kept++;
      continue;
    }
    result.stops += await deleteJobData(uid, d.id);
    result.deleted++;
  }
  if (result.deleted || result.kept) logger.info("Guest cleanup", result);
  return result;
}
exports.runCleanup = runCleanup;

exports.cleanupGuestJobs = onSchedule({ schedule: "every day 03:30", timeZone: "America/Los_Angeles", timeoutSeconds: 540 }, async () => {
  await runCleanup();
});

// ---------- merging a guest into an existing account ----------

// photos/{guest}/x.jpg -> photos/{target}/x.jpg (same for voice/ and wrap-up audio)
const movePath = (path, from, to, oldJob, newJob) =>
  path ? path.replace(`/${from}/`, `/${to}/`).replace(`wrapup-${oldJob}-`, `wrapup-${newJob}-`) : path;

async function copyFile(bucket, from, to) {
  if (!from || from === to) return from;
  try {
    const [exists] = await bucket.file(from).exists();
    if (!exists) return from; // expired voice note: keep the path; the app shows "expired"
    await bucket.file(from).copy(bucket.file(to));
    return to;
  } catch (err) {
    logger.warn("Merge: file copy failed", { from, error: String(err?.message || err) });
    return from;
  }
}

/** Copy a collection (and the collections under it) from one place to another. */
async function copyTree(fromRef, toRef, fix = (d) => d) {
  for (const d of (await fromRef.get()).docs) {
    await toRef.doc(d.id).set(fix(d.data(), d.id));
    for (const sub of await d.ref.listCollections()) await copyTree(sub, toRef.doc(d.id).collection(sub.id), fix);
  }
}

/**
 * A guest with jobs signed into an account that already existed. The app signs in to that
 * account and sends the guest's ID token as proof it was that guest. Moves the guest's jobs,
 * stops, drafts, and files into the account (same ids), then removes the guest.
 */
exports.mergeGuestIntoAccount = onCall(piccoloCallable({ timeoutSeconds: 540, memory: "1GiB" }), async (request) => {
  const to = request.auth?.uid;
  if (!to) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const target = await getAuth().getUser(to);
  if (isAnon(target)) throw new HttpsError("failed-precondition", "Sign in to the account to move the jobs into.");
  let guestToken;
  try {
    guestToken = await getAuth().verifyIdToken(String(request.data?.guestToken || ""));
  } catch (err) {
    if (err.code === "auth/user-not-found") return { jobs: 0, stops: 0 }; // already merged (guest removed)
    logger.warn("Merge: guest token rejected", { error: String(err?.message || err) });
    throw new HttpsError("unauthenticated", "That guest session has expired, so its jobs can't be moved.");
  }
  const from = guestToken.uid;
  if (from === to) return { jobs: 0, stops: 0 };
  const guest = await userOrNull(from);
  if (!guest) return { jobs: 0, stops: 0 }; // already merged
  if (!isAnon(guest)) throw new HttpsError("permission-denied", "Only a guest's jobs can be moved this way.");

  const bucket = getStorage().bucket();
  const now = Date.now();
  const targetOpen = !(await db().collection(`users/${to}/jobs`).where("status", "==", "open").limit(1).get()).empty;
  const jobs = (await db().collection(`users/${from}/jobs`).get()).docs.filter((d) => !d.get("isDemo"));
  const newId = {};
  for (const j of jobs) {
    const exists = (await db().doc(`users/${to}/jobs/${j.id}`).get()).exists;
    newId[j.id] = exists ? `${j.id}-guest` : j.id;
  }

  // Stops first (with their files), then jobs, so a job never points at missing stops
  let stopCount = 0;
  for (const s of (await db().collection(`users/${from}/stops`).get()).docs) {
    const stop = s.data();
    const jobId = newId[stop.jobId] || stop.jobId;
    const photoPath = await copyFile(bucket, stop.photoPath, movePath(stop.photoPath, from, to));
    const audioPath = await copyFile(bucket, stop.audioPath, movePath(stop.audioPath, from, to));
    await db().doc(`users/${to}/stops/${s.id}`).set({ ...stop, jobId, photoPath: photoPath ?? null, audioPath: audioPath ?? null });
    stopCount++;
  }
  for (const j of jobs) {
    const jobId = newId[j.id];
    const job = { ...j.data() };
    delete job.expiresAt;
    // At most one open job per account: the account's own open job wins
    if (job.status === "open" && targetOpen) Object.assign(job, { status: "finished", endedAt: job.endedAt || now });
    const toRef = db().doc(`users/${to}/jobs/${jobId}`);
    await toRef.set(job);
    for (const sub of await j.ref.listCollections()) {
      const notesFix = async (data) => {
        if (sub.id !== "wrapUpNotes" || !Array.isArray(data.segments)) return data;
        const segments = [];
        for (const seg of data.segments) {
          segments.push({ ...seg, audioPath: (await copyFile(bucket, seg.audioPath, movePath(seg.audioPath, from, to, j.id, jobId))) ?? null });
        }
        return { ...data, segments, createdBy: to };
      };
      for (const d of (await sub.get()).docs) {
        let data = await notesFix(d.data());
        if (sub.id === "working") data = { ...data, editedBy: to };
        await toRef.collection(sub.id).doc(d.id).set(data);
        for (const subsub of await d.ref.listCollections()) await copyTree(subsub, toRef.collection(sub.id).doc(d.id).collection(subsub.id));
      }
    }
  }

  // Remove the guest: its jobs (and their files), any leftover stops, profile, and account
  for (const j of (await db().collection(`users/${from}/jobs`).get()).docs) await deleteJobData(from, j.id);
  for (const s of (await db().collection(`users/${from}/stops`).get()).docs) {
    await deleteFile(bucket, s.get("photoPath"));
    await deleteFile(bucket, s.get("audioPath"));
    await s.ref.delete();
  }
  await db().recursiveDelete(db().doc(`users/${from}`));
  await getAuth().deleteUser(from).catch((err) => logger.warn("Merge: deleting guest failed", { from, error: String(err?.message || err) }));
  const profile = (await db().doc(`users/${to}`).get()).data();
  await db().collection("auditLog").add({
    uid: to, orgId: profile?.orgId || null, action: "account.mergeGuest", after: { guest: from, jobs: jobs.length, stops: stopCount }, at: now,
  });
  logger.info("Guest merged", { from, to, jobs: jobs.length, stops: stopCount });
  return { jobs: jobs.length, stops: stopCount };
});

// ---------- "Try Piccolo" sample job ----------

/** Creates (or returns) this user's sample job: a finished site walk ready to draft. */
exports.createDemoJob = onCall(piccoloCallable({ timeoutSeconds: 60 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const now = Date.now();
  const existing = (await db().collection(`users/${uid}/jobs`).where("isDemo", "==", true).get()).docs.find((d) => (d.get("expiresAt") || 0) > now);
  if (existing) return { jobId: existing.id, created: false };

  const jobId = `demo-${now.toString(36)}`;
  const start = now - 60 * 60 * 1000;
  const batch = db().batch();
  const jobRef = db().doc(`users/${uid}/jobs/${jobId}`);
  batch.set(jobRef, {
    name: "Sample site walk",
    customer: DEMO.customer,
    location: DEMO.location,
    address: null,
    lat: null,
    lng: null,
    status: "finished",
    startedAt: start,
    endedAt: start + 40 * 60 * 1000,
    lastStopAt: start + 35 * 60 * 1000,
    isDemo: true,
    expiresAt: now + GUEST_DAYS * DAY,
  });
  DEMO.stops.forEach((s, i) => {
    batch.set(db().doc(`users/${uid}/stops/${jobId}-s${i + 1}`), {
      jobId,
      note: "",
      photoPath: null,
      audioPath: null,
      status: "transcribed",
      transcript: s.words,
      photoDescStatus: "described",
      photoDescription: s.photo,
      photoDescEdited: false,
      clientCreatedAt: start + (i + 1) * 8 * 60 * 1000,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  for (const [type, text] of [["field", DEMO.fieldNotes], ["customer", DEMO.customerComments]]) {
    batch.set(jobRef.collection("wrapUpNotes").doc(type), { type, text, edited: true, segments: [], createdBy: uid, createdAt: now, updatedAt: now });
  }
  await batch.commit();
  return { jobId, created: true };
});
