// Firestore rules tests for Piccolo accounts (run with `npm test`, which starts the emulators).
// Each user is checked against what their role allows; hiding a button isn't security.
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";

let env;
const db = (uid) => env.authenticatedContext(uid).firestore();
const defaults = { markupPct: 0, taxPct: 0, terms: "", quotePrefix: "Q-" };
const member = (orgId, role, status = "active") => ({ tier: "team", role, orgId, status, isAnonymous: false });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pictalk-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, "orgs/orgA"), { name: "Acme Security", defaults, createdBy: "alice", updatedAt: 1 });
    await setDoc(doc(fs, "orgs/orgB"), { name: "Beta Low Voltage", defaults, createdBy: "carol", updatedAt: 1 });
    await setDoc(doc(fs, "users/alice"), member("orgA", "admin"));
    await setDoc(doc(fs, "users/bob"), member("orgA", "estimator"));
    await setDoc(doc(fs, "users/carol"), member("orgB", "admin"));
    await setDoc(doc(fs, "users/dave"), member("orgA", "admin", "disabled"));
    await setDoc(doc(fs, "users/erin"), { tier: "personal", role: "personal", orgId: null, status: "active" });
    await setDoc(doc(fs, "invites/inv1"), { email: "x@example.com", role: "field", orgId: "orgA", status: "pending", createdAt: 1 });
    await setDoc(doc(fs, "auditLog/a1"), { uid: "alice", orgId: "orgA", action: "org.create", at: 1 });
    await setDoc(doc(fs, "users/erin/jobs/j1"), { name: "Job", status: "finished", startedAt: 1 });
  });
});

after(async () => {
  await env.cleanup();
});

test("you can read your own profile, not someone else's", async () => {
  await assertSucceeds(getDoc(doc(db("erin"), "users/erin")));
  await assertSucceeds(getDoc(doc(db("newguest"), "users/newguest"))); // not created yet
  await assertFails(getDoc(doc(db("erin"), "users/bob")));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "users/erin")));
});

test("nobody can write their own profile (no self-promotion)", async () => {
  await assertFails(updateDoc(doc(db("bob"), "users/bob"), { role: "admin" }));
  await assertFails(setDoc(doc(db("erin"), "users/erin"), { orgId: "orgA", role: "admin" }));
  await assertFails(setDoc(doc(db("newguest"), "users/newguest"), { tier: "team", role: "admin" }));
});

test("an admin reads their team's profiles; others can't", async () => {
  await assertSucceeds(getDoc(doc(db("alice"), "users/bob")));
  await assertSucceeds(getDocs(query(collection(db("alice"), "users"), where("orgId", "==", "orgA"))));
  await assertFails(getDocs(query(collection(db("bob"), "users"), where("orgId", "==", "orgA"))));
  await assertFails(getDocs(query(collection(db("carol"), "users"), where("orgId", "==", "orgA"))));
  await assertFails(getDoc(doc(db("carol"), "users/bob")));
  await assertFails(getDoc(doc(db("dave"), "users/bob"))); // turned-off admin
  await assertFails(getDocs(collection(db("alice"), "users"))); // no unfiltered list
});

test("company: members read it, only an active admin edits name and defaults", async () => {
  await assertSucceeds(getDoc(doc(db("bob"), "orgs/orgA")));
  await assertFails(getDoc(doc(db("erin"), "orgs/orgA")));
  await assertFails(getDoc(doc(db("carol"), "orgs/orgA")));
  await assertFails(getDoc(doc(db("dave"), "orgs/orgA")));
  await assertSucceeds(updateDoc(doc(db("alice"), "orgs/orgA"), {
    name: "Acme Security Inc", defaults: { ...defaults, markupPct: 20 }, updatedAt: 2,
  }));
  await assertFails(updateDoc(doc(db("bob"), "orgs/orgA"), { name: "Bob's company", updatedAt: 3 }));
  await assertFails(updateDoc(doc(db("alice"), "orgs/orgA"), { createdBy: "mallory", updatedAt: 3 }));
  await assertFails(updateDoc(doc(db("alice"), "orgs/orgA"), { defaults: { ...defaults, secret: 1 }, updatedAt: 3 }));
  await assertFails(setDoc(doc(db("erin"), "orgs/orgE"), { name: "Erin Co", defaults, createdBy: "erin", updatedAt: 1 }));
});

test("invites and audit log: only that company's admin reads them; nobody writes", async () => {
  await assertSucceeds(getDocs(query(collection(db("alice"), "invites"), where("orgId", "==", "orgA"))));
  await assertFails(getDocs(query(collection(db("bob"), "invites"), where("orgId", "==", "orgA"))));
  await assertFails(getDocs(query(collection(db("carol"), "invites"), where("orgId", "==", "orgA"))));
  await assertFails(setDoc(doc(db("alice"), "invites/inv2"), { email: "y@example.com", role: "admin", orgId: "orgA", status: "pending" }));
  await assertFails(updateDoc(doc(db("alice"), "invites/inv1"), { status: "accepted" }));

  await assertSucceeds(getDocs(query(collection(db("alice"), "auditLog"), where("orgId", "==", "orgA"))));
  await assertFails(getDocs(query(collection(db("bob"), "auditLog"), where("orgId", "==", "orgA"))));
  await assertFails(setDoc(doc(db("alice"), "auditLog/a2"), { uid: "alice", orgId: "orgA", action: "fake", at: 2 }));
});

test("existing PicTalk data stays private to its owner", async () => {
  await assertSucceeds(getDoc(doc(db("erin"), "users/erin/jobs/j1")));
  await assertSucceeds(setDoc(doc(db("erin"), "users/erin/jobs/j2"), { name: "Job 2", status: "open", startedAt: 2 }));
  await assertFails(getDoc(doc(db("alice"), "users/erin/jobs/j1")));
  await assertFails(getDoc(doc(db("bob"), "users/erin/jobs/j1")));
});
