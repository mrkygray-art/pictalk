// src/wrapUpStore.js — wrap-up notes (field notes / customer comments) for a job
// One note per type at users/{uid}/jobs/{jobId}/wrapUpNotes/{field|customer}. A note is a
// list of audio pieces ("segments"); each recording session adds one piece. Like stops,
// a new piece is saved on the phone first (IndexedDB) and uploaded when there's signal;
// the transcribeWrapUpNote Cloud Function then writes its transcript.
import { get, set, del, keys } from 'idb-keyval';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';
import {
  doc, getDoc, setDoc, deleteDoc, collection, onSnapshot, arrayUnion, increment,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, storage } from './firebase';
import { baseType, extFor, urlFor, VOICE_DAYS } from './stopStore';

export const NOTE_TYPES = {
  field: { label: 'Field notes', add: 'Add field notes', consent: false },
  customer: { label: 'Customer comments', add: 'Add customer comments', consent: true },
};

const QUEUE_PREFIX = 'pending-note:';
const noteRef = (uid, jobId, type) => doc(db, 'users', uid, 'jobs', jobId, 'wrapUpNotes', type);

// ---------- change listeners (pending pieces on this phone) ----------
const listeners = new Set();
export function onNoteQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

/** Live notes for a job from the cloud: calls back with { field?, customer? }. */
export function watchNotes(uid, jobId, callback) {
  return onSnapshot(
    collection(db, 'users', uid, 'jobs', jobId, 'wrapUpNotes'),
    (snap) => {
      const notes = {};
      snap.docs.forEach((d) => { notes[d.id] = d.data(); });
      callback(notes);
    },
    (err) => {
      console.warn('Watching wrap-up notes failed:', err);
      callback({});
    }
  );
}

/** Pieces recorded on this phone that haven't uploaded yet, for one job. */
export async function getPendingPieces(jobId) {
  const ids = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(QUEUE_PREFIX));
  const items = await Promise.all(ids.map((k) => get(k)));
  return items.filter((p) => p && (!jobId || p.jobId === jobId)).sort((a, b) => a.createdAt - b.createdAt);
}

/** Save a finished recording session on the phone (instant), then try to upload it. */
export async function queuePiece({ jobId, type, blob, durationSec, consentShown, liveTranscript = '', streamOk = false, textIncluded = false }) {
  const piece = {
    id: crypto.randomUUID(),
    jobId,
    type,
    blob,
    audioType: baseType(blob.type || 'audio/webm'),
    durationSec: Math.max(0, Math.round(durationSec)),
    consentShown: !!consentShown,
    liveTranscript: String(liveTranscript || '').slice(0, 20000),
    streamOk: !!streamOk,
    textIncluded: !!textIncluded,
    createdAt: Date.now(),
    attempts: 0,
  };
  await set(QUEUE_PREFIX + piece.id, piece);
  notify();
  syncNoteQueue();
  return piece;
}

let syncing = false;

/** Upload waiting pieces, oldest first. Each piece's audio goes up before the note changes. */
export async function syncNoteQueue() {
  if (syncing || !navigator.onLine) return;
  const user = auth.currentUser;
  if (!user) return;
  syncing = true;
  try {
    for (const piece of await getPendingPieces()) {
      try {
        await uploadPiece(user.uid, piece);
        await del(QUEUE_PREFIX + piece.id);
      } catch (err) {
        console.warn('Wrap-up note upload failed, will retry:', piece.id, err);
        await set(QUEUE_PREFIX + piece.id, { ...piece, attempts: (piece.attempts || 0) + 1, lastError: String(err?.code || err) });
        if (!navigator.onLine) break;
      }
      notify();
    }
  } finally {
    syncing = false;
  }
}

