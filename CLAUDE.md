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

Local testing without touching the live project (needs Java; installed at `C:\Program Files\Microsoft\jdk-21.*`):
- `firebase emulators:start --only auth,firestore,storage` — uses the local `firestore.rules` / `storage.rules`
- `VITE_USE_EMULATORS=true npm run dev` — the app connects to the emulators (dev builds only; see `src/firebase.js`)
- To include Functions: `firebase emulators:start --only auth,firestore,storage,functions`. Needs `functions/.secret.local` (`ANTHROPIC_API_KEY=…`, `DEEPGRAM_API_KEY=…`; dummy values are fine) and, to use the no-cost stand-in model instead of the real API, `functions/.env.local` with `PICTALK_FAKE_AI=1` (only honored when `FUNCTIONS_EMULATOR` is set). Both files are git-ignored. `transcribeStop` fails locally (no Deepgram), so write transcripts into the emulator to test summaries.

There is no test suite.

## Architecture

**Save path (offline-first)** — `src/stopStore.js` is the core:
1. `queueStop()` writes the stop (photo/audio Blobs included) to IndexedDB via `idb-keyval` under `pending-stop:<uuid>`, then kicks off `syncQueue()`.
2. `syncQueue()` uploads oldest-first: photo to `photos/{uid}/{id}.{ext}`, audio to `voice/{uid}/{id}.{ext}` in Storage, and only then writes the Firestore doc `users/{uid}/stops/{id}` (so a doc never exists without its files). On success the local entry is deleted; on failure `attempts`/`lastError` are recorded and it retries.
3. `startAutoSync()` retries on `online`, tab visibility, sign-in, and every 60s.

The client-generated UUID is the Firestore doc id, which is how `App.jsx` de-dupes pending vs. synced stops.

**Jobs** — `src/jobStore.js`. A job groups stops: `users/{uid}/jobs/{jobId}` with `name, address, lat, lng, status ('open'|'finished'), startedAt, endedAt, lastStopAt` (times are client ms numbers), plus optional `customer`, `location` (typed at End Job or via "Edit customer & location") and `exportCount`. Always show a job with `jobTitle(job)`: "Customer – Location – Sep 30, 2026 2:14 PM", falling back to the stored `name` when both are blank. At most one job is open; it's the one new stops go into, and `startJob()` finishes any others in the same batch. Every stop carries `jobId`. Job writes aren't awaited (Firestore's local cache makes them show up offline). Stops from before jobs existed are moved once into a finished job with the fixed id `earlier` ("Earlier stops") by `migrateEarlierStops()`, which runs on sign-in and sets a localStorage flag when done.

**Moving/deleting stops** — `moveStop()` / `deleteStop()` in stopStore handle both queued (IndexedDB) and uploaded stops. Moving works offline; deleting an uploaded stop requires signal so its Storage files are removed along with the doc (no orphaned files). UI for jobs lives in `src/JobsScreen.jsx` (My Jobs list, job page, rename, reopen); stop cards are shared via `StopList` in `src/StopCards.jsx`.

**PDF export** — `src/exportJob.js` builds a plain, JSON-safe export object (`buildJobExport`) and loads/downscales photos (1600px, JPEG 0.7); `src/renderJobPdf.js` draws it with jsPDF (lazy-loaded, so it isn't in the main bundle). `ExportSheet.jsx` runs the flow: initials (once, stored in localStorage, blank = "PicTalk user") → progress → Share PDF (Web Share) or Download. Each export increments `exportCount` (the PDF's Rev). Loading photos from Firebase Storage needs the bucket CORS config in `storage-cors.json` (apply with `gcloud storage buckets update gs://pictalk-6cbff.firebasestorage.app --cors-file=storage-cors.json`).

**AI summary** — `functions/summary.js` `generateJobSummary` (callable, `us-west2`) sends a finished job's stop transcripts to the Claude API (`claude-opus-5-5`, effort `low`, structured JSON output, `fallbacks: "default"`) and writes a draft to `users/{uid}/jobs/{jobId}/ai/summary` (`status`, `summary`, `action_items[{id,text,priority,source_stop_ids}]`, `open_questions`, `model`, `generatedAt`, `approvedAt/By/ByUid`, `generationCount`). It never writes stops/photos/audio. Ownership is implicit (it only reads the caller's own `users/{uid}`). Limits: 5 generations per job, 20 per account per day (`users/{uid}/aiUsage/{date}`, function-only). Secret: `ANTHROPIC_API_KEY`. App side: `src/summaryStore.js` + `src/JobSummary.jsx` on the job page (auto-builds right after End Job once transcripts are ready; edits save to Firestore; editing an approved summary returns it to draft). Rules let the owner edit only text/items/approval fields. The PDF includes the summary only when approved.

**Demo limit** — `STOP_LIMIT` (10 stops per job) in `App.jsx`, enforced in the UI only (capture, save, and moving stops into a full job).

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
