// Guest tests: 7-day expiry, clearing it on sign-in, daily cleanup, merging a guest into an
// existing account, the "Try Piccolo" sample job, and the global AI cap.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { signInAnonymously, signInWithCredential, linkWithCredential } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from "firebase/firestore";
import { ref, uploadBytes, getMetadata } from "firebase/storage";
import { phone, personal, google, mail, rejects, blocked, closeAll } from "./emulator.js";

// The cleanup runs on a schedule; tests call it directly with the Admin SDK on the emulators
const fnRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: adminInit, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) adminInit({ projectId: "demo-pictalk", storageBucket: "demo-pictalk.appspot.com" });
const { getFirestore: adminDb } = fnRequire("firebase-admin/firestore");
const { getAuth: adminAuth } = fnRequire("firebase-admin/auth");
const { runCleanup } = fnRequire("./guests.js");

after(closeAll);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = async (p, path) => (await getDoc(doc(p.db, path))).data();
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(250);
  }
}

async function guest() {
  const g = phone();
  await signInAnonymously(g.auth);
  await g.call("ensureProfile");
  return g;
}

// A finished job with one stop whose photo is in Storage
async function jobWithPhoto(p, jobId) {
  const uid = p.auth.currentUser.uid;
  await setDoc(doc(p.db, `users/${uid}/jobs/${jobId}`), { name: "Job", status: "finished", startedAt: 1, endedAt: 2 });
  const photoPath = `photos/${uid}/${jobId}-s1.jpg`;
  await uploadBytes(ref(p.storage, photoPath), new Uint8Array([255, 216, 255, 217]), { contentType: "image/jpeg" });
  await setDoc(doc(p.db, `users/${uid}/stops/${jobId}-s1`), {
    jobId, note: "", photoPath, audioPath: null, status: "transcribed", transcript: "Camera on the north wall.", clientCreatedAt: 5,
  });
  return { uid, photoPath };
}

test("guest jobs expire in 7 days; signed-in jobs don't; the app can't change it", async () => {
  const g = await guest();
  const { uid } = await jobWithPhoto(g, "gx1");
  const job = await waitFor(async () => (await read(g, `users/${uid}/jobs/gx1`))?.expiresAt && read(g, `users/${uid}/jobs/gx1`));
  const days = (job.expiresAt - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7, `expires in ${days} days`);
  await blocked(updateDoc(doc(g.db, `users/${uid}/jobs/gx1`), { expiresAt: Date.now() + 365 * 86400000 }));
  await blocked(setDoc(doc(g.db, `users/${uid}/jobs/gx2`), { name: "Job", status: "open", startedAt: 1, expiresAt: 9e15 }));

  const p = await personal("keeps");
  const pu = p.auth.currentUser.uid;
  await setDoc(doc(p.db, `users/${pu}/jobs/px1`), { name: "Job", status: "open", startedAt: 1 });
  await sleep(2000);
  assert.equal((await read(p, `users/${pu}/jobs/px1`)).expiresAt, undefined);

  // Saving the work clears the expiry on the same uid
  await linkWithCredential(g.auth.currentUser, google(mail("saver")));
  await g.call("ensureProfile");
  assert.equal((await read(g, `users/${uid}/jobs/gx1`)).expiresAt, undefined);
});

test("daily cleanup deletes expired guest jobs with their stops and files, and nothing else", async () => {
  const g = await guest();
  const { uid, photoPath } = await jobWithPhoto(g, "old1");
  await waitFor(async () => (await read(g, `users/${uid}/jobs/old1`))?.expiresAt);
  await adminDb().doc(`users/${uid}/jobs/old1`).update({ expiresAt: Date.now() - 1000 }); // a week went by

  // A signed-in user's job with a stale expiry is kept (and the expiry cleared)
  const p = await personal("safe");
  const { uid: pu } = await jobWithPhoto(p, "keep1");
  await adminDb().doc(`users/${pu}/jobs/keep1`).update({ expiresAt: Date.now() - 1000 });

  const result = await runCleanup();
  assert.ok(result.deleted >= 1 && result.kept >= 1, JSON.stringify(result));
  assert.equal((await adminDb().doc(`users/${uid}/jobs/old1`).get()).exists, false);
  assert.equal((await adminDb().doc(`users/${uid}/stops/old1-s1`).get()).exists, false);
  await assert.rejects(getMetadata(ref(g.storage, photoPath)));
  assert.ok((await adminDb().doc(`users/${pu}/jobs/keep1`).get()).exists);
  assert.equal((await adminDb().doc(`users/${pu}/jobs/keep1`).get()).get("expiresAt"), undefined);
});

