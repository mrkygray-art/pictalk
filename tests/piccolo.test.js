// Piccolo draft tests: the real draftPiccolo function in the emulator (with the free
// stand-in model, PICTALK_FAKE_AI=1), its guardrails, limits, and the rules around drafts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from "firebase/firestore";
import { personal, rejects, blocked, closeAll } from "./emulator.js";

const { postProcess } = createRequire(import.meta.url)("../functions/piccolo.js");

after(closeAll);

// A finished job with two transcribed stops and field notes, written the way the app does
async function seedJob(p, jobId, { status = "finished", stops = true } = {}) {
  const uid = p.auth.currentUser.uid;
  await setDoc(doc(p.db, `users/${uid}/jobs/${jobId}`), {
    name: "Job", status, startedAt: 1, endedAt: 2, customer: "Acme Corp", location: "Main office",
  });
  if (!stops) return uid;
  const stop = (id, words, at) =>
    setDoc(doc(p.db, `users/${uid}/stops/${jobId}-${id}`), {
      jobId, note: "", photoPath: null, audioPath: null, status: "transcribed", transcript: words, clientCreatedAt: at,
    });
  await stop("s1", "Replace the card reader at the back door, it is cracked", 10);
  await stop("s2", "Customer wants 4 cameras AXP-200 on the north wall", 20);
  await setDoc(doc(p.db, `users/${uid}/jobs/${jobId}/wrapUpNotes/field`), {
    type: "field", text: "Work has to happen after 6 pm.", edited: true, createdBy: uid,
  });
  return uid;
}

const read = async (p, path) => (await getDoc(doc(p.db, path))).data();

test("a finished job becomes a draft and the first editable copy", async () => {
  const p = await personal("drafter");
  const uid = await seedJob(p, "jobA");
  const { draftId, version } = await p.call("draftPiccolo", { jobId: "jobA" });
  assert.equal(version, 1);

  const draft = await read(p, `users/${uid}/jobs/jobA/drafts/${draftId}`);
  assert.equal(draft.model, "emulator-stand-in");
  assert.equal(draft.promptVersion, "piccolo-draft-v3");
  assert.deepEqual(draft.aiOriginal.bom, draft.bom, "aiOriginal keeps what the AI produced");
  assert.equal(draft.sourceSnapshot.fieldNotes, "Work has to happen after 6 pm.");

  const working = await read(p, `users/${uid}/jobs/jobA/working/current`);
  assert.equal(working.draftId, draftId);
  const [reader, cameras, labor] = working.bom;
  // Guardrails: a part number nobody said is "verify"; one that was said is the user's
  assert.equal(reader.partNumber, "DEMO-4MP-DOME");
  assert.equal(reader.partNumberStatus, "ai_suggested");
  assert.equal(cameras.partNumber, "AXP-200");
  assert.equal(cameras.partNumberStatus, "user");
  assert.equal(cameras.qty, 4);
  assert.equal(labor.category, "labor");
  for (const ln of working.bom) {
    assert.equal(ln.unitPrice, null, "prices stay blank");
    assert.equal(ln.priceSource, "none");
    assert.ok(ln.source.stopIds.length, "every line cites a source");
  }
  assert.ok(working.questions.length, "gaps come back as questions");

  const job = await read(p, `users/${uid}/jobs/jobA`);
  assert.equal(job.piccoloStatus, "drafted");
  assert.equal(job.latestDraftId, draftId);
  assert.equal(job.piccoloDraftCount, 1);
});

test("re-drafting makes a new version and never replaces the user's copy", async () => {
  const p = await personal("redrafter");
  const uid = await seedJob(p, "jobB");
  const first = await p.call("draftPiccolo", { jobId: "jobB" });
  // The user edits their copy
  const workingPath = `users/${uid}/jobs/jobB/working/current`;
  const working = await read(p, workingPath);
  working.bom[0].description = "Edited by me";
  working.bom[0].unitPrice = 125.5;
  await setDoc(doc(p.db, workingPath), { ...working, reviewedDraftVersion: 1, updatedAt: Date.now() });
  await blocked(setDoc(doc(p.db, workingPath), { ...working, secret: true, updatedAt: Date.now() })); // only known fields

  const second = await p.call("draftPiccolo", { jobId: "jobB" });
  assert.equal(second.version, 2);
  const after2 = await read(p, workingPath);
  assert.equal(after2.draftId, first.draftId);
  assert.equal(after2.bom[0].description, "Edited by me");
  assert.equal((await read(p, `users/${uid}/jobs/jobB`)).latestDraftId, second.draftId);
  assert.equal((await getDocs(collection(p.db, `users/${uid}/jobs/jobB/drafts`))).size, 2);
});

