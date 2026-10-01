// src/summaryStore.js — AI draft summary for a job
// Stored at users/{uid}/jobs/{jobId}/ai/summary. Only the generateJobSummary Cloud
// Function creates it; the app reads it and saves the user's edits and approval.
// Stops, photos, audio, and transcripts are never changed here.
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';

export const PRIORITIES = ['high', 'medium', 'low'];

const summaryRef = (uid, jobId) => doc(db, 'users', uid, 'jobs', jobId, 'ai', 'summary');

/** Live summary for a job: calls back with the data, or null if there isn't one. */
export function watchSummary(uid, jobId, callback) {
  return onSnapshot(
    summaryRef(uid, jobId),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err) => {
      console.warn('Watching summary failed:', err);
      callback(null);
    }
  );
}

/** A summary has content once the function has written one (a failed first try leaves only a counter). */
export const hasSummary = (s) => !!(s && typeof s.summary === 'string');

const generate = httpsCallable(functions, 'generateJobSummary', { timeout: 130000 });

/** Ask the server to build (or rebuild) the draft. Throws an Error with a friendly message. */
export async function requestSummary(jobId) {
  if (!navigator.onLine) throw new Error('Building a summary needs signal. Try again when you are online.');
  try {
    await generate({ jobId });
  } catch (err) {
    const code = String(err?.code || '').replace('functions/', '');
    // These carry a message written for the user by the function
    // Drop any status code the SDK adds, e.g. "… [400]" or "… (functions/not-found)"
    const message = String(err.message || '').replace(/\s*[[(][^\])]*[\])]\s*$/, '');
    if (['resource-exhausted', 'failed-precondition', 'not-found'].includes(code)) throw new Error(message, { cause: err });
    if (code === 'unavailable' || code === 'deadline-exceeded') {
      throw new Error("The summary took too long or the connection dropped. Please try again.", { cause: err });
    }
    console.error('Summary request failed:', err);
    throw new Error("The summary couldn't be built right now. Please try again.", { cause: err });
  }
}

/**
 * Save the user's edits. Editing an approved summary puts it back to draft, so the PDF
 * only ever shows text that was approved as-is. Works offline (syncs later).
 */
export function saveSummaryEdits(uid, jobId, { summary, action_items, open_questions }) {
  return updateDoc(summaryRef(uid, jobId), {
    summary,
    action_items,
    open_questions,
    status: 'draft',
    approvedAt: null,
    approvedBy: null,
    approvedByUid: null,
    editedAt: Date.now(),
  }).catch((err) => console.warn('Saving summary edits failed:', err));
}

/**
 * Approve the summary as currently written (saves any unsaved edits in the same write).
 * editedAt is only set when there were edits, so "hand-edited" stays accurate.
 */
export function approveSummary(uid, jobId, { summary, action_items, open_questions }, approvedBy, hadEdits = false) {
  return updateDoc(summaryRef(uid, jobId), {
    summary,
    action_items,
    open_questions,
    ...(hadEdits ? { editedAt: Date.now() } : {}),
    status: 'approved',
    approvedAt: Date.now(),
    approvedBy,
    approvedByUid: uid,
  }).catch((err) => console.warn('Approving summary failed:', err));
}

/** A stop is still being transcribed (same rule the server uses). */
export function isTranscriptPending(stop, now = Date.now()) {
  if (stop.isPending) return !!stop.audioBlob; // still on the phone
  if (!stop.audioPath) return false;
  if (['transcribed', 'no_speech', 'transcription_failed'].includes(stop.status)) return false;
  const created = stop.createdAt?.toMillis?.() ?? stop.clientCreatedAt ?? 0;
  return now - created < 5 * 60 * 1000;
}