async function uploadPiece(uid, piece) {
  const audioPath = `voice/${uid}/wrapup-${piece.jobId}-${piece.type}-${piece.id}.${extFor(piece.audioType)}`;
  await uploadBytes(ref(storage, audioPath), piece.blob, { contentType: piece.audioType });
  const target = noteRef(uid, piece.jobId, piece.type);
  const exists = (await getDoc(target)).exists();
  await setDoc(
    target,
    {
      type: piece.type,
      createdBy: uid,
      ...(exists ? {} : { createdAt: piece.createdAt, text: '', edited: false, liveTranscript: '' }),
      ...(piece.consentShown ? { consentShown: true } : {}),
      segments: arrayUnion({
        id: piece.id,
        audioPath,
        audioType: piece.audioType,
        durationSec: piece.durationSec,
        audioExpiresAt: piece.createdAt + VOICE_DAYS * 86400000,
        // "live": the live stream stayed connected, so its words are the transcript.
        // "uploaded": the Cloud Function transcribes the full audio (batch fallback).
        status: piece.streamOk && (piece.liveTranscript || '').trim() ? 'live' : 'uploaded',
        liveTranscript: piece.liveTranscript || '',
        textIncluded: !!piece.textIncluded,
        transcript: null,
        createdAt: piece.createdAt,
      }),
      durationSec: increment(piece.durationSec),
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

/** Retry uploads on reconnect, app refocus, sign-in, and every 60s (same triggers as stops). */
export function startNoteAutoSync() {
  const run = () => syncNoteQueue();
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

// ---------- editing and deleting ----------
/** Save the user's typed text. From now on new speech is only appended after it. Works offline. */
export function saveNoteText(uid, jobId, type, text) {
  return setDoc(
    noteRef(uid, jobId, type),
    { type, createdBy: uid, text: String(text).slice(0, 20000), edited: true, updatedAt: Date.now() },
    { merge: true }
  ).catch((err) => console.warn('Saving wrap-up note text failed:', err));
}

/**
 * Delete a note: its waiting pieces, its audio files, and the note itself.
 * Uploaded audio can only be removed with signal (so no files are left behind).
 */
export async function deleteNote(uid, jobId, type) {
  for (const p of (await getPendingPieces(jobId)).filter((x) => x.type === type)) await del(QUEUE_PREFIX + p.id);
  notify();
  const target = noteRef(uid, jobId, type);
  const snap = await getDoc(target).catch(() => null);
  const segments = snap?.exists() ? snap.get('segments') || [] : [];
  if (segments.length && !navigator.onLine) throw new Error('offline');
  await Promise.all(
    segments.map((s) =>
      deleteObject(ref(storage, s.audioPath)).catch((err) => {
        if (err?.code !== 'storage/object-not-found') throw err; // audio expires after 5 days
      })
    )
  );
  // Not awaited: Firestore deletes locally right away and syncs when online
  if (snap?.exists() || !navigator.onLine) deleteDoc(target).catch((err) => console.warn('Deleting wrap-up note failed:', err));
}

/** Playable links for a note's audio, in recording order (null where it expired). */
export async function noteAudioUrls(note, pending) {
  const cloud = [...(note?.segments || [])]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(async (s) => ({ at: s.createdAt, url: await urlFor(s.audioPath) }));
  const local = (pending || []).map((p) => Promise.resolve({ at: p.createdAt, url: URL.createObjectURL(p.blob), local: true }));
  return (await Promise.all([...cloud, ...local])).sort((a, b) => a.at - b.at);
}

/**
 * One view of a note combining the cloud record and pieces still on this phone.
 * status: "empty" | "waiting-upload" | "transcribing" | "ready" | "no-speech" | "failed"
 */
export function describeNote(note, pending = []) {
  const segments = note?.segments || [];
  const text = (note?.text || '').trim();
  const durationSec = (note?.durationSec || 0) + pending.reduce((n, p) => n + (p.durationSec || 0), 0);
  let status = 'ready';
  if (!segments.length && !pending.length && !text) status = 'empty';
  else if (pending.length) status = 'waiting-upload';
  else if (segments.some((s) => ['uploaded', 'live', 'transcribing'].includes(s.status))) status = 'transcribing';
  else if (!text && segments.length && segments.every((s) => s.status === 'no_speech')) status = 'no-speech';
  else if (!text && segments.some((s) => s.status === 'transcription_failed')) status = 'failed';
  return { text, durationSec, status, edited: !!note?.edited, exists: !!note || pending.length > 0 };
}

/** "0:58" */
export const formatDuration = (sec) => `${Math.floor((sec || 0) / 60)}:${String(Math.round(sec || 0) % 60).padStart(2, '0')}`;
