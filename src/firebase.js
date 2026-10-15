import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// SiteSnap AI (branch sitesnap): its own Firebase project, sitesnap-procore (us-west2), never
// PicTalk's pictalk-6cbff. These values are public identifiers, not secrets; access is enforced by
// the security rules. (PicTalk's own config stays on master.)
const liveConfig = {
  apiKey: "AIzaSyDEFRK4HNMwNh3YxAd-YRvykHNyGabuYww",
  authDomain: "sitesnap-procore.firebaseapp.com",
  projectId: "sitesnap-procore",
  storageBucket: "sitesnap-procore.firebasestorage.app",
  messagingSenderId: "728186372367",
  appId: "1:728186372367:web:1c91a58ce67835034cfe7a",
};

// Piccolo test site (`npm run deploy:dev`): builds with `--mode devcloud` use the separate
// test project pictalk-dev-52368, never the live one.
const devCloudConfig = {
  apiKey: "AIzaSyBESQfTp9kD_DcwusITDVG7h8muu13G90Q",
  authDomain: "pictalk-dev-52368.firebaseapp.com",
  projectId: "pictalk-dev-52368",
  storageBucket: "pictalk-dev-52368.firebasestorage.app",
  messagingSenderId: "31334707851",
  appId: "1:31334707851:web:011dd076d70619d94dda8e",
};
const devCloud = import.meta.env.MODE === "devcloud";

// Local testing only: `npm run dev` (via .env.development), `npm run dev:emulators`, or
// `VITE_USE_EMULATORS=true npm run dev` talks to the Firebase emulators (npm run emulators)
// instead of the live project. The Evaluation Lab also builds with `vite build --mode emulators`
// (into dist-lab, never deployed) so it can test the real offline app; a normal
// `npm run build` never connects to them.
const emulatorBuild = import.meta.env.DEV || import.meta.env.MODE === "emulators";
const useEmulators = emulatorBuild && import.meta.env.VITE_USE_EMULATORS === "true";

// The emulators run as "demo-pictalk": a demo- project is offline-only, so nothing
// local can reach the live project's data, files, or functions.
const DEV_PROJECT = "demo-pictalk";
const firebaseConfig = useEmulators
  ? { ...liveConfig, projectId: DEV_PROJECT, authDomain: `${DEV_PROJECT}.firebaseapp.com`, storageBucket: `${DEV_PROJECT}.appspot.com` }
  : devCloud
    ? devCloudConfig
    : liveConfig;

const app = initializeApp(firebaseConfig);

// App Check (abuse and cost control): on once the real project has a reCAPTCHA Enterprise
// site key in VITE_APPCHECK_SITE_KEY; the functions enforce it with PICCOLO_ENFORCE_APP_CHECK=1.
const appCheckKey = import.meta.env.VITE_APPCHECK_SITE_KEY;
if (!useEmulators && appCheckKey) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckKey), isTokenAutoRefreshEnabled: true });
}
export const firebaseApp = app;
export const auth = getAuth(app);
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-west2"); // same region as the Cloud Functions

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

// Everyone starts as a guest (anonymous). Only sign in when nobody is: calling
// signInAnonymously over a saved Google / email account would replace it with a new guest.
export const startSession = async () => {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
};
