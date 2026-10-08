// Account function tests: sign in fake users against the Auth emulator and call the real
// functions in the Functions emulator (run with `npm test`).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, signInAnonymously, signInWithCredential, linkWithCredential, GoogleAuthProvider,
} from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";

const run = Math.random().toString(36).slice(2, 8); // fresh emails each run
const apps = [];

// One signed-out "phone" per person
function phone() {
  const app = initializeApp({ apiKey: "fake", projectId: "demo-pictalk" }, `p${apps.length}-${run}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const fns = getFunctions(app, "us-west2");
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const call = (name, data) => httpsCallable(fns, name)(data).then((r) => r.data);
  const profile = async () => (await getDoc(doc(db, `users/${auth.currentUser.uid}`))).data();
  return { auth, db, call, profile };
}

// The Auth emulator accepts an unsigned Google token
const google = (email) => GoogleAuthProvider.credential(JSON.stringify({ sub: `g-${email}`, email, email_verified: true }));
const mail = (name) => `${name}-${run}@example.com`;

async function personal(name) {
  const p = phone();
  await signInWithCredential(p.auth, google(mail(name)));
  await p.call("ensureProfile");
  return p;
}

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, `functions/${code}`, err.message);
    return true;
  });
}

after(async () => {
  await Promise.all(apps.map((a) => deleteApp(a)));
});

test("a guest gets a guest profile; saving their work keeps the same account", async () => {
  const p = phone();
  const { user } = await signInAnonymously(p.auth);
  await p.call("ensureProfile");
  assert.equal((await p.profile()).tier, "guest");

  const linked = await linkWithCredential(user, google(mail("guest")));
  assert.equal(linked.user.uid, user.uid, "uid must not change");
  await p.call("ensureProfile");
  const prof = await p.profile();
  assert.equal(prof.tier, "personal");
  assert.equal(prof.isAnonymous, false);
  assert.equal(prof.email, mail("guest"));
  assert.ok(prof.upgradedAt);
});

test("anyone signed in can start one company and becomes its admin", async () => {
  const guest = phone();
  await signInAnonymously(guest.auth);
  await guest.call("ensureProfile");
  await rejects(guest.call("createOrg", { name: "Guest Co" }), "permission-denied");

  const owner = await personal("owner");
  const { orgId } = await owner.call("createOrg", { name: "Acme Security" });
  const prof = await owner.profile();
  assert.deepEqual([prof.tier, prof.role, prof.orgId], ["team", "admin", orgId]);
  await rejects(owner.call("createOrg", { name: "Second Co" }), "failed-precondition");
  await rejects(owner.call("createOrg", { name: "" }), "invalid-argument");
});

test("an invited email joins with the invited role on first sign-in", async () => {
  const admin = await personal("admin1");
  const { orgId } = await admin.call("createOrg", { name: "Invite Co" });
  const { inviteId } = await admin.call("createInvite", { email: ` ${mail("est").toUpperCase()} `, role: "estimator" });
  // Inviting the same email again keeps one link
  const again = await admin.call("createInvite", { email: mail("est"), role: "estimator" });
  assert.equal(again.inviteId, inviteId);

  const est = phone();
  await signInWithCredential(est.auth, google(mail("est")));
  const { joined } = await est.call("ensureProfile");
  assert.equal(joined.orgId, orgId);
  const prof = await est.profile();
  assert.deepEqual([prof.tier, prof.role, prof.orgId], ["team", "estimator", orgId]);
  // Opening the link afterwards is harmless
  assert.equal((await est.call("acceptInvite", { inviteId })).orgId, orgId);

  const invite = (await getDoc(doc(admin.db, `invites/${inviteId}`))).data();
  assert.equal(invite.status, "accepted");
  assert.equal(invite.acceptedBy, est.auth.currentUser.uid);

  const log = await getDocs(query(collection(admin.db, "auditLog"), where("orgId", "==", orgId)));
  const actions = log.docs.map((d) => d.data().action).sort();
  assert.deepEqual(actions, ["invite.accept", "invite.create", "invite.update", "org.create"]);
});

test("an invite only works for its own email, and not after it's cancelled", async () => {
  const admin = await personal("admin2");
  await admin.call("createOrg", { name: "Strict Co" });
  const { inviteId } = await admin.call("createInvite", { email: mail("right"), role: "field" });

  const wrong = await personal("wrong");
  await rejects(wrong.call("acceptInvite", { inviteId }), "permission-denied");
  assert.equal((await wrong.profile()).orgId, null);

  await admin.call("revokeInvite", { inviteId });
  const right = phone();
  await signInWithCredential(right.auth, google(mail("right")));
  const { joined } = await right.call("ensureProfile");
  assert.equal(joined, null);
  await rejects(right.call("acceptInvite", { inviteId }), "not-found");
  assert.equal((await right.profile()).tier, "personal");

  const guest = phone();
  await signInAnonymously(guest.auth);
  await rejects(guest.call("acceptInvite", { inviteId }), "unauthenticated");
});

test("one company per account: a second company needs a different email", async () => {
  const adminA = await personal("adminA");
  const { orgId: orgA } = await adminA.call("createOrg", { name: "Company A" });
  const adminB = await personal("adminB");
  await adminB.call("createOrg", { name: "Company B" });

  const { inviteId } = await adminA.call("createInvite", { email: mail("adminB"), role: "estimator" });
  await rejects(adminB.call("acceptInvite", { inviteId }), "failed-precondition");
  const prof = await adminB.profile();
  assert.notEqual(prof.orgId, orgA);
  assert.equal(prof.role, "admin");
});

test("only an admin manages the team, and a company keeps at least one admin", async () => {
  const admin = await personal("admin3");
  const { orgId } = await admin.call("createOrg", { name: "Team Co" });
  await rejects(admin.call("createInvite", { email: "not-an-email", role: "field" }), "invalid-argument");
  await rejects(admin.call("createInvite", { email: mail("x"), role: "owner" }), "invalid-argument");
  await admin.call("createInvite", { email: mail("tech"), role: "estimator" });
  const tech = phone();
  await signInWithCredential(tech.auth, google(mail("tech")));
  await tech.call("ensureProfile");
  const techUid = tech.auth.currentUser.uid;
  const adminUid = admin.auth.currentUser.uid;

  await rejects(tech.call("createInvite", { email: mail("y"), role: "admin" }), "permission-denied");
  await rejects(tech.call("updateMember", { uid: techUid, role: "admin" }), "permission-denied");

  await admin.call("updateMember", { uid: techUid, role: "field" });
  assert.equal((await tech.profile()).role, "field");

  await rejects(admin.call("updateMember", { uid: adminUid, role: "field" }), "failed-precondition");
  await rejects(admin.call("updateMember", { uid: adminUid, status: "disabled" }), "failed-precondition");

  // Turning someone off keeps their profile (and data); they lose company access
  await admin.call("updateMember", { uid: techUid, status: "disabled" });
  assert.equal((await tech.profile()).status, "disabled");
  await assert.rejects(getDoc(doc(tech.db, `orgs/${orgId}`)));

  // Another company's admin can't touch this team
  const other = await personal("admin4");
  await other.call("createOrg", { name: "Other Co" });
  await rejects(other.call("updateMember", { uid: techUid, status: "active" }), "not-found");
});
