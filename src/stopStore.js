// src/stopStore.js — PicTalk Phase 3
// Offline-first: every stop is saved to IndexedDB first, then synced to
// Firebase Storage (photo + voice) and Firestore (the stop record).
import { get, set, del, keys } from 'idb-keyval';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, query, orderBy, onSnapshot,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, storage } from './firebase';
import { engLog, recordUpload, setSyncInfo, bytes, ms } from './engineering';

const QUEUE_PREFIX = 'pending-stop:';
export const VOICE_DAYS = 5; // matches the Storage lifecycle rule on voice/
export const EARLIER_JOB_ID = 'earlier'; // job for stops saved before jobs existed

export const baseType = (t) => (t || 'application/octet-stream').split(';')[0];
export function extFor(type = '') {
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
export async function queueStop({ photoBlob, audioBlob, note = '', jobId }) {
  const stop = {
    id: crypto.randomUUID(),
    jobId,
    photoBlob: photoBlob || null,
    audioBlob: audioBlob || null,
    note,
    clientCreatedAt: Date.now(),
    attempts: 0,
  };
  await set(QUEUE_PREFIX + stop.id, stop);
  engLog('save', 'Saved on this phone', `IndexedDB · ${[photoBlob && `photo ${bytes(photoBlob.size)}`, audioBlob && `voice ${bytes(audioBlob.size)}`].filter(Boolean).join(', ')}`);
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

/** Change a stop still waiting on this phone. Returns false if it already uploaded. */
export async function updatePendingStop(id, patch) {
  const stop = await get(QUEUE_PREFIX + id);
  if (!stop) return false;
  await set(QUEUE_PREFIX + id, { ...stop, ...patch });
  notify();
  return true;
}

// ---------- corrected words ----------
/** The words for a stop: the user's correction if there is one, else the transcript. */
export const stopText = (stop) => (stop?.editedTranscript ?? stop?.transcript ?? '').trim();

/**
 * Save the user's corrected words. The original transcript is kept untouched; the
 * correction is stored next to it and used everywhere. Works offline (syncs later).
 */
export function saveStopText(uid, stop, text) {
  const words = String(text || '').trim().slice(0, 5000);
  return updateDoc(doc(db, 'users', uid, 'stops', stop.id), {
    // Saving the original words again simply clears the correction
    editedTranscript: words === (stop.transcript || '').trim() ? null : words,
    transcriptEditedAt: Date.now(),
  }).catch((err) => console.warn('Saving corrected words failed:', err));
}

// ---------- moving and deleting ----------
/** Put a stop into a different job. Works offline. */
export async function moveStop(uid, stop, jobId) {
  if (stop.isPending && (await updatePendingStop(stop.id, { jobId }))) return;
  // Not awaited: the local cache updates right away and syncs when online
  updateDoc(doc(db, 'users', uid, 'stops', stop.id), { jobId })
    .catch((err) => console.warn('Move stop failed:', err));
}

/**
 * Delete a stop and its photo and voice files for good.
 * An uploaded stop needs signal, so its files are never left behind.
 */
export async function deleteStop(uid, stop) {
  if (stop.isPending && (await get(QUEUE_PREFIX + stop.id))) {
    await del(QUEUE_PREFIX + stop.id);
    notify();
    return;
  }
  if (!navigator.onLine) throw new Error('offline');
  const stopRef = doc(db, 'users', uid, 'stops', stop.id);
  // Read the file paths from the record (the stop may have finished uploading just now)
  const saved = (await getDoc(stopRef)).data() ?? stop;
  const removeFile = (path) =>
    path &&
    deleteObject(ref(storage, path)).catch((err) => {
      if (err?.code !== 'storage/object-not-found') throw err; // voice notes expire after 5 days
    });
  await Promise.all([removeFile(saved.photoPath), removeFile(saved.audioPath)]);
  await deleteDoc(stopRef);
}

// ---------- sync ----------
let syncing = false;

export async function syncQueue() {
  if (syncing || !navigator.onLine) return;
  const user = auth.currentUser;
  if (!user) return;
  syncing = true;
  setSyncInfo({ running: true, lastRunAt: Date.now() });
  let sent = 0;
  let failed = 0;
  try {
    const pending = (await getPendingStops()).reverse(); // oldest first
    for (const stop of pending) {
      try {
        await uploadStop(user.uid, stop);
        await del(QUEUE_PREFIX + stop.id);
        sent++;
      } catch (err) {
        failed++;
        engLog('error', 'Upload failed, will retry', String(err?.code || err));
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
    setSyncInfo({ running: false, lastResult: sent || failed ? `${sent} uploaded, ${failed} failed` : 'Nothing waiting' });
  }
}

async function uploadStop(uid, stop) {
  let photoPath = null;
  let audioPath = null;
  let audioType = null;
  const timing = {}; // Engineering Mode: how long each step took on this phone
  const started = performance.now();
  let t = started;
  const lap = () => {
    const now = performance.now();
    const took = now - t;
    t = now;
    return took;
  };

  if (stop.photoBlob) {
    const type = baseType(stop.photoBlob.type || 'image/jpeg');
    photoPath = `photos/${uid}/${stop.id}.${extFor(type)}`;
    await uploadBytes(ref(storage, photoPath), stop.photoBlob, { contentType: type });
    Object.assign(timing, { photoBytes: stop.photoBlob.size, photoMs: lap() });
  }
  if (stop.audioBlob) {
    audioType = baseType(stop.audioBlob.type || 'audio/webm');
    audioPath = `voice/${uid}/${stop.id}.${extFor(audioType)}`;
    await uploadBytes(ref(storage, audioPath), stop.audioBlob, { contentType: audioType });
    Object.assign(timing, { audioBytes: stop.audioBlob.size, audioMs: lap() });
  }

  // Written last, so a Firestore doc only exists once its files are uploaded.
  await setDoc(doc(db, 'users', uid, 'stops', stop.id), {
    jobId: stop.jobId || EARLIER_JOB_ID, // saved on this phone before jobs existed
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
  timing.recordMs = lap();
  recordUpload(stop.id, timing);
  engLog('upload', 'Stop uploaded', [
    timing.photoMs != null && `photo ${bytes(timing.photoBytes)} in ${ms(timing.photoMs)}`,
    timing.audioMs != null && `voice ${bytes(timing.audioBytes)} in ${ms(timing.audioMs)}`,
    `record ${ms(timing.recordMs)}`,
  ].filter(Boolean).join(' · '));
}

/** Call once on app start. Retries on reconnect, app refocus, sign-in, and every 60s. */
export function startAutoSync() {
  const run = () => syncQueue();
  const onVis = () => document.visibilityState === 'visible' && run();
  const tick = () => {
    setSyncInfo({ nextRunAt: Date.now() + 60000 });
    run();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVis);
  const unsubAuth = onAuthStateChanged(auth, (u) => u && run());
  const timer = setInterval(tick, 60000);
  setSyncInfo({ nextRunAt: Date.now() + 60000 });
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
