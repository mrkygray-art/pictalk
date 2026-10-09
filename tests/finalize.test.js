// Finalize tests: immutable numbered finals with copies of the job's photos and audio,
// warnings before finalizing, guests can't finalize, and nobody can change a final.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { signInAnonymously } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getMetadata, deleteObject } from "firebase/storage";
import { phone, personal, rejects, blocked, closeAll } from "./emulator.js";

after(closeAll);

// A finished job whose stop has a photo and a voice note in Storage
async function seedJob(p, jobId) {
  const uid = p.auth.currentUser.uid;
  await setDoc(doc(p.db, `users/${uid}/jobs/${jobId}`), { name: "Job", status: "finished", startedAt: 1, endedAt: 2, customer: "Acme" });
  const stopId = `${jobId}-s1`;
  const photoPath = `photos/${uid}/${stopId}.jpg`;
  const audioPath = `voice/${uid}/${stopId}.webm`;
  await uploadBytes(ref(p.storage, photoPath), new Uint8Array([255, 216, 255, 217]), { contentType: "image/jpeg" });
  await uploadBytes(ref(p.storage, audioPath), new Uint8Array([26, 69, 223, 163]), { contentType: "audio/webm" });
  // Created without audio first, so the transcription trigger (create only) leaves it alone
  const stopRef = doc(p.db, `users/${uid}/stops/${stopId}`);
  await setDoc(stopRef, { jobId, note: "", photoPath, audioPath: null, status: "transcribed", transcript: "Replace the cracked reader, part HID-R40.", clientCreatedAt: 10 });
  await updateDoc(stopRef, { audioPath });
  return { uid, stopId, photoPath, audioPath };
}

const read = async (p, path) => (await getDoc(doc(p.db, path))).data();

test("finalize saves v1 with copies of the photos and audio, then v2 after edits", async () => {
  const p = await personal("finisher");
  const { uid, audioPath } = await seedJob(p, "fin1");
  await p.call("draftPiccolo", { jobId: "fin1" });

  // Unpriced lines and open questions: the server asks for confirmation first
  await rejects(p.call("finalizePiccolo", { jobId: "fin1" }), "failed-precondition");
  const { version, versionId, media, missing } = await p.call("finalizePiccolo", { jobId: "fin1", acknowledged: true });
  assert.deepEqual([version, versionId, media, missing], [1, "v1", 2, 0]);

  const v1 = await read(p, `users/${uid}/jobs/fin1/finals/v1`);
  assert.equal(v1.job.customer, "Acme");
  assert.ok(v1.bom.length > 0);
  assert.equal(v1.stops[0].words, "Replace the cracked reader, part HID-R40.");
  assert.ok(v1.warningsAcknowledged.some((w) => w.kind === "unpriced"));
  const copied = v1.mediaManifest.map((m) => m.storagePath);
  assert.ok(copied.every((path) => path.startsWith(`finals/${uid}/fin1/v1/`)));
  for (const path of copied) assert.ok(await getMetadata(ref(p.storage, path)), `${path} exists`);

  const job = await read(p, `users/${uid}/jobs/fin1`);
  assert.equal(job.piccoloStatus, "finalized");
  assert.equal(job.latestFinalVersion, 1);

  // The voice note expires from voice/ (5-day rule); the final's copy stays
  await deleteObject(ref(p.storage, audioPath));
  for (const path of copied) assert.ok(await getMetadata(ref(p.storage, path)));

  // Edit and finalize again: v2; v1 is untouched
  const workingPath = `users/${uid}/jobs/fin1/working/current`;
  const w = await read(p, workingPath);
  w.bom = w.bom.map((l) => ({ ...l, unitPrice: 10, priceSource: "user", partNumberStatus: l.partNumber ? "user" : "none", checked: true }));
  w.questions = w.questions.map((q) => ({ ...q, answered: true, answer: "200 ft" }));
  await setDoc(doc(p.db, workingPath), { ...w, updatedAt: Date.now() });
  const second = await p.call("finalizePiccolo", { jobId: "fin1" }); // nothing left to warn about
  assert.equal(second.version, 2);
  assert.equal(second.missing, 1, "the expired voice note is reported, not invented");
  assert.equal((await read(p, `users/${uid}/jobs/fin1/finals/v2`)).bom[0].unitPrice, 10);
  assert.equal((await read(p, `users/${uid}/jobs/fin1/finals/v1`)).bom[0].unitPrice, null);
});

test("finals can't be changed, and only their owner can see them", async () => {
  const p = await personal("keeper");
  const { uid } = await seedJob(p, "fin2");
  await p.call("draftPiccolo", { jobId: "fin2" });
  await p.call("finalizePiccolo", { jobId: "fin2", acknowledged: true });
  await blocked(updateDoc(doc(p.db, `users/${uid}/jobs/fin2/finals/v1`), { bom: [] }));
  await blocked(setDoc(doc(p.db, `users/${uid}/jobs/fin2/finals/v9`), { version: 9 }));
  await blocked(updateDoc(doc(p.db, `users/${uid}/jobs/fin2`), { latestFinalVersion: 0 }));
  await rejects(uploadBytes(ref(p.storage, `finals/${uid}/fin2/v1/fake.jpg`), new Uint8Array([1]), { contentType: "image/jpeg" }), "storage/unauthorized");

  const other = await personal("peeker");
  await blocked(getDoc(doc(other.db, `users/${uid}/jobs/fin2/finals/v1`)));
  const path = (await read(p, `users/${uid}/jobs/fin2/finals/v1`)).mediaManifest[0].storagePath;
  await rejects(getMetadata(ref(other.storage, path)), "storage/unauthorized");

  const { links } = await p.call("piccoloMediaLinks", { jobId: "fin2", versionId: "v1" });
  assert.equal(typeof links, "object"); // empty in the emulator, which can't sign
  await rejects(other.call("piccoloMediaLinks", { jobId: "fin2", versionId: "v1" }), "not-found");
});

test("guests can't draft or finalize (Piccolo needs an account)", async () => {
  const g = phone();
  await signInAnonymously(g.auth);
  await g.call("ensureProfile");
  await seedJob(g, "fin3");
  await rejects(g.call("draftPiccolo", { jobId: "fin3" }), "permission-denied");
  await rejects(g.call("finalizePiccolo", { jobId: "fin3", acknowledged: true }), "permission-denied");
});

test("a job needs a Piccolo version before it can be finalized", async () => {
  const p = await personal("hasty");
  await seedJob(p, "fin4");
  await rejects(p.call("finalizePiccolo", { jobId: "fin4", acknowledged: true }), "failed-precondition");
});
