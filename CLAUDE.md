# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PicTalk is a mobile-first, offline-first PWA for field techs (security/low-voltage trade): take a photo, record a voice note, save it as a "stop". Stops sync to Firebase and voice notes are transcribed by Deepgram in a Cloud Function. React 19 + Vite (plain JS/JSX, no TypeScript), Firebase project `pictalk-6cbff`, region `us-west2`.

## Commands

Web app (repo root):
- `npm run dev` — Vite dev server (the service worker is NOT registered in dev; it only runs in production builds)
- `npm run build` — build to `dist/` (what Firebase Hosting serves)
- `npm run lint` — ESLint
- `npm run preview` — serve the production build locally

Firebase (needs the Firebase CLI):
- `firebase deploy --only hosting` (run `npm run build` first)
- `firebase deploy --only functions` / `firestore:rules` / `storage`
- `cd functions && npm run serve` — Functions emulator; `npm run logs` — function logs

There is no test suite.

## Architecture

**Save path (offline-first)** — `src/stopStore.js` is the core:
1. `queueStop()` writes the stop (photo/audio Blobs included) to IndexedDB via `idb-keyval` under `pending-stop:<uuid>`, then kicks off `syncQueue()`.
2. `syncQueue()` uploads oldest-first: photo to `photos/{uid}/{id}.{ext}`, audio to `voice/{uid}/{id}.{ext}` in Storage, and only then writes the Firestore doc `users/{uid}/stops/{id}` (so a doc never exists without its files). On success the local entry is deleted; on failure `attempts`/`lastError` are recorded and it retries.
3. `startAutoSync()` retries on `online`, tab visibility, sign-in, and every 60s.

The client-generated UUID is the Firestore doc id, which is how `App.jsx` de-dupes pending vs. synced stops.

**Jobs** — `src/jobStore.js`. A job groups stops: `users/{uid}/jobs/{jobId}` with `name, address, lat, lng, status ('open'|'finished'), startedAt, endedAt, lastStopAt` (times are client ms numbers). At most one job is open; it's the one new stops go into, and `startJob()` finishes any others in the same batch. Every stop carries `jobId`. Job writes aren't awaited (Firestore's local cache makes them show up offline). Stops from before jobs existed are moved once into a finished job with the fixed id `earlier` ("Earlier stops") by `migrateEarlierStops()`, which runs on sign-in and sets a localStorage flag when done.

**Auth** — anonymous only (`startSession()` in `src/firebase.js`). Firestore uses `persistentLocalCache`.

**Transcription** — `functions/index.js` `transcribeStop` (v2 `onDocumentCreated` on `users/{uid}/stops/{stopId}`, CommonJS, Node 24) downloads the audio from Storage, sends it to Deepgram `nova-3` with a list of trade keyterms (brands like Verkada/Avigilon, terms like PoE/IDF/MDF), and writes `transcript` + `status` back. Deepgram key is a Functions secret: `DEEPGRAM_API_KEY`.

**Stop status lifecycle** — client writes `uploaded`; the function sets `transcribing` → `transcribed` | `no_speech` | `transcription_failed`. `describeStatus()` in `src/App.jsx` maps these to UI text; keep the two in sync when adding statuses.

**UI** — everything lives in `src/App.jsx` (single screen: "Saving to" job bar, capture, and the open job's "Saved stops" list; questions use the `Sheet` bottom sheet). Audio format is chosen per browser (`audio/mp4` on iPhone, webm/opus on Chrome); `extFor()`/`baseType()` in stopStore normalize types for Storage paths and content types.

**PWA shell** — `public/sw.js` is a hand-written service worker: it caches only same-origin app files (network-first with a 4s timeout for navigations, cache-first for assets); Firebase traffic is never cached. Bump `CACHE` (`pictalk-shell-vN`) when changing caching behavior.

## Gotchas

- `firestore.rules` restricts stop and job docs with `keys().hasOnly([...])`. Adding any field requires updating that list. The stop list also includes the fields `transcribeStop` writes (via Admin SDK), because the app's own updates are checked against the whole resulting doc. If the function starts writing a new field, add it there too.
- `storage.rules` limits photos to `image/*` <15MB and voice to `audio/*` <20MB, owner-only.
- Voice files expire after 5 days via a Storage lifecycle rule configured in the console (not in this repo); `VOICE_DAYS` in stopStore must match. Expired audio shows as "Voice note expired" when `getDownloadURL` fails.
- UI copy is written plainly for non-technical field users (e.g. "Writing it down…", "Saved on this phone"). Keep that tone.

## Other files

- `docs/jobs-prototype.html` — standalone HTML design prototype for the in-progress "jobs" feature (branch `jobs`); a reference, not part of the build.
- `.agents/skills/` — vendored Firebase agent skills (Firestore, Auth, Hosting, Functions, rules auditing); consult them for Firebase-specific tasks.
