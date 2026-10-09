// Learning from edits: the AI-draft-vs-final diff, remembered lines per company or account
// (never mixed), reuse in new drafts (past part number and price), the opt-out, and clearing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { signInWithCredential } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { phone, personal, google, mail, rejects, blocked, closeAll } from "./emulator.js";

const require = createRequire(import.meta.url);
const { postProcess } = require("../functions/piccolo.js");
const { diffDraft, mergeLearned } = require("../functions/learning.js");
after(closeAll);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p, path) => getDoc(doc(p.db, path)).then((s) => s.data());

const line = (id, description, extra = {}) => ({ id, description, qty: 1, unit: "ea", partNumber: "", category: "equipment", unitPrice: null, location: "", notes: "", ...extra });

test("diff: kept, changed, removed, added; filling in a price isn't a change", () => {
  const original = {
    workOrder: { scope: "Install." },
    bom: [line("a", "Camera"), line("b", "Bracket"), line("c", "Cable", { qty: 100, unit: "ft" })],
  };
  const final = {
    workOrder: { scope: "Install two cameras." },
    bom: [line("a", "Camera", { unitPrice: 350, priceSource: "user" }), line("c", "Cat6 cable", { qty: 150, unit: "ft" }), line("d", "Junction box")],
    questions: [{ answered: true }, { answered: false }],
  };
  const d = diffDraft(original, final);
  assert.deepEqual(
    [d.linesDrafted, d.linesKept, d.linesChanged, d.linesRemoved, d.linesAdded, d.pricesFilled],
    [3, 1, 1, 1, 1, 1]
  );
  assert.deepEqual(d.changes[0].fields.sort(), ["description", "qty"]);
  assert.deepEqual([d.removed, d.added], [["Bracket"], ["Junction box"]]);
  assert.equal(d.scopeEdited, true);
  assert.deepEqual([d.questionsAnswered, d.questionsTotal], [1, 2]);
});

test("remembered lines: newest wins, one per part number or wording; estimates aren't kept as prices", () => {
  const merged = mergeLearned(
    [{ description: "Dome camera", partNumber: "AX-100", unitPrice: 300 }, { description: "Patch cable", partNumber: "", unitPrice: 5 }],
    [{ description: "4MP dome camera", partNumber: "ax100", unitPrice: 320 }, { description: "patch  cable", partNumber: "", unitPrice: 6 }]
  );
  assert.deepEqual(merged.map((l) => l.unitPrice), [320, 6]);
});

test("drafts reuse a past line's part number and price; unknown part numbers still say verify", () => {
  const raw = {
    scope: "Install.", locations: [], constraints: [], install_notes: [], questions: [],
    lines: [
      { description: "Card reader", qty: 1, unit: "ea", part_number: "", location: "", notes: "", category: "equipment", source_ids: ["s1"], basis: "heard", quote: "", price_estimate: 0 },
      { description: "Reader mount", qty: 1, unit: "ea", part_number: "MNT-9", location: "", notes: "", category: "misc", source_ids: ["s1"], basis: "heard", quote: "", price_estimate: 0 },
      { description: "Lock", qty: 1, unit: "ea", part_number: "ZZ-404", location: "", notes: "", category: "equipment", source_ids: ["s1"], basis: "heard", quote: "", price_estimate: 80 },
      { description: "Install", qty: 3, unit: "hr", part_number: "", location: "", notes: "", category: "labor", source_ids: ["s1"], basis: "heard", quote: "", price_estimate: 0 },
    ],
  };
  const learned = [
    { description: "Card reader", partNumber: "HID-R40", unit: "ea", unitPrice: 210 },
    { description: "Wall mount for reader", partNumber: "mnt9", unit: "ea", unitPrice: 12 },
    { description: "Install", partNumber: "", unit: "hr", unitPrice: 70 },
  ];
  const bom = postProcess(JSON.stringify(raw), { sourceIds: new Set(["s1"]), sourceText: "", estimates: true, laborRate: 95, learned }).data.bom;
  assert.deepEqual(
    bom.map((l) => [l.partNumber, l.partNumberStatus, l.unitPrice, l.priceSource]),
    [
      ["HID-R40", "history", 210, "history"],
      ["MNT-9", "history", 12, "history"],
      ["ZZ-404", "ai_suggested", 80, "ai_estimate"],
      ["", "none", 95, "org_rate"], // the company's labor rate comes first
    ]
  );
});

// A finished job with one transcribed stop
async function seedJob(p, jobId, words) {
  const uid = p.auth.currentUser.uid;
  await setDoc(doc(p.db, `users/${uid}/jobs/${jobId}`), { name: "Job", status: "finished", startedAt: 1, endedAt: 2 });
  await setDoc(doc(p.db, `users/${uid}/stops/${jobId}-s1`), { jobId, note: "", photoPath: null, audioPath: null, status: "transcribed", transcript: words, clientCreatedAt: 3 });
  return uid;
}

