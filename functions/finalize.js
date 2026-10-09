// finalizePiccolo: saves the user's current Piccolo version (work order, BOM, quote,
// questions) as an immutable, numbered final (v1, v2, …) with the job's summary, notes, and
// words, and copies every photo and voice recording to finals/{uid}/{jobId}/v{n}/. Voice
// files under voice/ are deleted after 5 days by a Storage lifecycle rule; the copies are not,
// so a final keeps the full record (picture, audio, text). It also records what changed since
// the AI's draft (editDiff) and adds the final's lines to what later drafts learn from.
//
// piccoloMediaLinks: short-lived signed links to a final's media, for the JSON export.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { piccoloCallable } = require("./budget");
const { piccoloAccess, ownerOf } = require("./teams");
const { diffDraft, learnFromFinal } = require("./learning");

const LINK_DAYS = 7;
const db = () => getFirestore();
const stopWords = (s) => (s.editedTranscript ?? s.transcript ?? "").trim();
const photoWords = (s) => (s.photoDescStatus === "described" ? (s.photoDescription || "").trim() : "");
const ext = (path) => String(path).match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || "bin";

/** What to double-check before finalizing. The app shows the same list (piccoloStore). */
function finalizeWarnings(working) {
  const bom = working?.bom || [];
  const warnings = [];
  const unpriced = bom.filter((l) => !Number.isFinite(l.unitPrice)).length;
  const verify = bom.filter((l) => l.partNumberStatus === "ai_suggested").length;
  const estimates = bom.filter((l) => l.priceSource === "ai_estimate").length;
  const inferred = bom.filter((l) => l.source?.basis === "inferred" && !l.checked).length;
  const open = (working?.questions || []).filter((q) => !q.answered).length;
  if (unpriced) warnings.push({ kind: "unpriced", count: unpriced });
  if (verify) warnings.push({ kind: "verify", count: verify });
  if (estimates) warnings.push({ kind: "estimate", count: estimates });
  if (inferred) warnings.push({ kind: "inferred", count: inferred });
  if (open) warnings.push({ kind: "questions", count: open });
  return warnings;
}

async function tierOf(uid) {
  const profile = (await db().doc(`users/${uid}`).get()).data();
  if (profile?.tier) return profile;
  const user = await getAuth().getUser(uid);
  return { tier: user.providerData.length ? "personal" : "guest" };
}

/** Copy one stored file into the final's folder. Returns the new path, or null if it's gone. */
async function keep(bucket, from, to) {
  if (!from) return null;
  try {
    const src = bucket.file(from);
    const [exists] = await src.exists();
    if (!exists) return null;
    await src.copy(bucket.file(to));
    return to;
  } catch (err) {
    logger.warn("Finalize: media copy failed", { from, error: String(err?.message || err) });
    return null;
  }
}

exports.finalizeWarnings = finalizeWarnings;

