// src/exportJob.js — PicTalk job export
// buildJobExport() gathers one job into a plain object (JSON-safe, no Blobs), so the
// same data can later be exported as JSON. renderJobPdf.js turns that object into a PDF.
import {
  doc, getDoc, getDocs, getDocFromCache, getDocsFromCache, collection, query, where, updateDoc, increment,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, listAll, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { getPendingStops, urlFor, stopText } from './stopStore';
import { jobTitle } from './jobStore';

// ---------- initials shown as "Captured by" / "Exported by" ----------
const INITIALS_KEY = 'pictalk-initials';
export const ANONYMOUS_NAME = 'PicTalk user';

/** Saved initials on this phone: a string (possibly empty), or null if never asked. */
export function getSavedInitials() {
  try {
    return localStorage.getItem(INITIALS_KEY);
  } catch {
    return null;
  }
}

export function saveInitials(value) {
  const clean = cleanInitials(value);
  try {
    localStorage.setItem(INITIALS_KEY, clean);
  } catch { /* storage blocked: use them for this export only */ }
  return clean;
}

export const cleanInitials = (v) => String(v || '').replace(/[^A-Za-z.\- ]/g, '').trim().toUpperCase().slice(0, 4);

// ---------- the export object ----------
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Reject after ms, so a weak signal can't leave the export hanging. */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : null);

function transcriptStatus(stop) {
  if (stop.isPending) return stop.audioBlob ? 'pending' : 'none';
  if (!stop.audioPath) return 'none';
  switch (stop.status) {
    case 'transcribed': return 'transcribed';
    case 'no_speech': return 'no_speech';
    case 'transcription_failed': return 'failed';
    default: return 'pending';
  }
}

/**
 * Build the plain export object for one job.
 * Returns { data, photoSources } where data is JSON-safe and photoSources maps a stop id
 * to where its photo comes from (a download URL, or the Blob still waiting on this phone).
 */
export async function buildJobExport({ uid, jobId, initials }) {
  // Offline: read the phone's own copy straight away instead of waiting on the network
  const offline = isOffline();
  const jobRef = doc(db, 'users', uid, 'jobs', jobId);
  const jobSnap = await (offline ? getDocFromCache(jobRef) : getDoc(jobRef));
  if (!jobSnap.exists()) throw new Error('This job could not be found.');
  const job = { id: jobSnap.id, ...jobSnap.data() };

  // Uploaded stops, plus any still waiting on this phone (not yet in the cloud)
  const stopsQuery = query(collection(db, 'users', uid, 'stops'), where('jobId', '==', jobId));
  const cloudSnap = await (offline ? getDocsFromCache(stopsQuery) : getDocs(stopsQuery));
  const cloud = cloudSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const cloudIds = new Set(cloud.map((s) => s.id));
  const pending = (await getPendingStops())
    .filter((s) => s.jobId === jobId && !cloudIds.has(s.id))
    .map((s) => ({ ...s, isPending: true }));
  const stops = [...cloud, ...pending].sort((a, b) => a.clientCreatedAt - b.clientCreatedAt);

  // Approved AI summary, if any (a draft is left out of the PDF)
  const summaryRef = doc(db, 'users', uid, 'jobs', jobId, 'ai', 'summary');
  const summarySnap = await (offline ? getDocFromCache(summaryRef) : getDoc(summaryRef)).catch(() => null);
  const ai = summarySnap?.exists() ? summarySnap.data() : null;
  const indexOf = new Map(stops.map((s, i) => [s.id, i + 1]));
  const stopRefs = (ids) => (ids || []).map((id) => indexOf.get(id)).filter(Boolean);
  const NOTE_LABELS = { field_notes: 'Field notes', customer_comments: 'Customer comments' };
  const noteRefs = (ids) => (ids || []).map((id) => NOTE_LABELS[id]).filter(Boolean);
  const summary = ai?.status === 'approved' && typeof ai.summary === 'string'
    ? {
        text: ai.summary,
        actionItems: (ai.action_items || []).map((i) => ({ text: i.text, priority: i.priority || 'medium', stops: stopRefs(i.source_stop_ids), notes: noteRefs(i.source_stop_ids) })),
        approvedBy: ai.approvedBy || ANONYMOUS_NAME,
        approvedAt: iso(ai.approvedAt),
        usedWrapUpNotes: !!(ai.notesUsed?.field || ai.notesUsed?.customer),
      }
    : null;

  // Wrap-up notes (text only; the audio stays in PicTalk)
  const notesCol = collection(db, 'users', uid, 'jobs', jobId, 'wrapUpNotes');
  const notesSnap = await (offline ? getDocsFromCache(notesCol) : getDocs(notesCol)).catch(() => null);
  const noteText = (type) => ((notesSnap?.docs.find((d) => d.id === type)?.data().text) || '').trim() || null;
  const wrapUpNotes = { field: noteText('field'), customer: noteText('customer') };

  const photoSources = new Map();
  for (const s of stops) {
    if (s.isPending && s.photoBlob) photoSources.set(s.id, { blob: s.photoBlob });
    else if (s.photoPath) {
      // No connection means no download link; the photo counts as not loaded
      const url = offline ? null : await withTimeout(urlFor(s.photoPath), 15000).catch(() => null);
      photoSources.set(s.id, { url });
    }
  }

  const who = initials || ANONYMOUS_NAME;
  const data = {
    jobId: job.id,
    jobName: jobTitle(job),
    customer: job.customer || null,
    location: job.location || null,
    startedAt: iso(job.startedAt),
    endedAt: iso(job.endedAt),
    capturedBy: who, // anonymous accounts: jobs only live on the phone that captured them
    stopCount: stops.length,
    summary, // null unless an AI summary was approved
    wrapUpNotes: wrapUpNotes.field || wrapUpNotes.customer ? wrapUpNotes : null,
    stops: stops.map((s, i) => ({
      id: s.id,
      index: i + 1,
      timestamp: iso(s.clientCreatedAt),
      photoUrl: photoSources.get(s.id)?.url || null,
      hasPhoto: photoSources.has(s.id),
      transcript: stopText(s) || null, // the user's corrected words when there are any
      transcriptStatus: transcriptStatus(s),
      photoDescription: s.photoDescStatus === 'described' ? s.photoDescription || null : null,
      hasAudio: !!(s.audioPath || s.audioBlob),
      audioAvailableUntil: iso(s.audioExpiresAt),
    })),
    exportedAt: new Date().toISOString(),
    exportedBy: who,
    revision: (job.exportCount || 0) + 1,
  };
  return { data, photoSources };
}

/** Count this export on the job, so the next one is Rev + 1. Works offline (syncs later). */
export function recordExport(uid, jobId) {
  return updateDoc(doc(db, 'users', uid, 'jobs', jobId), { exportCount: increment(1) })
    .catch((err) => console.warn('Recording export failed:', err));
}

// ---------- photos: load, downscale, compress ----------
export class PhotoLoadError extends Error {
  constructor(failed, total) {
    super(`${failed} of ${total} photos couldn't be loaded.`);
    this.failed = failed;
    this.total = total;
  }
}

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.7;

async function decode(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch { /* fall back to an <img> below */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downscale to MAX_EDGE on the long side and re-encode as JPEG. Returns { dataUrl, width, height }. */
async function compressPhoto(blob) {
  const img = await decode(blob);
  const w = img.width, h = img.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width: canvas.width, height: canvas.height };
}

async function fetchPhotoBlob(source) {
  if (source.blob) return source.blob;
  if (!source.url) throw new Error('no url');
  const res = await withTimeout(fetch(source.url), 20000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * Load and compress every photo, reporting progress. If any photo fails, throws
 * PhotoLoadError so the caller shows a message instead of producing a broken PDF.
 */
export async function loadPhotos(photoSources, onProgress = () => {}) {
  const entries = [...photoSources.entries()];
  const photos = new Map();
  let failed = 0;
  onProgress(0, entries.length);
  for (let i = 0; i < entries.length; i++) {
    const [id, source] = entries[i];
    try {
      photos.set(id, await compressPhoto(await fetchPhotoBlob(source)));
    } catch (err) {
      console.warn('Photo failed to load for export:', id, err);
      failed++;
    }
    onProgress(i + 1, entries.length);
  }
  if (failed) throw new PhotoLoadError(failed, entries.length);
  return photos;
}

// ---------- file name and delivery ----------
/**
 * "PicTalk_Acme-Company_123-West-Ave_2026-09-30_3-04PM.pdf": customer, location, and the
 * job's start date and time. Blank parts are left out; unsafe characters are removed.
 */
export function exportFileName(data) {
  const part = (v) =>
    String(v || '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '') // accents -> plain letters
      .replace(/[^A-Za-z0-9\s-]/g, '')
      .trim().replace(/[\s-]+/g, '-')
      .slice(0, 40)
      .replace(/-+$/, '');
  const d = new Date(data.startedAt || data.exportedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h = d.getHours();
  const time = `${h % 12 || 12}-${pad(d.getMinutes())}${h < 12 ? 'AM' : 'PM'}`;
  const who = [part(data.customer), part(data.location)].filter(Boolean);
  return ['PicTalk', ...(who.length ? who : ['Job']), date, time].join('_') + '.pdf';
}

/**
 * Upload the PDF so its download link carries the file name from the server
 * (Content-Disposition). Some phone browsers, such as DuckDuckGo on Android, ignore a
 * name set in the page and save the file under a random ID instead. The stored file is
 * itself named like the download, because Storage also sends the stored name
 * (filename*), which some browsers prefer. One file per job: older copies are removed.
 * Returns the download link.
 */
export async function uploadExport(uid, jobId, file) {
  const folder = ref(storage, `exports/${uid}/${jobId}`);
  const pdfRef = ref(storage, `exports/${uid}/${jobId}/${file.name}`);
  await withTimeout(
    uploadBytes(pdfRef, file, {
      contentType: 'application/pdf',
      contentDisposition: `attachment; filename="${file.name}"`, // names are ASCII-only (see exportFileName)
    }),
    30000
  );
  const url = await withTimeout(getDownloadURL(pdfRef), 15000);
  // Tidy up earlier exports of this job (e.g. before the customer name changed)
  listAll(folder)
    .then(({ items }) => Promise.all(items.filter((i) => i.name !== file.name).map((i) => deleteObject(i))))
    .catch((err) => console.warn('Removing old PDF copies failed:', err));
  return url;
}

/** True when this phone can hand the PDF to the share sheet (text, email, save…). */
export function canShareFile(file) {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Must be called directly from a tap. Shares when the phone can; otherwise downloads,
 * from the uploaded copy when there is one (keeps the file name) or from the page.
 * { download: true } skips sharing (the Download PDF button on computers).
 */
export async function deliverFile(file, title, remoteUrl, { download = false } = {}) {
  if (!download && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'; // the user closed the share sheet
      console.warn('Share failed, downloading instead:', err);
    }
  }
  if (remoteUrl) {
    const a = document.createElement('a');
    a.href = remoteUrl; // the server sends "attachment; filename=…"
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'downloaded';
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
