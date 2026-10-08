// Shared test helpers: fake "phones" signed in through the Auth emulator, calling the real
// functions in the Functions emulator. Used by the *.test.js files (run with `npm test`).
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from "firebase/firestore";

export const run = Math.random().toString(36).slice(2, 8); // fresh emails each run
const apps = [];

/** One signed-out "phone" per person. */
export function phone() {
  const app = initializeApp({ apiKey: "fake", projectId: "demo-pictalk" }, `p${apps.length}-${run}-${Math.random()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const fns = getFunctions(app, "us-west2");
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const call = (name, data) => httpsCallable(fns, name, { timeout: 120000 })(data).then((r) => r.data);
  const profile = async () => (await getDoc(doc(db, `users/${auth.currentUser.uid}`))).data();
  return { auth, db, call, profile };
}

// The Auth emulator accepts an unsigned Google token
export const google = (email) => GoogleAuthProvider.credential(JSON.stringify({ sub: `g-${email}`, email, email_verified: true }));
export const mail = (name) => `${name}-${run}@example.com`;

/** A signed-in personal account with its profile made. */
export async function personal(name) {
  const p = phone();
  await signInWithCredential(p.auth, google(mail(name)));
  await p.call("ensureProfile");
  return p;
}

export async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code.includes("/") ? code : `functions/${code}`, err.message);
    return true;
  });
}

/** A Firestore read/write the security rules must refuse. */
export async function blocked(promise) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, "permission-denied", err.message);
    return true;
  });
}

export const closeAll = () => Promise.all(apps.map((a) => deleteApp(a)));