exports.finalizePiccolo = onCall(piccoloCallable({ timeoutSeconds: 300, memory: "512MiB" }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const jobId = String(request.data?.jobId || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new HttpsError("invalid-argument", "Missing job.");
  const profile = await tierOf(uid);
  if (profile.tier === "guest") {
    throw new HttpsError("permission-denied", "Save your work (sign in) to finalize. Guests can still export a DEMO copy.");
  }

  // The caller's own job, or a teammate's job shared with the caller's company (admin/estimator)
  const owner = ownerOf(request);
  const job = await piccoloAccess(uid, owner, jobId);
  const jobRef = db().doc(`users/${owner}/jobs/${jobId}`);
  const workingSnap = await jobRef.collection("working").doc("current").get();
  if (!workingSnap.exists) throw new HttpsError("failed-precondition", "Draft this job in Piccolo first.");
  const working = workingSnap.data();
  const warnings = finalizeWarnings(working);
  if (warnings.length && request.data?.acknowledged !== true) {
    throw new HttpsError("failed-precondition", "Some lines still need checking.", { warnings });
  }

  // Reserve the next version number first, so two taps can't make the same version
  const version = await db().runTransaction(async (tx) => {
    const n = ((await tx.get(jobRef)).get("latestFinalVersion") || 0) + 1;
    tx.update(jobRef, { latestFinalVersion: n });
    return n;
  });
  const versionId = `v${version}`;
  const folder = `finals/${owner}/${jobId}/${versionId}`;

  const stops = (await db().collection(`users/${owner}/stops`).where("jobId", "==", jobId).get()).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.clientCreatedAt || 0) - (b.clientCreatedAt || 0));
  const notes = Object.fromEntries((await jobRef.collection("wrapUpNotes").get()).docs.map((d) => [d.id, d.data()]));
  const summaryDoc = (await jobRef.collection("ai").doc("summary").get()).data();

  // Copy the media (photos, stop voice notes, wrap-up recordings)
  const bucket = getStorage().bucket();
  const mediaManifest = [];
  for (const s of stops) {
    if (s.photoPath) {
      const path = await keep(bucket, s.photoPath, `${folder}/photo-${s.id}.${ext(s.photoPath)}`);
      mediaManifest.push({ type: "photo", stopId: s.id, storagePath: path, originalPath: s.photoPath, missing: !path });
    }
    if (s.audioPath) {
      const path = await keep(bucket, s.audioPath, `${folder}/voice-${s.id}.${ext(s.audioPath)}`);
      mediaManifest.push({ type: "audio", stopId: s.id, storagePath: path, originalPath: s.audioPath, missing: !path });
    }
  }
  for (const [type, note] of Object.entries(notes)) {
    for (const [i, seg] of (note.segments || []).entries()) {
      if (!seg.audioPath) continue;
      const path = await keep(bucket, seg.audioPath, `${folder}/wrapup-${type}-${i + 1}.${ext(seg.audioPath)}`);
      mediaManifest.push({ type: "audio", note: type, storagePath: path, originalPath: seg.audioPath, missing: !path });
    }
  }

  // What changed since the AI's draft this version started from
  const draft = working.draftId ? (await jobRef.collection("drafts").doc(working.draftId).get()).data() : null;
  const editDiff = draft?.aiOriginal ? diffDraft(draft.aiOriginal, working) : null;
  const orgId = job.orgId || profile.orgId || null;

  const now = Date.now();
  const final = {
    version,
    finalizedAt: now,
    finalizedBy: uid,
    finalizedByName: profile.displayName || profile.email || null,
    createdAt: now,
    createdBy: uid,
    orgId,
    basedOnDraftId: working.draftId || null,
    draftVersion: working.draftVersion || null,
    job: {
      name: job.name || null,
      customer: job.customer || null,
      location: job.location || null,
      startedAt: job.startedAt || null,
      endedAt: job.endedAt || null,
    },
    workOrder: working.workOrder,
    bom: working.bom,
    quote: working.quote,
    questions: working.questions || [],
    summary: typeof summaryDoc?.summary === "string" ? summaryDoc.summary : null,
    notes: { field: (notes.field?.text || "").trim() || null, customer: (notes.customer?.text || "").trim() || null },
    stops: stops.map((s, i) => ({ id: s.id, index: i + 1, place: s.place || null, words: stopWords(s) || null, photoDescription: photoWords(s) || null })),
    mediaManifest,
    warningsAcknowledged: warnings,
    editDiff,
  };
  const batch = db().batch();
  batch.set(jobRef.collection("finals").doc(versionId), final);
  batch.update(jobRef, { piccoloStatus: "finalized", finalizedAt: now });
  batch.set(db().collection("auditLog").doc(), {
    uid, orgId: final.orgId, action: "piccolo.finalize", jobId, after: { version, lines: final.bom.length, warnings: warnings.length }, at: now,
  });
  await batch.commit();
  logger.info("Piccolo finalized", { uid, jobId, version, media: mediaManifest.length });

  // Remember the final's lines for later drafts (the final is already saved, so a failure here only logs)
  try {
    const defaults = orgId ? (await db().doc(`orgs/${orgId}`).get()).get("defaults") || {} : {};
    await learnFromFinal({ orgId: job.orgId || null, ownerUid: owner, job, defaults, bom: working.bom, diff: editDiff, at: now });
  } catch (err) {
    logger.warn("Piccolo: couldn't record learning", { uid, jobId, error: String(err?.message || err) });
  }
  return { version, versionId, media: mediaManifest.length, missing: mediaManifest.filter((m) => m.missing).length };
});

exports.piccoloMediaLinks = onCall(piccoloCallable({ timeoutSeconds: 60 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const jobId = String(request.data?.jobId || "");
  const versionId = String(request.data?.versionId || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId) || !/^v\d{1,4}$/.test(versionId)) throw new HttpsError("invalid-argument", "Missing job or version.");
  const owner = ownerOf(request);
  await piccoloAccess(uid, owner, jobId);
  const final = (await db().doc(`users/${owner}/jobs/${jobId}/finals/${versionId}`).get()).data();
  if (!final) throw new HttpsError("not-found", "That final version could not be found.");
  const bucket = getStorage().bucket();
  const expires = Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000;
  const links = {};
  for (const m of final.mediaManifest || []) {
    if (!m.storagePath) continue;
    try {
      const [url] = await bucket.file(m.storagePath).getSignedUrl({ action: "read", expires });
      links[m.storagePath] = url;
    } catch (err) {
      // Signing needs the "Service Account Token Creator" role in production; the emulator can't sign
      logger.warn("Piccolo: couldn't sign a media link", { path: m.storagePath, error: String(err?.message || err) });
    }
  }
  return { links, expiresAt: Object.keys(links).length ? expires : null };
});
