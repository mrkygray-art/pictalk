// src/jobStore.js — PicTalk jobs
// A job groups stops (one visit to one site). Jobs live in Firestore at
// users/{uid}/jobs/{jobId}. At most one job is 'open' at a time; new stops go into it.
// Writes are not awaited: Firestore's local cache shows them right away and
// uploads them when the phone is back online.
import {
  doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, collection, query, orderBy, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { EARLIER_JOB_ID, getPendingStops, updatePendingStop } from './stopStore';

export { EARLIER_JOB_ID };

const jobRef = (uid, id) => doc(db, 'users', uid, 'jobs', id);
const warn = (what) => (err) => console.warn(`${what} failed:`, err);

/** Name used until we know where the job is, e.g. "Job · Sep 29, 2:14 PM". */
export function defaultJobName(t = Date.now()) {
  const d = new Date(t);
  const day = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Job · ${day}, ${time}`;
}

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

export function endJob(uid, jobId) {
  updateDoc(jobRef(uid, jobId), { status: 'finished', endedAt: Date.now() }).catch(warn('End job'));
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