test("a guest with jobs signing into an existing account: the jobs move in", async () => {
  const owner = await personal("merger");
  const ownerUid = owner.auth.currentUser.uid;

  const g = await guest();
  const guestUid = g.auth.currentUser.uid;
  await jobWithPhoto(g, "mj1");
  await waitFor(async () => (await read(g, `users/${guestUid}/jobs/mj1`))?.expiresAt);

  // What the app does: keep the guest's token, sign in to the existing account, then merge
  const guestToken = await g.auth.currentUser.getIdToken();
  await rejects(g.call("mergeGuestIntoAccount", { guestToken }), "failed-precondition"); // still the guest
  await signInWithCredential(g.auth, google(mail("merger")));
  assert.equal(g.auth.currentUser.uid, ownerUid);
  const r = await g.call("mergeGuestIntoAccount", { guestToken });
  assert.deepEqual(r, { jobs: 1, stops: 1 });

  const job = await read(g, `users/${ownerUid}/jobs/mj1`);
  assert.ok(job && job.expiresAt === undefined, "moved, and no longer expiring");
  const stop = await read(g, `users/${ownerUid}/stops/mj1-s1`);
  assert.equal(stop.photoPath, `photos/${ownerUid}/mj1-s1.jpg`);
  assert.ok(await getMetadata(ref(g.storage, stop.photoPath)));
  assert.equal(stop.status, "transcribed", "not transcribed again");
  assert.equal((await adminDb().doc(`users/${guestUid}/jobs/mj1`).get()).exists, false);
  await assert.rejects(adminAuth().getUser(guestUid), "guest account removed");
  assert.deepEqual(await g.call("mergeGuestIntoAccount", { guestToken }), { jobs: 0, stops: 0 }, "running again is harmless");

  // A signed-in account can't be "merged" this way
  const other = await personal("notguest");
  const notGuestToken = await other.auth.currentUser.getIdToken();
  await rejects(g.call("mergeGuestIntoAccount", { guestToken: notGuestToken }), "permission-denied");
  await rejects(g.call("mergeGuestIntoAccount", { guestToken: "nonsense" }), "unauthenticated");
});

test("Try Piccolo: signed-in only; a sample job with its own draft allowance that still expires", async () => {
  await rejects((await guest()).call("createDemoJob"), "permission-denied");
  const g = await personal("tryer");
  const uid = g.auth.currentUser.uid;
  const { jobId, created } = await g.call("createDemoJob");
  assert.equal(created, true);
  assert.deepEqual(await g.call("createDemoJob"), { jobId, created: false }, "one sample at a time");
  const job = await read(g, `users/${uid}/jobs/${jobId}`);
  assert.equal(job.isDemo, true);
  assert.equal(job.status, "finished");
  assert.ok(job.expiresAt > Date.now());
  const stops = await getDocs(query(collection(g.db, `users/${uid}/stops`), where("jobId", "==", jobId)));
  assert.equal(stops.size, 4);
  assert.match((await read(g, `users/${uid}/jobs/${jobId}/wrapUpNotes/customer`)).text, /after 5 pm/);

  // Each stop has its sample photo in the user's own photos/ folder
  for (const d of stops.docs) {
    assert.ok(d.get("photoPath")?.startsWith(`photos/${uid}/${jobId}-s`) && d.get("photoPath").endsWith(".jpg"));
    assert.ok(await getMetadata(ref(g.storage, d.get("photoPath"))));
  }

  await g.call("draftPiccolo", { jobId });
  // The sample quote comes out complete: every line priced, sample prices marked, sample settings
  const w = await read(g, `users/${uid}/jobs/${jobId}/working/current`);
  assert.ok(w.bom.length > 0 && w.bom.every((l) => Number.isFinite(l.unitPrice)), "every line priced");
  assert.ok(w.bom.some((l) => l.priceSource === "sample"));
  assert.deepEqual([w.quote.prefix, w.quote.markupPct, w.quote.taxPct], ["SAMPLE-", 15, 9.5]);
  // ...and nothing left to fix: finalizing shows no warnings
  assert.deepEqual(fnRequire("./finalize.js").finalizeWarnings(w), []);
  assert.ok(w.questions.every((q) => q.answered && q.answer.startsWith("Sample answer:")));
  // Sample drafts don't count toward the account's own drafts
  assert.equal((await adminDb().doc(`users/${uid}/aiUsage/${new Date().toISOString().slice(0, 10)}`).get()).get("piccoloDrafts"), undefined);
  await jobWithPhoto(g, "own1");
  await g.call("draftPiccolo", { jobId: "own1" });
  // The sample still expires; the account's own jobs don't
  assert.ok((await read(g, `users/${uid}/jobs/${jobId}`)).expiresAt);
  assert.equal((await read(g, `users/${uid}/jobs/own1`)).expiresAt, undefined);
});

