import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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

export const startSession = () => signInAnonymously(auth);