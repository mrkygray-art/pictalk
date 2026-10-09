// src/jobStore.js — PicTalk jobs
// A job groups stops (one visit to one site). Jobs live in Firestore at
// users/{uid}/jobs/{jobId}. At most one job is 'open' at a time; new stops go into it.
// Writes are not awaited: Firestore's local cache shows them right away and
// uploads them when the phone is back online.
import {
  doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, collection, query, orderBy, onSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import { EARLIER_JOB_ID, getPendingStops, updatePendingStop } from './stopStore';

export { EARLIER_JOB_ID };

/**
 * Delete a finished job for good, with its stops, photos, voice notes, wrap-up recordings,
 * Piccolo drafts and finals, and exports (functions/guests.js deleteJob). Needs signal.
 */
export async function deleteJob(job) {
  if (!navigator.onLine) throw new Error('offline');
  if ((await getPendingStops()).some((s) => s.jobId === job.id)) throw new Error('pending');
  return (await httpsCallable(functions, 'deleteJob', { timeout: 130000 })({ jobId: job.id })).data;
}

const jobRef = (uid, id) => doc(db, 'users', uid, 'jobs', id);
const warn = (what) => (err) => console.warn(`${what} failed:`, err);

/** Name used until we know where the job is, e.g. "Job · Sep 29, 2:14 PM". */
export function defaultJobName(t = Date.now()) {
  const d = new Date(t);
  const day = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Job · ${day}, ${time}`;
}

/** "Sep 30, 2026 2:14 PM" */
export function formatJobStart(t) {
  const d = new Date(t);
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

/**
 * The name shown everywhere for a job: "Customer – Location – Sep 30, 2026 2:14 PM",
 * leaving out blank parts. Jobs with neither field keep their stored name
 * (e.g. "Job · Sep 29, 2:14 PM" or "Earlier stops").
 */
export function jobTitle(job) {
  if (!job) return '';
  const parts = [job.customer, job.location].map((v) => (v || '').trim()).filter(Boolean);
  if (!parts.length) return job.name || defaultJobName(job.startedAt);
  return [...parts, formatJobStart(job.startedAt)].join(' – ');
}

const DETAIL_MAX = 100;
const cleanDetail = (v) => (v || '').trim().slice(0, DETAIL_MAX) || null;

/** Live list of this user's jobs, newest first. Returns an unsubscribe fn. */
export function watchJobs(uid, callback) {
  const q = query(collection(db, 'users', uid, 'jobs'), orderBy('startedAt', 'desc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/** Start a new open job, finishing any jobs still open. Returns the new job right away. */
export function startJob(uid, openJobs = [], fields = {}) {
  const now = Date.now();
  const job = {
    name: fields.name || defaultJobName(now),
    address: fields.address ?? null,
    lat: fields.lat ?? null,
    lng: fields.lng ?? null,
    status: 'open',
    startedAt: now,
    endedAt: null,
    lastStopAt: null,
  };
  const id = crypto.randomUUID();
  const batch = writeBatch(db);
  openJobs.forEach((j) => batch.update(jobRef(uid, j.id), { status: 'finished', endedAt: now }));
  batch.set(jobRef(uid, id), job);
  batch.commit().catch(warn('Start job'));
  return { id, ...job };
}

/** Finish a job, saving the optional Customer and Location typed at End Job. */
export function endJob(uid, jobId, details = {}) {
  updateDoc(jobRef(uid, jobId), {
    status: 'finished',
    endedAt: Date.now(),
    customer: cleanDetail(details.customer),
    location: cleanDetail(details.location),
  }).catch(warn('End job'));
}

/** Change a job's Customer and Location later (either may be blank). */
export function setJobDetails(uid, jobId, details) {
  updateDoc(jobRef(uid, jobId), {
    customer: cleanDetail(details.customer),
    location: cleanDetail(details.location),
  }).catch(warn('Update job details'));
}

/** Make a finished job the open one again, finishing any other open job in the same write. */
export function reopenJob(uid, jobId, openJobs = []) {
  const now = Date.now();
  const batch = writeBatch(db);
  openJobs
    .filter((j) => j.id !== jobId)
    .forEach((j) => batch.update(jobRef(uid, j.id), { status: 'finished', endedAt: now }));
  batch.update(jobRef(uid, jobId), { status: 'open', endedAt: null });
  batch.commit().catch(warn('Reopen job'));
}

/** Record that a stop was just saved to this job. */
export function touchJob(uid, jobId, at = Date.now()) {
  updateDoc(jobRef(uid, jobId), { lastStopAt: at }).catch(warn('Update job'));
}

// ---------- one-time move of pre-jobs stops into "Earlier stops" ----------
const doneKey = (uid) => `pictalk-earlier-migrated:${uid}`;
let migrating = null;

/** Put stops saved before jobs existed into a finished "Earlier stops" job. Safe to call repeatedly. */
export function migrateEarlierStops(uid) {
  try {
    if (localStorage.getItem(doneKey(uid))) return Promise.resolve();
  } catch { /* storage blocked: just run it */ }
  if (!migrating) {
    migrating = runMigration(uid)
      .then((done) => {
        try {
          if (done) localStorage.setItem(doneKey(uid), '1');
        } catch { /* ignore */ }
      })
      .catch(warn('Earlier stops move'))
      .finally(() => { migrating = null; });
  }
  return migrating;
}

async function runMigration(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'stops'));
  const legacyCloud = snap.docs.filter((d) => !d.data().jobId);
  const legacyPending = (await getPendingStops()).filter((s) => !s.jobId);
  const inEarlier = snap.docs.filter((d) => d.data().jobId === EARLIER_JOB_ID);
  if (!legacyCloud.length && !legacyPending.length && !inEarlier.length) return true;

  // Create the job first so no stop ever points at a job that doesn't exist
  const ref = jobRef(uid, EARLIER_JOB_ID);
  if (!(await getDoc(ref)).exists()) {
    const times = [...legacyCloud, ...inEarlier].map((d) => d.data().clientCreatedAt)
      .concat(legacyPending.map((s) => s.clientCreatedAt))
      .filter(Number.isFinite);
    const first = times.length ? Math.min(...times) : Date.now();
    const last = times.length ? Math.max(...times) : Date.now();
    setDoc(ref, {
      name: 'Earlier stops',
      address: null,
      lat: null,
      lng: null,
      status: 'finished',
      startedAt: first,
      endedAt: last,
      lastStopAt: last,
    }).catch(warn('Create Earlier stops job'));
  }

  for (let i = 0; i < legacyCloud.length; i += 400) {
    const batch = writeBatch(db);
    legacyCloud.slice(i, i + 400).forEach((d) => batch.update(d.ref, { jobId: EARLIER_JOB_ID }));
    batch.commit().catch(warn('Move stops to Earlier stops'));
  }
  for (const s of legacyPending) await updatePendingStop(s.id, { jobId: EARLIER_JOB_ID });

  return !legacyCloud.length && !legacyPending.length;
}
