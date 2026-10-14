// Firestore for the Vercel functions (server only), through firebase-admin.
// Credentials: FIREBASE_SERVICE_ACCOUNT_B64 = the service-account JSON key, base64 on one line
// (no line-break trouble in Vercel's env editor). The key must belong to sitesnap-procore, so a
// PicTalk key pasted by mistake is refused. Never log or return the key or anything from it.
// Tests swap the store with setStore() and never load firebase-admin.
import { HttpError } from "./_procore.js";

export const FIREBASE_PROJECT = "sitesnap-procore";
let store = null;

export function setStore(s) {
  store = s;
}

// The service-account JSON from the env var, checked; throws a setup error naming only the variable
export function serviceAccount(env = process.env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!raw) throw new HttpError(500, "not_configured", "Firestore isn't set up on this server (missing FIREBASE_SERVICE_ACCOUNT_B64).");
  let key;
  try {
    key = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    throw new HttpError(500, "not_configured", "FIREBASE_SERVICE_ACCOUNT_B64 isn't a base64-encoded JSON key.");
  }
  if (key?.type !== "service_account" || !key.client_email || !key.private_key) {
    throw new HttpError(500, "not_configured", "FIREBASE_SERVICE_ACCOUNT_B64 isn't a service-account key.");
  }
  if (key.project_id !== FIREBASE_PROJECT) {
    throw new HttpError(500, "not_configured", `FIREBASE_SERVICE_ACCOUNT_B64 is for another project; it must be ${FIREBASE_PROJECT}.`);
  }
  return key;
}

// The firebase-admin app for sitesnap-procore (loaded only when first needed)
async function adminApp() {
  const key = serviceAccount();
  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  return getApps().find((a) => a.name === "sitesnap") ?? initializeApp({ credential: cert(key), projectId: FIREBASE_PROJECT }, "sitesnap");
}

// Firestore (firebase-admin loaded only when first needed)
export async function firestore() {
  if (store) return store;
  const { getFirestore } = await import("firebase-admin/firestore");
  store = getFirestore(await adminApp());
  return store;
}

// Firebase Auth, for signing a SiteSnap sign-in token for a Procore user (signed locally with the
// service-account key; needs no extra IAM role). Tests swap it with setAuth().
let auth = null;
export const setAuth = (a) => { auth = a; };
export async function firebaseAuth() {
  if (auth) return auth;
  const { getAuth } = await import("firebase-admin/auth");
  auth = getAuth(await adminApp());
  return auth;
}
