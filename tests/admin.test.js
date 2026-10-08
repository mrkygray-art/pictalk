// Admin console: customers, company settings (labor rate, AI price estimates), sales status
// and customer on team jobs, storage used. Checked against the rules and functions.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { signInWithCredential } from "firebase/auth";
import { addDoc, collection, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { phone, personal, google, mail, rejects, blocked, closeAll } from "./emulator.js";

const { postProcess } = createRequire(import.meta.url)("../functions/piccolo.js");
after(closeAll);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p, path) => getDoc(doc(p.db, path)).then((s) => s.data());

let A, E, F, O, orgId, owner;
const defaults = { markupPct: 10, taxPct: 8, terms: "Net 30", quotePrefix: "BL-", laborRate: 95, aiPriceEstimates: true };

async function member(name, role) {
  await A.call("createInvite", { email: mail(name), role });
  const p = phone();
  await signInWithCredential(p.auth, google(mail(name)));
  await p.call("ensureProfile");
  return p;
}

before(async () => {
  A = await personal("aadmin");
  ({ orgId } = await A.call("createOrg", { name: "Brightline" }));
  E = await member("aest", "estimator");
  F = await member("afield", "field");
  O = await personal("aother");
  await O.call("createOrg", { name: "Elsewhere" });
  owner = A.auth.currentUser.uid;
});

const customer = (by, extra = {}) => ({
  name: "Harbor Clinic", address: "1 Dock St", notes: "Gate code 4411. Prefers Axis cameras.", contacts: [], archived: false,
  orgId, createdAt: 1, createdBy: by.auth.currentUser.uid, updatedAt: 1, ...extra,
});

test("customers: admins and estimators add and edit; field reads; other companies see nothing", async () => {
  const ref = await addDoc(collection(A.db, "customers"), customer(A));
  await addDoc(collection(E.db, "customers"), customer(E, { name: "Pier 9" }));
  await blocked(addDoc(collection(F.db, "customers"), customer(F)));
  await blocked(addDoc(collection(A.db, "customers"), customer(A, { createdBy: "someone-else" })));
  await blocked(addDoc(collection(O.db, "customers"), customer(O)));
  assert.equal((await read(F, `customers/${ref.id}`)).name, "Harbor Clinic");
  await blocked(getDoc(doc(O.db, `customers/${ref.id}`)));
  await updateDoc(doc(E.db, `customers/${ref.id}`), { notes: "Gate code 5522.", updatedAt: 2 });
  await blocked(updateDoc(doc(A.db, `customers/${ref.id}`), { orgId: "elsewhere", updatedAt: 3 }));
  await blocked(updateDoc(doc(F.db, `customers/${ref.id}`), { name: "x", updatedAt: 3 }));
});

test("company settings: only the admin, and the AI switch must be on/off", async () => {
  const org = await read(A, `orgs/${orgId}`);
  await updateDoc(doc(A.db, `orgs/${orgId}`), { name: org.name, defaults, updatedAt: Date.now() });
  assert.equal((await read(E, `orgs/${orgId}`)).defaults.laborRate, 95);
  await blocked(updateDoc(doc(A.db, `orgs/${orgId}`), { defaults: { ...defaults, aiPriceEstimates: "yes" }, updatedAt: Date.now() }));
  await blocked(updateDoc(doc(E.db, `orgs/${orgId}`), { defaults: { ...defaults, markupPct: 99 }, updatedAt: Date.now() }));
  // The change shows in the company's activity
  const { collection: col, query: q, where: w, getDocs: gd } = await import("firebase/firestore");
  for (let i = 0; i < 40; i++) {
    const log = await gd(q(col(A.db, "auditLog"), w("orgId", "==", orgId)));
    if (log.docs.some((d) => d.get("action") === "org.settings" && d.get("after").defaults.laborRate === 95)) return;
    await sleep(250);
  }
  assert.fail("settings change not in the activity log");
});

test("drafts use the company settings: quote prefix, and AI estimates marked as estimates", async () => {
  const jobId = "adm-job";
  await setDoc(doc(A.db, `users/${owner}/jobs/${jobId}`), { name: "Job", status: "finished", startedAt: 1, endedAt: 2 });
  await setDoc(doc(A.db, `users/${owner}/stops/${jobId}-s1`), {
    jobId, note: "", photoPath: null, audioPath: null, status: "transcribed", transcript: "Replace the card reader.", clientCreatedAt: 3,
  });
  for (let i = 0; i < 40 && (await read(A, `users/${owner}/jobs/${jobId}`)).orgId !== orgId; i++) await sleep(250);
  await A.call("draftPiccolo", { jobId });
  const w = await read(A, `users/${owner}/jobs/${jobId}/working/current`);
  assert.equal(w.quote.prefix, "BL-");
  assert.equal(w.quote.markupPct, 10);
  const reader = w.bom.find((l) => l.category === "equipment");
  assert.deepEqual([reader.unitPrice, reader.priceSource], [99, "ai_estimate"]);
});

test("guardrails: estimates only when switched on; the labor rate fills hourly labor", () => {
  const raw = {
    scope: "Install.", locations: [], constraints: [], install_notes: [], questions: [],
    lines: [
      { description: "Camera", qty: 2, unit: "ea", part_number: "", location: "", notes: "", category: "equipment", source_ids: ["s1"], basis: "heard", quote: "", price_estimate: 350 },
      { description: "Install cameras", qty: 6, unit: "hr", part_number: "", location: "", notes: "", category: "labor", source_ids: ["s1"], basis: "heard", quote: "", price_estimate: 120 },
    ],
  };
  const opts = { sourceIds: new Set(["s1"]), sourceText: "" };
  const off = postProcess(JSON.stringify(raw), opts).data.bom;
  assert.deepEqual(off.map((l) => [l.unitPrice, l.priceSource]), [[null, "none"], [null, "none"]]);
  const on = postProcess(JSON.stringify(raw), { ...opts, estimates: true, laborRate: 95 }).data.bom;
  assert.deepEqual(on.map((l) => [l.unitPrice, l.priceSource]), [[350, "ai_estimate"], [95, "org_rate"]]);
});

test("sales status and customer on a team job go through the server", async () => {
  const jobId = "adm-job";
  const custRef = await addDoc(collection(A.db, "customers"), customer(A, { name: "Marina Labs" }));
  await A.call("updateTeamJob", { ownerUid: owner, jobId, salesStatus: "won", customerId: custRef.id });
  const job = await read(E, `users/${owner}/jobs/${jobId}`);
  assert.deepEqual([job.salesStatus, job.customerId], ["won", custRef.id]);
  await E.call("updateTeamJob", { ownerUid: owner, jobId, salesStatus: "installed" });
  await rejects(F.call("updateTeamJob", { ownerUid: owner, jobId, salesStatus: "lost" }), "permission-denied");
  await rejects(A.call("updateTeamJob", { ownerUid: owner, jobId, salesStatus: "maybe" }), "invalid-argument");
  const otherCust = await addDoc(collection(O.db, "customers"), customer(O, { orgId: (await O.profile()).orgId }));
  await rejects(A.call("updateTeamJob", { ownerUid: owner, jobId, customerId: otherCust.id }), "invalid-argument");
  await blocked(updateDoc(doc(A.db, `users/${owner}/jobs/${jobId}`), { salesStatus: "lost" })); // not directly

  const usage = await A.call("orgStorageUsage");
  assert.ok(usage.jobs >= 1 && usage.bytes >= 0);
  await rejects(E.call("orgStorageUsage"), "permission-denied");
});
