// Shared team jobs: who sees what, enforced by the rules and functions (not the UI).
//   admin, estimator  everything incl. prices; can draft, edit, finalize a teammate's job
//   field             job, stops, photos, and the price-free work order
//   installer         only the price-free work order, only when assigned
//   other companies   nothing
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { signInWithCredential } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, collectionGroup, query, where, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getMetadata, deleteObject } from "firebase/storage";
import { createRequire } from "node:module";
import { phone, personal, google, mail, rejects, blocked, closeAll } from "./emulator.js";

const sharp = createRequire(import.meta.url)("../functions/node_modules/sharp");

after(closeAll);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(250);
  }
}

let A, E, F, I, O, orgId, owner;
const JOB = "teamjob1";
const read = (p, path) => getDoc(doc(p.db, path)).then((s) => s.data());

async function member(admin, name, role) {
  await admin.call("createInvite", { email: mail(name), role });
  const p = phone();
  await signInWithCredential(p.auth, google(mail(name)));
  await p.call("ensureProfile");
  return p;
}

before(async () => {
  A = await personal("tadmin");
  ({ orgId } = await A.call("createOrg", { name: "Team Co" }));
  E = await member(A, "test", "estimator");
  F = await member(A, "tfield", "field");
  I = await member(A, "tinst", "installer");
  O = await personal("toutsider");
  await O.call("createOrg", { name: "Other Co" });
  owner = A.auth.currentUser.uid;

  // The admin captures a job: it's shared with the team automatically
  await setDoc(doc(A.db, `users/${owner}/jobs/${JOB}`), { name: "Job", status: "finished", startedAt: 1, endedAt: 2, customer: "Acme" });
  const photoPath = `photos/${owner}/${JOB}-s1.jpg`;
  await uploadBytes(ref(A.storage, photoPath), new Uint8Array([255, 216, 255, 217]), { contentType: "image/jpeg" });
  await setDoc(doc(A.db, `users/${owner}/stops/${JOB}-s1`), {
    jobId: JOB, note: "", photoPath, audioPath: null, status: "transcribed", transcript: "Two cameras, model AXP-200.", clientCreatedAt: 5,
  });
  await waitFor(async () => (await read(A, `users/${owner}/jobs/${JOB}`))?.orgId === orgId);
  await waitFor(async () => (await read(A, `users/${owner}/stops/${JOB}-s1`))?.orgId === orgId);
});

test("a team member's new job is shared; each role sees only what it should", async () => {
  const jobPath = `users/${owner}/jobs/${JOB}`;
  assert.equal((await read(E, jobPath)).customer, "Acme");
  assert.equal((await read(F, jobPath)).customer, "Acme");
  await blocked(getDoc(doc(I.db, jobPath))); // not assigned
  await blocked(getDoc(doc(O.db, jobPath))); // another company

  // The team's job list
  const list = await getDocs(query(collectionGroup(E.db, "jobs"), where("orgId", "==", orgId)));
  assert.ok(list.docs.some((d) => d.id === JOB));
  await blocked(getDocs(query(collectionGroup(I.db, "jobs"), where("orgId", "==", orgId))));
  await blocked(getDocs(query(collectionGroup(O.db, "jobs"), where("orgId", "==", orgId))));

  // Stops and photos: field yes, installer and other companies no
  const stopPath = `users/${owner}/stops/${JOB}-s1`;
  assert.ok(await read(F, stopPath));
  await blocked(getDoc(doc(I.db, stopPath)));
  const photo = `photos/${owner}/${JOB}-s1.jpg`;
  assert.ok(await getMetadata(ref(E.storage, photo)));
  assert.ok(await getMetadata(ref(F.storage, photo)));
  await rejects(getMetadata(ref(I.storage, photo)), "storage/unauthorized");
  await rejects(getMetadata(ref(O.storage, photo)), "storage/unauthorized");
});

test("an estimator drafts and prices a teammate's job; field gets the work order without prices", async () => {
  await rejects(F.call("draftPiccolo", { jobId: JOB, ownerUid: owner }), "not-found");
  await rejects(O.call("draftPiccolo", { jobId: JOB, ownerUid: owner }), "not-found");
  const { draftId } = await E.call("draftPiccolo", { jobId: JOB, ownerUid: owner });

  const workingPath = `users/${owner}/jobs/${JOB}/working/current`;
  const w = await read(E, workingPath);
  w.bom[0].unitPrice = 450;
  w.bom[0].unitCost = 300;
  w.bom[0].priceSource = "user";
  await setDoc(doc(E.db, workingPath), { ...w, editedBy: E.auth.currentUser.uid, updatedAt: Date.now() });
  await blocked(setDoc(doc(E.db, workingPath), { ...w, editedBy: owner, updatedAt: Date.now() })); // can't sign as someone else

  await blocked(getDoc(doc(F.db, workingPath)));
  await blocked(getDoc(doc(F.db, `users/${owner}/jobs/${JOB}/drafts/${draftId}`)));
  const viewPath = `users/${owner}/jobs/${JOB}/views/workorder`;
  const view = await waitFor(async () => {
    const v = await read(F, viewPath);
    return v && v.updatedAt >= w.updatedAt && v;
  });
  assert.ok(view.bom.length > 0 && view.workOrder.scope);
  for (const line of view.bom) {
    assert.equal("unitPrice" in line || "unitCost" in line || "priceSource" in line, false, "no prices in the field view");
  }
  await blocked(setDoc(doc(F.db, viewPath), { bom: [] }));
  await blocked(getDoc(doc(I.db, viewPath))); // not assigned yet

  // The estimator can finalize it (stored under the owner)
  const { version } = await E.call("finalizePiccolo", { jobId: JOB, ownerUid: owner, acknowledged: true });
  assert.equal(version, 1);
  assert.equal((await read(E, `users/${owner}/jobs/${JOB}/finals/v1`)).bom[0].unitPrice, 450);
  await blocked(getDoc(doc(F.db, `users/${owner}/jobs/${JOB}/finals/v1`)));
});