test("finalizing records the diff and teaches the next draft (personal account)", async () => {
  const p = await personal("learner");
  const uid = await seedJob(p, "lj1", "Swap the reader at the front door.");
  await p.call("draftPiccolo", { jobId: "lj1" });
  const wPath = `users/${uid}/jobs/lj1/working/current`;
  const w = await read(p, wPath);
  const drafted = w.bom.length;
  // Edit: price the first line, rename the second, add one by hand
  w.bom[0] = { ...w.bom[0], unitPrice: 210, priceSource: "user", partNumber: "HID-R40", partNumberStatus: "user", checked: true };
  w.bom[1] = { ...w.bom[1], description: "Program and test the reader", checked: true };
  w.bom.push({ ...w.bom[0], id: "added-1", description: "Door position switch", partNumber: "DPS-7", unitPrice: 18, sortOrder: 99 });
  await setDoc(doc(p.db, wPath), { ...w, updatedAt: Date.now() });
  await p.call("finalizePiccolo", { jobId: "lj1", acknowledged: true });

  const d = (await read(p, `users/${uid}/jobs/lj1/finals/v1`)).editDiff;
  assert.deepEqual([d.linesDrafted, d.linesChanged, d.linesAdded, d.linesRemoved], [drafted, 2, 1, 0]);
  const learning = await read(p, `learning/user_${uid}`);
  assert.equal(learning.stats.finals, 1);
  assert.ok(learning.lines.some((l) => l.partNumber === "DPS-7" && l.unitPrice === 18));
  await blocked(setDoc(doc(p.db, `learning/user_${uid}`), { lines: [] })); // function-only

  // The next draft gets the past lines (the stand-in reuses the newest one's wording)
  await seedJob(p, "lj2", "Another door, same setup.");
  await p.call("draftPiccolo", { jobId: "lj2" });
  const next = await read(p, `users/${uid}/jobs/lj2/working/current`);
  const reused = next.bom.find((l) => l.priceSource === "history");
  assert.ok(reused, "a line priced from a past final");
  assert.equal(reused.partNumberStatus, "history");
  const draftDoc = await read(p, `users/${uid}/jobs/lj2/drafts/${(await read(p, `users/${uid}/jobs/lj2`)).latestDraftId}`);
  assert.equal(draftDoc.promptVersion, "piccolo-draft-v3");
  assert.ok(draftDoc.generation.pastLines > 0);

  // Someone else can't read it, and their drafts don't get it
  const other = await personal("stranger");
  await blocked(getDoc(doc(other.db, `learning/user_${uid}`)));
  const ouid = await seedJob(other, "lj3", "Swap the reader.");
  await other.call("draftPiccolo", { jobId: "lj3" });
  const theirs = await read(other, `users/${ouid}/jobs/lj3/working/current`);
  assert.ok(!theirs.bom.some((l) => l.priceSource === "history"));
});

let A, F, orgId;
async function member(name, role) {
  await A.call("createInvite", { email: mail(name), role });
  const p = phone();
  await signInWithCredential(p.auth, google(mail(name)));
  await p.call("ensureProfile");
  return p;
}
before(async () => {
  A = await personal("ladmin");
  ({ orgId } = await A.call("createOrg", { name: "Learners Inc" }));
  F = await member("lfield", "field");
});

async function teamJob(jobId) {
  const uid = await seedJob(A, jobId, "Replace the keypad by the gate.");
  for (let i = 0; i < 40 && (await read(A, `users/${uid}/jobs/${jobId}`)).orgId !== orgId; i++) await sleep(250);
  await A.call("draftPiccolo", { jobId });
  await A.call("finalizePiccolo", { jobId, acknowledged: true });
  return uid;
}

test("company learning: admin reads and clears it; field can't; turning it off stops it", async () => {
  await teamJob("lt1");
  const key = `learning/org_${orgId}`;
  const l = await read(A, key);
  assert.deepEqual([l.orgId, l.stats.finals], [orgId, 1]);
  await blocked(getDoc(doc(F.db, key)));
  await rejects(F.call("clearLearning"), "permission-denied");

  // Off: the next final isn't remembered
  const org = await read(A, `orgs/${orgId}`);
  await updateDoc(doc(A.db, `orgs/${orgId}`), { name: org.name, defaults: { ...(org.defaults || {}), learnFromEdits: false }, updatedAt: Date.now() });
  await blocked(updateDoc(doc(A.db, `orgs/${orgId}`), { name: org.name, defaults: { learnFromEdits: "no" }, updatedAt: Date.now() }));
  await teamJob("lt2");
  assert.equal((await read(A, key)).stats.finals, 1);

  const { cleared } = await A.call("clearLearning");
  assert.ok(cleared > 0);
  assert.equal(await read(A, key), undefined);
});
