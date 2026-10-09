// Accounts, companies (orgs), and team invites for Piccolo. Every change to a user's
// tier, role, or company happens here (Admin SDK); the app can only read its own
// profile, so nobody can give themselves a role. Times are ms numbers like the rest of PicTalk.
//
// Tiers: guest (anonymous), personal (signed in with Google / email link; anyone),
// team (joined a company through an invite, or created one). One company per user:
// joining a second company needs a different email address.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { piccoloCallable } = require("./budget");
const { clearGuestExpiry } = require("./guests");
const { isUnlimited } = require("./limits");

const TEAM_ROLES = ["admin", "estimator", "field", "installer"];
const DEFAULTS = { markupPct: 0, taxPct: 0, terms: "", quotePrefix: "Q-" };

const db = () => getFirestore();
const normEmail = (e) => String(e || "").trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// Who is calling, from Firebase Auth itself (not the ID token, which can be a few
// minutes stale right after a guest links Google or an email link).
async function caller(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const user = await getAuth().getUser(uid);
  return {
    uid,
    isAnonymous: user.providerData.length === 0,
    email: user.emailVerified ? normEmail(user.email) : null, // only verified emails count
    // A guest who linked Google keeps an empty top-level name; Google's is in providerData
    displayName: user.displayName || user.providerData.find((p) => p.displayName)?.displayName || null,
  };
}

function audit(tx, entry) {
  tx.set(db().collection("auditLog").doc(), { ...entry, at: Date.now() });
}

// Throws a user-facing error if this invite doesn't fit this person. No writes, so it can
// run before a transaction's writes (Firestore needs all reads first).
function checkInvite(inviteSnap, who, profile) {
  const invite = inviteSnap.data();
  if (!inviteSnap.exists || invite.status === "revoked") {
    throw new HttpsError("not-found", "This invite was cancelled. Ask your admin for a new one.");
  }
  if (invite.email !== who.email) {
    throw new HttpsError("permission-denied", `This invite is for ${invite.email}. Sign in with that email address.`);
  }
  if (profile?.orgId && profile.orgId !== invite.orgId) {
    throw new HttpsError("failed-precondition",
      "This account already belongs to another company. Use a different email address to join this one.");
  }
  if (invite.status === "accepted" && invite.acceptedBy !== who.uid) {
    throw new HttpsError("already-exists", "This invite has already been used.");
  }
  return invite;
}

// Joins the (already checked) invite's company. Returns the profile fields to write.
function applyInvite(tx, who, inviteSnap, profile) {
  const invite = inviteSnap.data();
  const now = Date.now();
  if (invite.status !== "accepted") {
    tx.update(inviteSnap.ref, { status: "accepted", acceptedBy: who.uid, acceptedAt: now, updatedAt: now });
  }
  if (profile?.orgId === invite.orgId) return {}; // already on this team
  audit(tx, { uid: who.uid, orgId: invite.orgId, action: "invite.accept", target: inviteSnap.id, after: { role: invite.role } });
  return { tier: "team", role: invite.role, orgId: invite.orgId, status: "active" };
}

