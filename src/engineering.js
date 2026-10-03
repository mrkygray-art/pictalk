// src/engineering.js — Engineering Mode: what PicTalk is doing under the hood, with real
// timings. Off by default (field techs never see it); the choice is remembered on this
// device. Everything here is measured in this browser or read from the user's own records;
// nothing new leaves the phone.
import { useSyncExternalStore } from 'react';

const KEY = 'pictalk-eng';
const LOG_MAX = 60;

let on = false;
try {
  on = localStorage.getItem(KEY) === '1';
} catch { /* storage blocked: stays off */ }

let version = 0;
const listeners = new Set();
const changed = () => {
  version++;
  listeners.forEach((fn) => fn());
};
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setEngOn(value) {
  on = !!value;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch { /* not remembered */ }
  changed();
}

/** { on, version } — re-renders when Engineering Mode or any measurement changes. */
export function useEngineering() {
  const v = useSyncExternalStore(subscribe, () => version);
  return { on, version: v };
}

// ---------- session log ----------
const log = [];
/** Note one step, e.g. engLog('upload', 'Stop uploaded', '1.2 s'). Kept in memory only. */
export function engLog(kind, text, detail = '') {
  log.push({ at: Date.now(), kind, text, detail });
  if (log.length > LOG_MAX) log.shift();
  changed();
}
export const engLogEntries = () => log;

// ---------- measurements ----------
const uploads = new Map(); // stop id -> { photoBytes, photoMs, audioBytes, audioMs, recordMs }
export function recordUpload(id, timing) {
  uploads.set(id, timing);
  changed();
}
export const uploadTiming = (id) => uploads.get(id);

// Sync loop: when it last ran and when it runs next on its own
export const syncInfo = { running: false, lastRunAt: null, lastResult: '', nextRunAt: null };
export function setSyncInfo(patch) {
  Object.assign(syncInfo, patch);
  changed();
}

// Live words (wrap-up notes): the latest connection's timings
export const liveInfo = { state: 'idle', tokenMs: null, connectMs: null, firstWordsMs: null, reason: '' };
export function setLiveInfo(patch) {
  Object.assign(liveInfo, patch);
  changed();
}

// ---------- formatting ----------
export function ms(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  const m = Math.floor(n / 60000);
  return `${m} min ${Math.round((n % 60000) / 1000)} s`;
}
export function bytes(n) {
  if (n == null) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
/** Firestore Timestamp, number, or null -> milliseconds */
export const millis = (t) => (t?.toMillis ? t.toMillis() : typeof t === 'number' ? t : null);
