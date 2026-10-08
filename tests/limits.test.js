// Who may use AI and how much: guests can't use Piccolo; accounts get 10 drafts a day;
// accounts listed in UNLIMITED_AI_EMAILS (functions/.env; the emulator uses functions/.env.local)
// have no daily per-account limit. Per-job limits still apply to everyone.
import { test, after } from "node:test";
import { createRequire } from "node:module";
import { signInAnonymously, signInWithCredential } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { phone, personal, google, rejects, closeAll } from "./emulator.js";

const fnRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: adminInit, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) adminInit({ projectId: "demo-pictalk", storageBucket: "demo-pictalk.appspot.com" });
const { getFirestore: adminDb } = fnRequire("firebase-admin/firestore");
after(closeAll);

const today = () => new Date().toISOString().slice(0, 10);
async function job(p, jobId) {
  const uid = p.auth.currentUser.uid;
  await setDoc(doc(p.db, `users/${uid}/jobs/${jobId}`), { name: "Job", status: "finished", startedAt: 1, endedAt: 2 });
  await setDoc(doc(p.db, `users/${uid}/stops/${jobId}-s1`), {
    jobId, note: "", photoPath: null, audioPath: null, status: "transcribed", transcript: "Swap the reader.", clientCreatedAt: 3,
  });
  return uid;
}

test("guests can't draft or open the sample job", async () => {
  const g = phone();
  await signInAnonymously(g.auth);
  await g.call("ensureProfile");
  await job(g, "lg1");
  await rejects(g.call("draftPiccolo", { jobId: "lg1" }), "permission-denied");
  await rejects(g.call("createDemoJob"), "permission-denied");
});

test("10 drafts a day per account, except accounts on the unlimited list", async () => {
  const p = await personal("daily");
  const uid = await job(p, "ld1");
  await adminDb().doc(`users/${uid}/aiUsage/${today()}`).set({ piccoloDrafts: 10 }, { merge: true });
  await rejects(p.call("draftPiccolo", { jobId: "ld1" }), "resource-exhausted");

  const owner = phone();
  await signInWithCredential(owner.auth, google("unlimited@example.com"));
  await owner.call("ensureProfile");
  const ouid = await job(owner, "lu1");
  await adminDb().doc(`users/${ouid}/aiUsage/${today()}`).set({ piccoloDrafts: 50 }, { merge: true });
  await owner.call("draftPiccolo", { jobId: "lu1" });
  // Per-job limits still apply
  for (let i = 0; i < 4; i++) await owner.call("draftPiccolo", { jobId: "lu1" });
  await rejects(owner.call("draftPiccolo", { jobId: "lu1" }), "resource-exhausted");
});

test("the unlimited list also covers job summaries", async () => {
  const p = await personal("sumdaily");
  const uid = await job(p, "ls1");
  await adminDb().doc(`users/${uid}/aiUsage/${today()}`).set({ count: 20 }, { merge: true });
  await rejects(p.call("generateJobSummary", { jobId: "ls1" }), "resource-exhausted");

  const owner = phone();
  await signInWithCredential(owner.auth, google("unlimited@example.com"));
  const ouid = await job(owner, "ls2");
  await adminDb().doc(`users/${ouid}/aiUsage/${today()}`).set({ count: 20 }, { merge: true });
  await owner.call("generateJobSummary", { jobId: "ls2" });
});