// Creates or refreshes the caller's users/{uid} profile. The app calls it after sign-in
// and whenever a guest saves their work. A verified email with a pending invite joins
// that company on first sign-in.
exports.ensureProfile = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const who = await caller(request);
  const userRef = db().doc(`users/${who.uid}`);
  const canDeleteJobs = !who.isAnonymous && (await isUnlimited(who.uid)); // the app owner's accounts
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const profile = snap.exists ? snap.data() : null;
    const now = Date.now();
    // A pending invite for this verified email (read before any writes)
    let inviteSnap = null;
    if (!who.isAnonymous && who.email && !profile?.orgId) {
      const q = await tx.get(db().collection("invites")
        .where("email", "==", who.email).where("status", "==", "pending").orderBy("createdAt", "desc").limit(1));
      if (!q.empty) {
        try {
          checkInvite(q.docs[0], who, profile);
          inviteSnap = q.docs[0];
        } catch (err) {
          logger.warn("Pending invite not applied", { uid: who.uid, error: err.message });
        }
      }
    }

    const update = { isAnonymous: who.isAnonymous, email: who.email, canDeleteJobs, lastSeenAt: now, updatedAt: now };
    if (who.displayName) update.displayName = who.displayName;
    if (!profile) {
      Object.assign(update, {
        tier: who.isAnonymous ? "guest" : "personal",
        role: who.isAnonymous ? "guest" : "personal",
        orgId: null,
        status: "active",
        createdAt: now,
        createdBy: who.uid,
      });
    } else if (profile.tier === "guest" && !who.isAnonymous) {
      // A guest saved their work: same uid, so their jobs, photos, and audio are already theirs
      Object.assign(update, { tier: "personal", role: "personal", upgradedAt: now });
    }
    if (inviteSnap) Object.assign(update, applyInvite(tx, who, inviteSnap, profile));
    tx.set(userRef, update, { merge: true });
    const invite = inviteSnap?.data();
    return { joined: invite ? { orgId: invite.orgId, orgName: invite.orgName, role: invite.role } : null };
  });
  // Signed in (not a guest): none of their jobs expire any more (sample jobs still do)
  if (!who.isAnonymous) await clearGuestExpiry(who.uid);
  return result;
});

// Opens an invite link: joins the company if the signed-in email matches.
exports.acceptInvite = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const who = await caller(request);
  const inviteId = String(request.data?.inviteId || "");
  if (who.isAnonymous || !who.email) {
    throw new HttpsError("unauthenticated", "Sign in with the email address the invite was sent to.");
  }
  if (!/^[A-Za-z0-9]{10,40}$/.test(inviteId)) throw new HttpsError("invalid-argument", "This invite link isn't complete.");
  const userRef = db().doc(`users/${who.uid}`);
  return db().runTransaction(async (tx) => {
    const profile = (await tx.get(userRef)).data();
    if (!profile) throw new HttpsError("failed-precondition", "Your account is still being set up. Try again in a moment.");
    const inviteSnap = await tx.get(db().doc(`invites/${inviteId}`));
    const invite = checkInvite(inviteSnap, who, profile);
    const fields = applyInvite(tx, who, inviteSnap, profile);
    if (Object.keys(fields).length) tx.set(userRef, { ...fields, updatedAt: Date.now() }, { merge: true });
    return { orgId: invite.orgId, orgName: invite.orgName, role: invite.role };
  });
});

// A personal user starts a company and becomes its admin.
exports.createOrg = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const who = await caller(request);
  const name = String(request.data?.name || "").trim();
  if (who.isAnonymous) throw new HttpsError("permission-denied", "Save your work (sign in) before creating a company.");
  if (!name || name.length > 100) throw new HttpsError("invalid-argument", "Enter a company name (up to 100 letters).");
  const userRef = db().doc(`users/${who.uid}`);
  const orgRef = db().collection("orgs").doc();
  return db().runTransaction(async (tx) => {
    const profile = (await tx.get(userRef)).data();
    if (!profile) throw new HttpsError("failed-precondition", "Your account is still being set up. Try again in a moment.");
    if (profile.orgId) {
      throw new HttpsError("failed-precondition", "This account already belongs to a company. Use a different email address for another one.");
    }
    const now = Date.now();
    tx.set(orgRef, { name, defaults: DEFAULTS, createdAt: now, updatedAt: now, createdBy: who.uid });
    tx.set(userRef, { tier: "team", role: "admin", orgId: orgRef.id, updatedAt: now }, { merge: true });
    audit(tx, { uid: who.uid, orgId: orgRef.id, action: "org.create", after: { name } });
    return { orgId: orgRef.id };
  });
});

// Loads the caller's profile and checks they're an active admin of their company.
async function requireAdmin(tx, uid) {
  const profile = (await tx.get(db().doc(`users/${uid}`))).data();
  if (!profile?.orgId || profile.role !== "admin" || profile.status !== "active") {
    throw new HttpsError("permission-denied", "Only a company admin can do that.");
  }
  return profile;
}

