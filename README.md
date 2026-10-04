# PicTalk

**Mobile-first AI field documentation for security and low-voltage technicians.**

PicTalk turns a field technician's normal workflow — **take a photo and explain what you see** — into structured job documentation. Technicians capture photos and voice notes at each stop, PicTalk transcribes the recordings, organizes the work by job, drafts an AI summary and action items, and produces a customer-ready PDF after human review.

> Built as a practical field workflow: **Photo → Voice → Transcript → Job Context → AI Draft → Human Approval → PDF Report**

**Try it live:** https://pictalk-6cbff.web.app  
**Portfolio case study:** https://ky-gray-portfolio.vercel.app/#pictalk  
**How it's built:** [Architecture](#high-level-architecture) · [Run it locally](#run-it-locally)

> **Demo note:** Open it on your phone. No sign-up is needed: take a photo, tap to talk, and save a stop. End the job to see the AI summary and download the PDF. To see the pipeline behind it, tap **Engineering Mode** at the bottom of the main screen. Demo limits: up to 10 stops per job, and voice recordings are deleted after 5 days. Please don't record real customer information.

## Two ways to explore

**Field view (default).** What a technician sees: start a job, photograph each stop, talk, and save. Everything is plain language ("Saved on this phone", "Writing it down…"), and it keeps working with no signal.

**Engineering Mode.** Tap the small **Engineering Mode** link at the bottom of the main screen to see what the app is doing underneath: stops waiting on the phone, upload retries and errors, the next automatic sync, and real timings for each stop (upload per file, then transcription split into audio download and Deepgram time), plus how long each AI summary took and how many tokens it used. It's off by default, so field techs never see it, and it only shows each user their own data. [Full details below.](#engineering-mode)

<p>
  <img src="docs/engineering-panel.webp" alt="Engineering Mode panel: the data path and sync status" width="260">
</p>

## The problem

Field technicians often finish a site walk with useful information scattered across camera rolls, handwritten notes, text messages, and memory. Turning that information into something useful for sales, service, estimating, or project management takes additional office time and can lose important field context.

PicTalk is designed to capture that information **while the technician is already standing in front of the equipment**.

## Workflow

1. **Start a job** and identify the customer/location.
2. **Take a photo** at a device, room, panel, or other field stop.
3. **Tap to talk** and describe the condition, finding, or required work.
4. PicTalk saves the stop locally first and synchronizes it to the cloud when connectivity is available.
5. **Deepgram** converts the technician's voice note into searchable text using terminology relevant to security and low-voltage work.
6. The technician can review or correct the transcription and add optional end-of-job field/customer notes.
7. **Claude** uses the job's transcripts and wrap-up notes to draft a concise job summary and prioritized action items.
8. The technician reviews and edits the AI output before approving it.
9. PicTalk generates a **PDF job report** containing the approved summary, action items, job details, photos, and field documentation.

## Screenshots

### Capture a field stop

![PicTalk field capture](docs/Screenshot%202026-10-02%20121130.png)

### Record a voice note

![PicTalk voice recording](docs/Screenshot%202026-10-02%20121218.png)

### Review saved stops and transcripts

![PicTalk saved stops](docs/Screenshot%202026-10-02%20121347.png)

### AI-generated job summary and action items

![PicTalk AI summary](docs/Screenshot%202026-10-02%20121456.png)

### Customer-ready job report

![PicTalk PDF report](docs/Screenshot%202026-10-02%20121530.png)

## Key capabilities

- **Mobile-first PWA** designed for field use
- **Offline-first capture** using IndexedDB so a technician can save work before cloud connectivity is available
- Job-based organization with multiple photo/voice stops: a My Jobs list, rename and reopen jobs, customer and location names, and moving or deleting stops (moving works offline)
- Browser microphone selection for field laptops and external microphones
- Cloud synchronization of photos, audio, jobs, and transcripts
- **Deepgram Nova-3 speech-to-text** with security/low-voltage terminology
- Editable transcripts while retaining the original transcription
- Optional field wrap-up notes and customer comments, with **words shown live while the technician talks** (Deepgram streaming)
- **Claude-powered job summaries and action items**
- Human review and approval before AI-generated content is included in the final report
- PDF export with job information, photos, findings, summary, and action items
- Web Share support for sharing completed reports from supported devices
- Automatic voice-note retention policy designed to reduce unnecessary long-term audio storage
- **Engineering Mode:** an opt-in inside view of the capture pipeline with real timings, sync status, and AI usage

## AI with human review

PicTalk deliberately treats AI output as a **draft**, not as an unquestioned final answer.

The AI summary is created from the technician's captured job information. The technician can review and edit both the summary and action items. Only an **approved** summary is included in the final PDF report.

If underlying transcripts or wrap-up notes change after generation, the application can identify that the existing AI summary is out of date and should be reviewed again.

This workflow keeps the technician responsible for the final field record while using AI to reduce the administrative work required to turn raw notes into useful documentation.