test("drafts are read-only; the job's draft counter can't be reset by the app", async () => {
  const p = await personal("tamperer");
  const uid = await seedJob(p, "jobC");
  const { draftId } = await p.call("draftPiccolo", { jobId: "jobC" });
  await blocked(updateDoc(doc(p.db, `users/${uid}/jobs/jobC/drafts/${draftId}`), { model: "x" }));
  await blocked(setDoc(doc(p.db, `users/${uid}/jobs/jobC/drafts/fake`), { version: 9 }));
  await blocked(updateDoc(doc(p.db, `users/${uid}/jobs/jobC`), { piccoloDraftCount: 0 }));
  await updateDoc(doc(p.db, `users/${uid}/jobs/jobC`), { customer: "Still editable" }); // normal edits still work
  const w = await read(p, `users/${uid}/jobs/jobC/working/current`);
  await blocked(setDoc(doc(p.db, `users/${uid}/jobs/jobC/working/current`), { ...w, editedBy: "someone-else" }));

  const other = await personal("snoop");
  await blocked(getDoc(doc(other.db, `users/${uid}/jobs/jobC/drafts/${draftId}`)));
  await blocked(getDoc(doc(other.db, `users/${uid}/jobs/jobC/working/current`)));
  await rejects(other.call("draftPiccolo", { jobId: "jobC" }), "not-found"); // only ever looks in the caller's own jobs
});

test("only finished jobs with something in them can be drafted", async () => {
  const p = await personal("early");
  await seedJob(p, "open1", { status: "open" });
  await rejects(p.call("draftPiccolo", { jobId: "open1" }), "failed-precondition");
  await seedJob(p, "empty1", { stops: false });
  await rejects(p.call("draftPiccolo", { jobId: "empty1" }), "failed-precondition");
  await rejects(p.call("draftPiccolo", { jobId: "nope" }), "not-found");
});

test("limits: each job can be drafted 5 times (daily limits and guests: limits.test.js)", async () => {
  const p = await personal("busy");
  await seedJob(p, "many");
  for (let i = 0; i < 5; i++) await p.call("draftPiccolo", { jobId: "many" });
  await rejects(p.call("draftPiccolo", { jobId: "many" }), "resource-exhausted");
});

test("postProcess keeps only real sources and blanks prices", () => {
  const raw = {
    scope: "Replace the reader.",
    locations: [{ name: "Back door", tasks: [{ text: "Swap the reader", source_ids: ["s1", "made-up"] }] }],
    constraints: [],
    install_notes: [],
    lines: [
      { description: "Card reader", qty: 1, unit: "ea", part_number: "HID-R40", location: "Back door", notes: "", category: "equipment", source_ids: ["s1"], basis: "heard", quote: "" },
      { description: "Bracket", qty: -3, unit: "", part_number: "", location: "", notes: "", category: "weird", source_ids: ["nope"], basis: "heard", quote: "" },
    ],
    questions: [{ text: "What color?", source_ids: ["field_notes"] }],
  };
  const { data, complete } = postProcess(JSON.stringify(raw), {
    sourceIds: new Set(["s1", "field_notes"]),
    sourceText: "replace the HID R40 reader",
  });
  assert.equal(complete, false, "a line without a real source is worth a retry");
  const [reader, bracket] = data.bom;
  assert.equal(reader.partNumberStatus, "user"); // "HID R40" was said (spacing/dashes ignored)
  assert.deepEqual(data.workOrder.locations[0].tasks[0].sourceIds, ["s1"]);
  assert.equal(bracket.qty, 1);
  assert.equal(bracket.unit, "ea");
  assert.equal(bracket.category, "misc");
  assert.equal(bracket.source.basis, "inferred");
  assert.equal(bracket.partNumberStatus, "none");
  assert.ok(data.bom.every((l) => l.unitPrice === null && l.unitCost === null && l.priceSource === "none"));
  assert.equal(data.questions[0].id, "q1");
});

test("a stop's location (where on the site) is saved by its owner and used by the draft", async () => {
  const p = await personal("placer");
  const uid = await seedJob(p, "pl1");
  const stopPath = `users/${uid}/stops/pl1-s2`;
  await updateDoc(doc(p.db, stopPath), { place: "North exterior wall" });
  await blocked(updateDoc(doc(p.db, stopPath), { place: "x".repeat(121) }));
  const other = await personal("notplacer");
  await blocked(updateDoc(doc(other.db, stopPath), { place: "Somewhere" }));

  await p.call("draftPiccolo", { jobId: "pl1" });
  const w = (await getDoc(doc(p.db, `users/${uid}/jobs/pl1/working/current`))).data();
  // The stand-in model names locations the way the real one is told to: the worker's own name first
  assert.ok(w.bom.some((l) => l.location === "North exterior wall"));
  assert.ok(w.workOrder.locations.some((l) => l.name === "North exterior wall"));
});