exports.createInvite = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const who = await caller(request);
  const email = normEmail(request.data?.email);
  const role = String(request.data?.role || "");
  if (!isEmail(email)) throw new HttpsError("invalid-argument", "Enter a full email address.");
  if (!TEAM_ROLES.includes(role)) throw new HttpsError("invalid-argument", "Pick a role.");
  return db().runTransaction(async (tx) => {
    const admin = await requireAdmin(tx, who.uid);
    const org = (await tx.get(db().doc(`orgs/${admin.orgId}`))).data();
    const existing = await tx.get(db().collection("invites")
      .where("orgId", "==", admin.orgId).where("email", "==", email).where("status", "==", "pending").limit(1));
    const now = Date.now();
    if (!existing.empty) {
      // Same person again: keep one link, update the role
      const ref = existing.docs[0].ref;
      tx.update(ref, { role, updatedAt: now });
      audit(tx, { uid: who.uid, orgId: admin.orgId, action: "invite.update", target: ref.id, after: { email, role } });
      return { inviteId: ref.id };
    }
    const ref = db().collection("invites").doc();
    tx.set(ref, {
      email, role, orgId: admin.orgId, orgName: org?.name || "", status: "pending",
      invitedBy: who.uid, createdBy: who.uid, createdAt: now, updatedAt: now,
    });
    audit(tx, { uid: who.uid, orgId: admin.orgId, action: "invite.create", target: ref.id, after: { email, role } });
    return { inviteId: ref.id };
  });
});

exports.revokeInvite = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const who = await caller(request);
  const inviteRef = db().doc(`invites/${String(request.data?.inviteId || "x")}`);
  return db().runTransaction(async (tx) => {
    const admin = await requireAdmin(tx, who.uid);
    const invite = (await tx.get(inviteRef)).data();
    if (!invite || invite.orgId !== admin.orgId) throw new HttpsError("not-found", "Invite not found.");
    if (invite.status !== "pending") throw new HttpsError("failed-precondition", "Only a waiting invite can be cancelled.");
    tx.update(inviteRef, { status: "revoked", updatedAt: Date.now() });
    audit(tx, { uid: who.uid, orgId: admin.orgId, action: "invite.revoke", target: inviteRef.id, before: { email: invite.email } });
    return { ok: true };
  });
});

// Change a team member's role or turn their access off/on. Never deletes the user or
// their data. A company always keeps at least one active admin.
exports.updateMember = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const who = await caller(request);
  const targetUid = String(request.data?.uid || "");
  const { role, status } = request.data || {};
  if (role !== undefined && !TEAM_ROLES.includes(role)) throw new HttpsError("invalid-argument", "Pick a role.");
  if (status !== undefined && !["active", "disabled"].includes(status)) throw new HttpsError("invalid-argument", "Unknown status.");
  if (role === undefined && status === undefined) throw new HttpsError("invalid-argument", "Nothing to change.");
  if (!targetUid) throw new HttpsError("invalid-argument", "Pick a team member.");
  return db().runTransaction(async (tx) => {
    const admin = await requireAdmin(tx, who.uid);
    const targetRef = db().doc(`users/${targetUid}`);
    const target = (await tx.get(targetRef)).data();
    if (!target || target.orgId !== admin.orgId) throw new HttpsError("not-found", "That person isn't on your team.");
    const after = { role: role ?? target.role, status: status ?? target.status };
    const losesAdmin = target.role === "admin" && target.status === "active" && (after.role !== "admin" || after.status !== "active");
    if (losesAdmin) {
      const admins = await tx.get(db().collection("users")
        .where("orgId", "==", admin.orgId).where("role", "==", "admin").where("status", "==", "active"));
      if (admins.size <= 1) throw new HttpsError("failed-precondition", "Your company needs at least one admin. Make someone else an admin first.");
    }
    tx.update(targetRef, { ...after, updatedAt: Date.now() });
    audit(tx, {
      uid: who.uid, orgId: admin.orgId, action: "member.update", target: targetUid,
      before: { role: target.role, status: target.status }, after,
    });
    return { ok: true };
  });
});
