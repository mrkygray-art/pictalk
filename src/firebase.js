import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCpi_XSpfJzpBHt0-kFFP8G-TQaou7SmA8",
  authDomain: "pictalk-6cbff.firebaseapp.com",
  projectId: "pictalk-6cbff",
  storageBucket: "pictalk-6cbff.firebasestorage.app",
  messagingSenderId: "70549299789",
  appId: "1:70549299789:web:9e79ae34bd4b4210b77204",
  measurementId: "G-DH60FS6YBW"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });
export const storage = getStorage(app);

// Local testing only: `VITE_USE_EMULATORS=true npm run dev` talks to the Firebase
// emulators (firebase emulators:start) instead of the live project.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

export const startSession = () => signInAnonymously(auth);