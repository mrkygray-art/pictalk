// Accounts for Piccolo: guests "save their work" by attaching Google or an emailed link
// to the same anonymous account (the uid never changes, so nothing is copied). Roles and
// companies are set only by the account functions (functions/accounts.js).
import {
  GoogleAuthProvider, EmailAuthProvider, linkWithPopup, signInWithPopup, linkWithCredential,
  signInWithCredential, sendSignInLinkToEmail, isSignInWithEmailLink, signOut,
} from "firebase/auth";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions, startSession } from "./firebase";

const call = (name) => (data) => httpsCallable(functions, name)(data).then((r) => r.data);
export const ensureProfile = call("ensureProfile");
export const acceptInvite = (inviteId) => call("acceptInvite")({ inviteId });
export const createOrg = (name) => call("createOrg")({ name });
export const createInvite = (email, role) => call("createInvite")({ email, role });
export const revokeInvite = (inviteId) => call("revokeInvite")({ inviteId });
export const updateMember = (uid, change) => call("updateMember")({ uid, ...change });
export const createDemoJob = (different = false) => call("createDemoJob")(different ? { different: true } : {});
const mergeGuest = (guestToken) => call("mergeGuestIntoAccount")({ guestToken });

export const TEAM_ROLES = [
  { id: "admin", label: "Admin", about: "Everything, including the team and settings" },
  { id: "estimator", label: "Estimator", about: "All jobs, parts lists, quotes, and prices" },
  { id: "field", label: "Field", about: "Captures jobs and edits the scope. No prices." },
  { id: "installer", label: "Installer", about: "Sees work orders for their jobs. No prices." },
];
export const roleLabel = (role) =>
  TEAM_ROLES.find((r) => r.id === role)?.label || (role === "personal" ? "Personal account" : "Guest");

// A friendly message for anything thrown here (callable errors already have one)
export function errorText(err) {
  const code = err?.code || "";
  if (err instanceof AccountError) return err.message;
  if (code.startsWith("functions/") && code !== "functions/internal") return err.message;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/popup-blocked") return "Your browser blocked the Google window. Allow pop-ups for PicTalk and try again.";
  if (code === "auth/network-request-failed" || !navigator.onLine) return "You need signal for this. Try again when you're online.";
  if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
    return "This sign-in link was already used or has expired. Ask for a new one.";
  }
  if (code === "auth/invalid-email") return "That email address doesn't look right.";
  console.warn("Account error:", err);
  return "Something went wrong. Please try again.";
}

export class AccountError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}


// The profile doc (users/{uid}); null until the account function has made it.
// Cached snapshots are skipped for "missing", so an offline start doesn't look like a new account.
export function watchProfile(uid, callback) {
  return onSnapshot(
    doc(db, "users", uid),
    { includeMetadataChanges: false },
    (snap) => {
      if (snap.exists()) callback({ ...snap.data(), loaded: true });
      else if (!snap.metadata.fromCache) callback({ loaded: true, missing: true });
    },
    () => callback({ loaded: true, missing: true })
  );
}

// Does this guest have anything that would be lost by switching to another account?
// (The sample job doesn't count; it isn't moved.)
async function guestHasWork(uid) {
  const jobs = await getDocs(query(collection(db, "users", uid, "jobs"), limit(10)));
  return jobs.docs.some((d) => !d.get("isDemo"));
}

const MERGE_KEY = "pictalk-pending-merge"; // { token, at }: retried for an hour if the move fails

/**
 * A guest whose Google / email is already someone's account. An empty guest just switches.
 * A guest with jobs proves who they were (their ID token), switches, and the server moves
 * their jobs, stops, drafts, and files into the account (mergeGuestIntoAccount).
 * Returns the merge counts, or null when there was nothing to move.
 */