## Offline-first architecture

Field technicians cannot assume reliable Wi-Fi or cellular service inside electrical rooms, MDF/IDF rooms, warehouses, parking structures, or large facilities.

PicTalk therefore saves a new stop to **IndexedDB first**, including its photo and audio. A synchronization queue uploads pending work to Firebase when connectivity becomes available and retries automatically after network changes, sign-in, application visibility changes, and scheduled retry intervals.

This architecture allows capture to continue even when the cloud is temporarily unavailable.

## Live transcription without exposing the API key

Wrap-up notes show words on screen while the technician talks. A Cloud Function exchanges the server-held Deepgram key for a token that lasts 30 seconds, just long enough for the phone to open a WebSocket to Deepgram's streaming API. The phone streams quarter-second audio chunks; words appear gray while Deepgram is still deciding and white once final. Pausing closes the connection so silence isn't billed. The full recording is always kept and uploaded afterward: if the live connection stayed up, its words become the transcript, and if it dropped, a Cloud Function transcribes the whole recording instead. Text the technician typed is never overwritten. ([Diagram](#live-words-without-exposing-the-deepgram-key))

## Engineering Mode

An offline-first app hides its hardest work: queued uploads, retries, and background transcription. **Engineering Mode** makes that work visible and measurable. A small link at the bottom of the app turns it on. It's off by default, so field technicians never see it, and it only shows each user their own data.

<p>
  <img src="docs/engineering-panel.webp" alt="Engineering Mode panel: the data path and sync status" width="260">
  <img src="docs/engineering-stop.webp" alt="A stop with its real timings" width="260">
  <img src="docs/engineering-offline.webp" alt="Offline: a stop waiting on the phone with its upload tries" width="260">
</p>

| Area | What it shows | Where the numbers come from |
| --- | --- | --- |
| Data path | The 7 steps a stop takes: phone → IndexedDB → Storage → Firestore → Cloud Function → Deepgram → Claude | — |
| Sync | Online/offline, stops waiting on the phone, upload tries, last error, last sync result, countdown to the next automatic try, **Sync now** | The sync queue, in the browser |
| Each stop | Time to reach the cloud, upload time per file, transcription time split into **audio download** and **Deepgram**, recording length, speed vs. real time, model, confidence, whether the words were corrected | Browser timings + fields the transcription function saves (`transcribeTimings`) |
| Live words | Token request time, connection time, time to first words, and why it fell back to after-recording transcription | The browser |
| AI summary | Model used, generation time, attempts, input/output tokens, summaries used of 5 | Fields the summary function saves (`generation`) |
| Session log | Each step as it happens: saved on the phone, uploaded, failures | Memory only; never stored |

**Why it matters:** it shows whether a slow stop was the phone's signal, the upload, or the speech-to-text service; whether the retry loop really recovers after a dead zone; and what each AI summary costs in time and tokens.

*The screenshots above were taken in the local Firebase emulator, where speech-to-text and the AI are free stand-ins, so their times show near zero. Upload, sync, and offline timings are real browser measurements.*

## Technology stack

| Layer | Technology |
| --- | --- |
| Front end | React 19, Vite, JavaScript/JSX |
| Application model | Progressive Web App (PWA) |
| Offline storage | IndexedDB / `idb-keyval` |
| Authentication | Firebase Anonymous Authentication |
| Database | Cloud Firestore |
| File storage | Firebase Storage |
| Backend | Firebase Cloud Functions |
| Speech-to-text | Deepgram Nova-3 |
| AI summarization | Anthropic Claude |
| PDF generation | jsPDF |
| Hosting | Firebase Hosting |

## High-level architecture

The phone does the capturing and the queueing; Firebase stores everything; Cloud Functions hold every API key and do the transcription and summaries.

```mermaid
flowchart LR
    subgraph Phone["Phone: React PWA"]
        CAP["Photo +<br/>voice note"]
        IDB[("IndexedDB queue<br/>works offline")]
        SYNC["syncQueue()<br/>retries when back online"]
        REC["Wrap-up recorder<br/>live words"]
        JOB["Job page<br/>review + approve"]
        PDF["PDF report<br/>built on the phone"]
    end

    subgraph FB["Firebase, us-west2"]
        ST[("Storage<br/>photos, voice<br/>(voice expires in 5 days)")]
        FS[("Firestore<br/>jobs, stops, notes, summary")]
        subgraph CF["Cloud Functions: keys live here"]
            TS["transcribeStop<br/>transcribeWrapUpNote"]
            TOK["getDeepgramStreamToken<br/>30-second token"]
            SUM["generateJobSummary"]
        end
    end

    DG["Deepgram nova-3<br/>trade keyterms"]
    CL["Claude API<br/>structured JSON"]

    CAP --> IDB --> SYNC
    SYNC -- "1: files first" --> ST
    SYNC -- "2: then the record" --> FS
    FS -- "new recording" --> TS
    TS -- "audio" --> DG
    TS -- "transcript" --> FS
    REC -- "ask for a token" --> TOK
    TOK -- "grant" --> DG
    REC <-- "live audio + words<br/>WebSocket" --> DG
    JOB -- "build summary" --> SUM
    SUM -- "transcripts + notes" --> CL
    SUM -- "draft" --> FS
    FS --> JOB
    JOB --> PDF
```

Files upload before the Firestore record is written, so a record never points at a missing photo. The client-made ID is the record's ID, so a retried upload can't create a duplicate.

### Live words without exposing the Deepgram key

```mermaid
sequenceDiagram
    participant R as Recorder (phone)
    participant F as Token function
    participant D as Deepgram

    R->>F: Ask for a token (signed-in user)
    F->>F: Limit: 60 per account per hour
    F->>D: POST /v1/auth/grant (API key, server only)
    D-->>F: Token that lasts 30 seconds
    F-->>R: Token + model + trade keyterms
    R->>D: Open wss /v1/listen<br/>with the token as the WebSocket protocol
    loop While recording
        R->>D: Audio
        D-->>R: Words as they're spoken
    end
    Note over R,D: The full recording is still uploaded. If the stream<br/>dropped, the server transcribes the file instead.
```

## Data and security design

PicTalk uses per-user Firebase paths for job and stop data, with Firebase Security Rules restricting access to the authenticated owner. Storage rules restrict field media by owner, file type, and size.

The AI summarization function reads the authenticated user's job context and writes the generated draft back to that user's job. API credentials for external AI and transcription services are handled as backend function secrets rather than exposed in the browser application.

Audio is intentionally treated as temporary working data. The application is designed around a five-day voice-file retention period while keeping the resulting transcript as part of the job record.

## AI usage controls

To keep AI use predictable, the summary function allows 5 summaries per job and 20 per account per day, and the live-words token function allows 60 connections per account per hour. These limits are enforced in Cloud Functions, not in the browser. AI-generated summaries also preserve metadata needed to distinguish drafts from approved content.

The application does not send job photos or audio recordings to the summarization model; the summary is generated from the text context associated with the job.

## Why I built it

PicTalk combines my background in **physical security, field sales engineering, low-voltage systems, and AI application development**.

The goal was not simply to add an AI chat box to a field application. The goal was to design an end-to-end workflow where AI removes a specific operational bottleneck: converting field observations into usable documentation for the people who need to act on them next.

That includes understanding the realities of field work — intermittent connectivity, hands-busy operation, photos as evidence, trade terminology, quick capture, technician review, and a clean handoff to the next person in the workflow.

## Current project status

PicTalk is an actively developed demonstration application. Current functionality includes job organization, offline capture and synchronization, photo and voice stops, transcription, live words for wrap-up notes, editable field notes, AI-generated summaries and action items, human approval, PDF job reporting, and Engineering Mode.

The current demo limits a job to 10 stops. Voice recordings are designed to expire after five days.

## Run it locally

Needs Node 24 and, for the emulators, the Firebase CLI and Java 11+.

```bash
npm install
npm run dev        # Vite dev server against the live project (the service worker only runs in production builds)
npm run build      # production build into dist/, which Firebase Hosting serves
npm run lint
```

To test without touching the live Firebase project, use the emulators. One command sets them up with free stand-ins for Claude and Deepgram, so no API keys are needed:

```bash
npm run setup:emulator     # creates the two local settings files below and installs the functions' dependencies
firebase emulators:start --only auth,firestore,storage,functions
npm run dev:emulators      # in a second terminal: the app talks to the emulators
```

| Setting | Where | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `functions/.secret.local` (emulator), Firebase secret (production) | Claude API key for summaries. Dummy value is fine with the stand-in on |
| `DEEPGRAM_API_KEY` | same | Deepgram key for transcripts and live-word tokens. Live words need a Member-role key |
| `PICTALK_FAKE_AI=1` | `functions/.env.local` | Stand-in summaries instead of the Claude API (emulator only) |
| `PICTALK_FAKE_STT=1` | `functions/.env.local` | Stand-in transcripts and live words instead of Deepgram (emulator only) |
| `VITE_USE_EMULATORS=true` | `.env.emulators` (used by `npm run dev:emulators`) | Points the dev app at the local emulators |

The setup script copies `functions/.secret.local.example` and `functions/.env.local.example`; the copies are git-ignored and never overwritten. In production the keys are set with `firebase functions:secrets:set ANTHROPIC_API_KEY` (and `DEEPGRAM_API_KEY`). The Firebase web config in `src/firebase.js` is public by design and needs no setting. Browser test scripts are in `e2e/`.

## Repository notes

This repository is public. API keys for Deepgram and Anthropic are Firebase Functions secrets and never appear in the code. The Firebase web config in the app is public by design: Firestore and Storage security rules (`firestore.rules`, `storage.rules`) are what keep each user's data private to them.

---

**Designed and developed by Ky Gray**  
Security Solutions Engineer · AI/SaaS Product Builder