test("the global daily AI cap stops drafts for everyone", async () => {
  const day = adminDb().doc(`usage/global/days/${new Date().toISOString().slice(0, 10)}`);
  const before = (await day.get()).data() || {};
  await day.set({ count: 1000 }, { merge: true }); // at the cap
  try {
    const p = await personal("capped");
    await jobWithPhoto(p, "cap1");
    await rejects(p.call("draftPiccolo", { jobId: "cap1" }), "resource-exhausted");
  } finally {
    await day.set({ count: before.count || 0 }, { merge: true });
  }
  await blocked(getDoc(doc(phone().db, "usage/global/days/x"))); // not readable by the app
});

test("Delete Job: anyone deletes their sample; real jobs only on the app owner's accounts", async () => {
  // A regular account: real jobs are refused, the sample can go
  const reg = await personal("regular");
  const ruid = reg.auth.currentUser.uid;
  await jobWithPhoto(reg, "reg1");
  await rejects(reg.call("deleteJob", { jobId: "reg1" }), "permission-denied");
  assert.equal((await adminDb().doc(`users/${ruid}`).get()).get("canDeleteJobs"), false);
  const { jobId: sample } = await reg.call("createDemoJob");
  assert.deepEqual(await reg.call("deleteJob", { jobId: sample }), { stops: 4 });

  // The owner's account (UNLIMITED_AI_EMAILS; unlimited@example.com in the emulator)
  const p = phone();
  await signInWithCredential(p.auth, google("unlimited@example.com"));
  await p.call("ensureProfile");
  const { uid, photoPath } = await jobWithPhoto(p, "del1");
  assert.equal((await adminDb().doc(`users/${uid}`).get()).get("canDeleteJobs"), true);
  await setDoc(doc(p.db, `users/${uid}/jobs/del2`), { name: "Open", status: "open", startedAt: 1 });
  await rejects(p.call("deleteJob", { jobId: "del2" }), "failed-precondition");
  await rejects(reg.call("deleteJob", { jobId: "del1" }), "not-found");

  assert.deepEqual(await p.call("deleteJob", { jobId: "del1" }), { stops: 1 });
  assert.equal(await read(p, `users/${uid}/jobs/del1`), undefined);
  assert.equal(await read(p, `users/${uid}/stops/del1-s1`), undefined);
  await rejects(getMetadata(ref(p.storage, photoPath)), "storage/object-not-found");
});

test("Try Piccolo replaces an older sample with the current one", async () => {
  const p = await personal("oldsample");
  const uid = p.auth.currentUser.uid;
  const { jobId: first } = await p.call("createDemoJob");
  await adminDb().doc(`users/${uid}/jobs/${first}`).update({ demoVersion: 1 }); // an old sample
  const { jobId: second, created } = await p.call("createDemoJob");
  assert.equal(created, true);
  assert.notEqual(second, first);
  assert.equal(await read(p, `users/${uid}/jobs/${first}`), undefined);
  assert.equal((await read(p, `users/${uid}/jobs/${second}`)).demoVersion, 3);
  await blocked(updateDoc(doc(p.db, `users/${uid}/jobs/${second}`), { demoVersion: 9 }));
});