async function switchToExisting(guest, credential) {
  if (!(await guestHasWork(guest.uid))) {
    await signInWithCredential(auth, credential);
    return null;
  }
  const token = await guest.getIdToken(true);
  try {
    localStorage.setItem(MERGE_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {
    // private mode: no retry later, but the merge below still runs
  }
  await signInWithCredential(auth, credential);
  return retryGuestMerge();
}

/** Finish a guest merge that was started (also called on app start, in case it was cut off). */
export async function retryGuestMerge() {
  let pending;
  try {
    pending = JSON.parse(localStorage.getItem(MERGE_KEY));
  } catch {
    return null;
  }
  if (!pending?.token || !auth.currentUser || auth.currentUser.isAnonymous) return null;
  if (Date.now() - pending.at > 55 * 60 * 1000) {
    localStorage.removeItem(MERGE_KEY); // the guest's proof has expired
    return null;
  }
  try {
    const result = await mergeGuest(pending.token);
    localStorage.removeItem(MERGE_KEY);
    return result;
  } catch (err) {
    if (err.code === "functions/unauthenticated" || err.code === "functions/permission-denied") localStorage.removeItem(MERGE_KEY);
    throw new AccountError("merge-failed", "You're signed in, but your guest jobs couldn't be moved yet. Keep the app open with signal and they'll move shortly.");
  }
}

export async function continueWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const user = auth.currentUser;
  let merged = null;
  if (user?.isAnonymous) {
    try {
      await linkWithPopup(user, provider);
    } catch (err) {
      if (err.code !== "auth/credential-already-in-use") throw err;
      merged = await switchToExisting(user, GoogleAuthProvider.credentialFromError(err));
    }
  } else {
    await signInWithPopup(auth, provider);
  }
  await auth.currentUser.getIdToken(true);
  return { ...(await ensureProfile()), merged };
}

// ---------- Email me a link ----------

const LINK_KEY = "pictalk-email-link";
const LINK_PARAMS = ["signin", "guest", "apiKey", "oobCode", "mode", "lang", "continueUrl", "tenantId"];

function readLinkStore() {
  try {
    return JSON.parse(localStorage.getItem(LINK_KEY)) || {};
  } catch {
    return {};
  }
}

export async function sendEmailLink(email, { inviteId } = {}) {
  const user = auth.currentUser;
  const url = new URL("/", window.location.origin);
  url.searchParams.set("signin", "1");
  // Which guest started this, so the link can tell if it's opened in another browser
  if (user?.isAnonymous) url.searchParams.set("guest", user.uid);
  if (inviteId) url.searchParams.set("invite", inviteId);
  await sendSignInLinkToEmail(auth, email.trim(), { url: url.href, handleCodeInApp: true });
  try {
    localStorage.setItem(LINK_KEY, JSON.stringify({ email: email.trim() }));
  } catch {
    // private mode: the link page will ask for the email again
  }
}

// The email a link was last sent to from this browser (so the paste box can come back)
export const pendingLinkEmail = () => readLinkStore().email || "";

export const isEmailLinkVisit = () => isSignInWithEmailLink(auth, window.location.href);

// What we know when the email link opens: the email typed on this browser (missing if the
// link opened somewhere else, like Mail opening Safari instead of the home-screen app),
// and whether the guest who asked for it is the one here.
export async function emailLinkInfo() {
  await startSession();
  const guest = new URL(window.location.href).searchParams.get("guest");
  const user = auth.currentUser;
  return {
    email: readLinkStore().email || "",
    otherBrowser: !!guest && !!user && user.uid !== guest,
  };
}

function cleanLinkFromUrl() {
  const url = new URL(window.location.href);
  LINK_PARAMS.forEach((p) => url.searchParams.delete(p));
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

// Finish signing in with the emailed link (opened here, or `href` pasted from the email).
// `anyway` is the user's explicit choice to sign in on a browser that isn't the one they
// started in (their guest jobs stay there).
export async function finishEmailLink(email, { anyway = false, href = window.location.href } = {}) {
  await startSession();
  const opened = href === window.location.href;
  const credential = EmailAuthProvider.credentialWithLink(email.trim(), href);
  const guest = new URL(href).searchParams.get("guest");
  const user = auth.currentUser;
  let merged = null;
  if (user?.isAnonymous && (!guest || guest === user.uid)) {
    try {
      await linkWithCredential(user, credential);
    } catch (err) {
      if (!["auth/email-already-in-use", "auth/credential-already-in-use"].includes(err.code)) throw err;
      merged = await switchToExisting(user, credential);
    }
  } else if (user?.isAnonymous && !anyway) {
    throw new AccountError("other-browser", "Open this link in the same browser or app you started in, so your jobs come with you.");
  } else if (user?.email?.toLowerCase() !== email.trim().toLowerCase()) {
    await signInWithCredential(auth, credential);
  }
  try {
    localStorage.removeItem(LINK_KEY);
  } catch {
    // nothing to clean up
  }
  if (opened) cleanLinkFromUrl();
  await auth.currentUser.getIdToken(true);
  return { ...(await ensureProfile()), merged };
}

export const cancelEmailLink = cleanLinkFromUrl;

// Leaves the account (its jobs stay in it); this phone goes back to being a new guest
export async function signOutToGuest() {
  await signOut(auth);
  await startSession();
}

// ---------- Team (admins) ----------

export function watchOrg(orgId, callback) {
  return onSnapshot(doc(db, "orgs", orgId), (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null), () => callback(null));
}

export function watchTeam(orgId, callback) {
  return onSnapshot(
    query(collection(db, "users"), where("orgId", "==", orgId)),
    (snap) => callback(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    () => callback([])
  );
}

export function watchInvites(orgId, callback) {
  return onSnapshot(
    query(collection(db, "invites"), where("orgId", "==", orgId), orderBy("createdAt", "desc"), limit(50)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => callback([])
  );
}

export const inviteLink = (inviteId) => `${window.location.origin}/?invite=${inviteId}`;
