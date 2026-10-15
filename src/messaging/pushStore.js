// Phone alerts (web push through Firebase Cloud Messaging, part of the firebase package already used).
// Turning alerts on asks the browser's permission, gets this phone's push address from FCM (using our own
// service worker, public/sw.js, which shows the notification), and saves it at
// procoreUsers/{procoreUserId}/pushTokens/{token} (the rules let only that person add or remove theirs).
// functions/messaging.js sends to everyone on a thread except the sender. Needs VITE_FCM_VAPID_KEY (the
// project's public Web Push key from Firebase: Project settings > Cloud Messaging > Web Push certificates).
import { deleteToken, getMessaging, getToken, isSupported } from "firebase/messaging";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { db, firebaseApp } from "../firebase";

const VAPID = import.meta.env.VITE_FCM_VAPID_KEY;
const FLAG = "sitesnap-push:"; // + procoreUserId -> this phone's token, so the switch shows On

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;

/** off | on | blocked | install (iPhone: add to Home Screen first) | unsupported | not-set-up */
export async function pushState(myId) {
  if (!VAPID) return "not-set-up";
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return isIos() && !installed() ? "install" : "unsupported";
  if (!(await isSupported().catch(() => false))) return isIos() && !installed() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && store()?.getItem(FLAG + myId) ? "on" : "off";
}

export async function turnOnPush(myId) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(firebaseApp), { vapidKey: VAPID, serviceWorkerRegistration: registration });
  if (!token) throw new Error("This browser didn't give a push address. Try again.");
  await setDoc(doc(db, `procoreUsers/${myId}/pushTokens/${token}`), { token, at: Date.now(), ua: navigator.userAgent.slice(0, 120) });
  try { store()?.setItem(FLAG + myId, token); } catch { /* full */ }
  return "on";
}

export async function turnOffPush(myId) {
  const token = store()?.getItem(FLAG + myId);
  if (token) await deleteDoc(doc(db, `procoreUsers/${myId}/pushTokens/${token}`)).catch(() => {});
  await deleteToken(getMessaging(firebaseApp)).catch(() => {});
  try { store()?.removeItem(FLAG + myId); } catch { /* ignore */ }
  return "off";
}
