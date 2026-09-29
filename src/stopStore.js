// src/stopStore.js — PicTalk Phase 3
// Offline-first: every stop is saved to IndexedDB first, then synced to
// Firebase Storage (photo + voice) and Firestore (the stop record).
import { get, set, del, keys } from 'idb-keyval';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, serverTimestamp, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, storage } from './firebase';

const QUEUE_PREFIX = 'pending-stop:';
const VOICE_DAYS = 5; // matches the Storage lifecycle rule on voice/

const baseType = (t) => (t || 'application/octet-stream').split(';')[0];
function extFor(type = '') {
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('png')) return 'png';
  if (type.includes('heic')) return 'heic';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'bin';
}

// ---------- change listeners (so the UI can refresh pending items) ----------
const listeners = new Set();
export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

// ---------- local queue ----------
/** Save a stop locally (instant, survives refresh/offline), then try to sync. */
export async function queueStop({ photoBlob, audioBlob, note = '' }) {
  const stop = {
    id: crypto.randomUUID(),
    photoBlob: photoBlob || null,
    audioBlob: audioBlob || null,
    note,
    clientCreatedAt: Date.now(),
    attempts: 0,
  };
  await set(QUEUE_PREFIX + stop.id, stop);
  notify();
  syncQueue(); // fire and forget
  return stop;
}

/** Stops saved on this device that haven't reached Firebase yet (newest first). */
export async function getPendingStops() {
  const ids = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX));
  const items = await Promise.all(ids.map((k) => get(k)));
  return items.filter(Boolean).sort((a, b) => b.clientCreatedAt - a.clientCreatedAt);
}

// ---------- sync ----------
let syncing = false;

export async function syncQueue() {
  if (syncing || !navigator.onLine) return;
  const user = auth.currentUser;
  if (!user) return;
  syncing = true;
  try {
    const pending = (await getPendingStops()).reverse(); // oldest first
    for (const stop of pending) {
      try {
        await uploadStop(user.uid, stop);
        await del(QUEUE_PREFIX + stop.id);
      } catch (err) {
        console.warn('Stop sync failed, will retry:', stop.id, err);
        await set(QUEUE_PREFIX + stop.id, {
          ...stop,
          attempts: (stop.attempts || 0) + 1,
          lastError: String(err?.code || err),
        });
        if (!navigator.onLine) break;
      }
      notify();
    }
  } finally {
    syncing = false;
  }
}

async function uploadStop(uid, stop) {
  let photoPath = null;
  let audioPath = null;
  let audioType = null;

  if (stop.photoBlob) {
    const type = baseType(stop.photoBlob.type || 'image/jpeg');
    photoPath = `photos/${uid}/${stop.id}.${extFor(type)}`;
    await uploadBytes(ref(storage, photoPath), stop.photoBlob, { contentType: type });
  }
  if (stop.audioBlob) {
    audioType = baseType(stop.audioBlob.type || 'audio/webm');
    audioPath = `voice/${uid}/${stop.id}.${extFor(audioType)}`;
    await uploadBytes(ref(storage, audioPath), stop.audioBlob, { contentType: audioType });
  }

  // Written last, so a Firestore doc only exists once its files are uploaded.
  await setDoc(doc(db, 'users', uid, 'stops', stop.id), {
    photoPath,
    audioPath,
    audioType,
    audioExpiresAt: audioPath ? stop.clientCreatedAt + VOICE_DAYS * 86400000 : null,
    note: stop.note || '',
    transcript: null, // filled in later by Cloud Functions
    status: 'uploaded',
    clientCreatedAt: stop.clientCreatedAt,
    createdAt: serverTimestamp(),
  });
}

/** Call once on app start. Retries on reconnect, app refocus, sign-in, and every 60s. */
export function startAutoSync() {
  const run = () => syncQueue();
  const onVis = () => document.visibilityState === 'visible' && run();
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVis);
  const unsubAuth = onAuthStateChanged(auth, (u) => u && run());
  const timer = setInterval(run, 60000);
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVis);
    unsubAuth();
    clearInterval(timer);
  };
}

// ---------- reading synced stops ----------
/** Live list of this user's synced stops, newest first. Returns an unsubscribe fn. */
export function watchStops(uid, callback) {
  const q = query(collection(db, 'users', uid, 'stops'), orderBy('clientCreatedAt', 'desc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/** Download URL for a stored file, or null if missing (e.g. voice note past 5 days). */
export async function urlFor(path) {
  if (!path) return null;
  try {
    return await getDownloadURL(ref(storage, path));
  } catch {
    return null;
  }
}