test("installers see a job's work order only once an admin assigns them", async () => {
  const iUid = I.auth.currentUser.uid;
  await rejects(E.call("assignJob", { ownerUid: owner, jobId: JOB, assignees: [iUid] }), "permission-denied");
  await rejects(A.call("assignJob", { ownerUid: owner, jobId: JOB, assignees: [O.auth.currentUser.uid] }), "invalid-argument");
  await A.call("assignJob", { ownerUid: owner, jobId: JOB, assignees: [iUid] });

  const mine = await getDocs(query(collectionGroup(I.db, "jobs"), where("orgId", "==", orgId), where("assignedTo", "array-contains", iUid)));
  assert.deepEqual(mine.docs.map((d) => d.id), [JOB]);
  const view = await waitFor(() => read(I, `users/${owner}/jobs/${JOB}/views/workorder`));
  assert.ok(view.bom.every((l) => !("unitPrice" in l)));
  await blocked(getDoc(doc(I.db, `users/${owner}/jobs/${JOB}/working/current`)));
  await blocked(getDoc(doc(I.db, `users/${owner}/stops/${JOB}-s1`)));
});

test("unsharing or turning off a member's access cuts it off", async () => {
  const jobPath = `users/${owner}/jobs/${JOB}`;
  await rejects(E.call("setJobSharing", { jobId: JOB, shared: false }), "not-found"); // only the owner
  await A.call("setJobSharing", { jobId: JOB, shared: false });
  await blocked(getDoc(doc(E.db, jobPath)));
  await blocked(getDoc(doc(F.db, `users/${owner}/stops/${JOB}-s1`)));
  await waitFor(async () => (await read(A, `users/${owner}/jobs/${JOB}/views/workorder`))?.orgId === null);
  await blocked(getDoc(doc(F.db, `users/${owner}/jobs/${JOB}/views/workorder`)));
  await rejects(E.call("draftPiccolo", { jobId: JOB, ownerUid: owner }), "not-found");

  await A.call("setJobSharing", { jobId: JOB, shared: true });
  assert.ok(await read(E, jobPath));
  await A.call("updateMember", { uid: E.auth.currentUser.uid, status: "disabled" });
  await blocked(getDoc(doc(E.db, jobPath)));
  await A.call("updateMember", { uid: E.auth.currentUser.uid, status: "active" });
});

test("personal accounts' jobs stay private", async () => {
  const P = await personal("tprivate");
  const pu = P.auth.currentUser.uid;
  await setDoc(doc(P.db, `users/${pu}/jobs/pj1`), { name: "Job", status: "open", startedAt: 1 });
  await sleep(1500);
  assert.equal((await read(P, `users/${pu}/jobs/pj1`)).orgId, undefined);
  await blocked(getDoc(doc(E.db, `users/${pu}/jobs/pj1`)));
  await rejects(P.call("setJobSharing", { jobId: "pj1", shared: true }), "failed-precondition");
});

test("replacing a stop's photo (Add photo / Replace photo): new file, teammates see it, it gets described again", async () => {
  const stopPath = `users/${owner}/stops/${JOB}-s1`;
  const oldPath = (await read(A, stopPath)).photoPath;
  // What the app does (stopStore uploadPhoto): a new "{stopId}.{time}.ext" file, then the record
  const newPath = `photos/${owner}/${JOB}-s1.${Date.now()}.jpg`;
  const jpeg = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer());
  await rejects(uploadBytes(ref(F.storage, newPath), jpeg, { contentType: "image/jpeg" }), "storage/unauthorized");
  await uploadBytes(ref(A.storage, newPath), jpeg, { contentType: "image/jpeg" });
  await updateDoc(doc(A.db, stopPath), {
    photoPath: newPath, photoDescStatus: "requested", photoDescRequestedAt: Date.now(), photoDescription: null, photoDescEdited: false, photoDescError: null,
  });
  await deleteObject(ref(A.storage, oldPath));
  await blocked(updateDoc(doc(F.db, stopPath), { photoPath: `photos/${owner}/x.jpg` })); // only the owner

  // The team still sees the stop's (new) photo: the part before the first dot is the stop id
  assert.ok(await getMetadata(ref(F.storage, newPath)));
  await rejects(getMetadata(ref(I.storage, newPath)), "storage/unauthorized");
  await rejects(getMetadata(ref(O.storage, newPath)), "storage/unauthorized");
  const stop = await waitFor(async () => {
    const s = await read(A, stopPath);
    return s.photoDescStatus === "described" || s.photoDescStatus === "failed" ? s : null;
  }, 30000);
  assert.equal(stop.photoDescStatus, "described");
  assert.equal(stop.orgId, orgId);
});
