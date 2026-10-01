# PicTalk — Wrap-Up Notes (Live Transcription) Spec

**Status:** Ready to build
**Design reference:** PicTalk – Wrap-Up Notes canvas (4 screens: Finish job → Recording → Paused/Edit → Notes attached)
**Suggested repo location:** `docs/wrap-up-notes-spec.md`

---

## 0. Before writing any code (Claude Code: do this first)

1. Read the existing codebase and summarize back:
   - Framework / file structure of the PicTalk front end
   - How the current **End Job** sheet is built (Customer + Location fields, Save & Finish Job, Keep Going)
   - How the current **Deepgram batch (pre-recorded) transcription** is called — from the browser or from a Firebase Cloud Function — and where the Deepgram API key lives
   - How jobs, stops, audio, and transcripts are stored (Firestore collections, Storage paths)
   - How users and admin roles are handled
2. Reuse existing patterns, styles, and helpers. Do not introduce a new framework or UI library.
3. If the Deepgram API key is currently exposed in browser code, stop and flag it before continuing. The key must live only in a Cloud Function / server environment variable.

---

## 1. Goal

At the end of a site walk, the user can record two optional, separate wrap-up notes while their thoughts are fresh:

- **Field notes** — the user's own observations, risks, next steps
- **Customer comments** — what the customer said or requested

Each note is its own recording. While recording, the user sees a **live transcript** (Deepgram streaming). They can **pause, continue, type to edit**, and tap **Done** to attach the note to the job. Wrap-up notes feed the job summary even when the job has no other audio.

## 2. Out of scope (for this spec)

- Rebuilding the AI summary. **PicTalk already has a working AI summary** (summary text, action items, open questions, Draft/Approved status, PDF job report). Keep it exactly as it works today; this spec only feeds wrap-up notes into it (see §7)
- Voice commands / hands-free Live mode for stops
- Speaker diarization (each note is one recording, one label)
- Customer share link

---

## 3. User flow and screens

### Screen 1 — Finish job (modify existing End Job sheet)

Add a **"Wrap-up notes"** section between the Location field and "The stops you saved stay saved.":

- Section label: `Wrap-up notes` with right-aligned helper text `Optional · while it's fresh`
- Button: **Add field notes** — blue accent (`#64A8FF` icon, `#1E2A3A` fill, `#3A5F8F` border), mic icon, `+` on right
- Button: **Add customer comments** — amber accent (`#F2B14C` icon, `#33291A` fill, `#7A5A22` border), speech-bubble icon, `+` on right
- Buttons are 60px tall, full width, 14px radius
- **Save & Finish Job** and **Keep Going** unchanged. Save & Finish Job works with zero, one, or both notes.

### Screen 2 — Recording (new full-screen view)

Opened by either Add button. Header:
- Left: **Discard** (text button, 44px tap target) → confirm dialog: "Discard these notes? The recording will be deleted."
- Center: `Field notes` or `Customer comments`
- Right: red dot + running timer `m:ss` (counts recorded time only, not paused time)

Sub-header: job name (`Customer – Location`) on left; status pill on right:
- `Live · listening` (green) while streaming
- `Recording · offline` (gray) if streaming is unavailable but local recording continues (see §6)

Transcript card (fills remaining space, scrolls, auto-scrolls to bottom):
- **Final** text in white (`#F5F5F7`), 18px, 1.5 line height
- **Interim** text in gray (`#8E8E93`) with a blinking blue caret at the end
- New paragraph after an utterance end (see §5)

Controls row (3 circular buttons with labels below):
- **Edit** (60px, gray) → pauses and opens Screen 3
- **Pause** (76px, red with white ring) → toggles to **Continue** (mic icon) when paused
- **Done** (60px, blue `#2B5FA8`) → finalizes (§6) and returns to Screen 4

**Customer comments only:** before recording starts, show a consent card:
"Let the customer know this will be recorded and transcribed." with buttons **Start recording** and **Cancel**. Do not start the microphone until Start recording is tapped.

### Screen 3 — Paused / editing

- Status pill: `Paused · editing` (amber)
- Transcript becomes an editable `<textarea>` (blue 2px border when focused), prefilled with the current final text
- Helper line: "Your text edits are saved. The original audio is kept."
- **Continue recording** → returns to Screen 2; new speech is appended after the edited text
- **Done – attach to job** → finalizes and goes to Screen 4

### Screen 4 — Notes attached (Finish job sheet, updated state)

Each saved note replaces its Add button with a card:
- Icon + `Field notes · 0:58` (duration) + green check
- Two-line preview of the text
- Buttons: **Review / edit** (reopens Screen 3 with this note), **Play audio**, trash icon (confirm before delete)
- The other Add button remains if that note hasn't been recorded
- Helper text: "The stops you saved stay saved. Wrap-up notes go into the job summary."

### Design rules

Match the existing PicTalk dark UI and Apple-style feel. System font stack. Minimum 44px tap targets. Text contrast ≥ 4.5:1. No emoji. Keep it simple enough for a first-time, non-technical user.

---

## 4. Data model

Store notes under the job (adapt names to the existing schema):

```
jobs/{jobId}/wrapUpNotes/{noteId}
  type:             "field" | "customer"
  audioPath:        string        // Firebase Storage path to full recording
  durationSec:      number        // recorded time, excluding pauses
  liveTranscript:   string        // assembled final segments from streaming
  batchTranscript:  string | null // filled only if fallback ran
  text:             string        // what the user sees and the summary uses
  transcriptSource: "live" | "batch"
  edited:           boolean       // true if the user typed changes
  consentShown:     boolean       // customer notes only
  createdBy:        uid
  createdAt, updatedAt: timestamp
```

Rules:
- **One note per type per job.** Re-opening a note via Review / edit appends to it; it does not create a second note.
- `text` is the source of truth once `edited` is true — never overwrite user edits with a re-transcription.
- Audio is always kept (follow the app's existing retention policy).
- Security rules: same access rules as the parent job.

---

## 5. Live streaming architecture (Deepgram)

> Verify every endpoint and parameter below against Deepgram's current docs before implementing.

### 5.1 Token endpoint (Cloud Function)

- New callable/HTTPS function, e.g. `getDeepgramStreamToken`
- Requires an authenticated user
- Calls Deepgram's temporary-token (auth grant) endpoint with the server-side API key and returns the short-lived token to the client
- The real API key **never** reaches the browser
- Add basic abuse protection (auth required; optional per-user rate limit)

### 5.2 Browser connection

- Open a WebSocket to Deepgram's streaming `listen` endpoint using the temporary token
- Starting parameters (tune after testing):
  - `model=nova-3` (or the model the batch path already uses)
  - `interim_results=true` — powers the gray live text
  - `smart_format=true`
  - `endpointing=300` — finalizes on short pauses
  - `utterance_end_ms=1000` — paragraph breaks
  - `keyterm` boosting for trade vocabulary (e.g. NVR, PoE, IDF, MDF, conduit, access control, reader, maglock) — keep the list in one config file
- Audio: capture mic with `getUserMedia`, send chunks every ~250ms
  - **iOS Safari risk:** MediaRecorder output format differs from Chrome. If Deepgram can't read Safari's chunks, fall back to an AudioWorklet that sends raw `linear16` PCM with `encoding` and `sample_rate` params. Test on a real iPhone early.

### 5.3 Handling results

- Interim results replace the current gray tail
- Final results (`is_final`) are appended to `liveTranscript` in white
- Utterance-end events start a new paragraph

### 5.4 Pause / continue / done

- **Pause:** stop sending audio, send Deepgram's close-stream message, close the socket. Pause the local recorder (`MediaRecorder.pause()`).
- **Continue:** fetch a new token, open a new socket, resume the local recorder. Append new text after existing text.
- **Done:** close stream, wait briefly for the last final results, stop recorder, run §6.
- Do not keep a socket open while paused — avoids billing for silence and avoids idle timeouts.

### 5.5 Screen awake

Request a Wake Lock while recording; release on pause/done/discard.

---

## 6. Reliability: local recording + batch fallback

Site walks often have poor signal (basements, mechanical rooms, parking structures).

- **Always** record the full audio locally (MediaRecorder) regardless of streaming status.
- If the WebSocket fails to open or drops mid-recording:
  - Keep recording locally
  - Switch the status pill to `Recording · offline`
  - Try to reconnect in the background; do not interrupt the user
- **On Done:**
  1. Upload the full audio to Storage
  2. If the stream was uninterrupted → `transcriptSource = "live"`, `text = liveTranscript` (or the edited text)
  3. If the stream dropped at any point, or the live transcript is empty → run the **existing batch transcription** on the full audio, store `batchTranscript`, set `transcriptSource = "batch"`, and use it for `text` **unless** `edited` is true (then keep the user's text and store the batch result alongside it)
- If upload fails (no signal at all), queue it locally and retry; the note shows `Waiting to upload` on its card.

---

## 7. Integrate with the EXISTING AI summary (do not rebuild it)

PicTalk already generates an AI summary after End Job, with: summary text, Action items (+ Add action item), Open questions, an editable summary box, Draft → Approved status ("Approved by KG · date. Editing puts it back to draft."), and a PDF job report ("Summary drafted by AI from the voice notes; reviewed and approved by …"). **Keep all of this working as-is.** Before changing anything, Claude Code must find and summarize how the current summary is generated (prompt, inputs, where it's stored, when it runs).

Changes:

1. **Add wrap-up notes as inputs** to the existing summary prompt, alongside stop transcripts:
   - Wrap-up notes are the **highest-priority input**; stop transcripts are supporting detail
   - Label inputs in the prompt so the model can attribute points: `FIELD NOTES`, `CUSTOMER COMMENTS`, `STOP 1 (photo count, transcript)`, etc.
   - The summary must still work when the job has **only** wrap-up notes and no stop audio
   - Keep customer statements distinct from the user's own judgments (e.g. "Customer requested…" vs. "Field notes flag…")
   - Action items and open questions should draw from wrap-up notes first

2. **Never overwrite an edited or approved summary silently.**
   - If a wrap-up note is added, edited, or deleted after the summary exists, mark the summary as **out of date** and show a **Regenerate summary** button
   - Regenerating an **Approved** summary returns it to **Draft** (matches the existing "editing puts it back to draft" rule)
   - If the user has hand-edited the summary text, confirm before regenerating: "Regenerate? Your edits to the summary will be replaced."

3. **PDF job report:** add a **Wrap-up notes** section after Summary / Open questions, with `Field notes` and `Customer comments` as labeled sub-sections (text only; note that original audio is kept in PicTalk). Keep the existing header table and the AI/approval footer line.

4. **Approval footer wording:** when wrap-up notes were used, the footer can read "Summary drafted by AI from the voice notes and wrap-up notes; reviewed and approved by …".

---

## 8. Build milestones (ship each one before starting the next)

**M1 — UI + batch only (no streaming)**
Screens 1–4, data model, Storage upload, existing batch transcription on Done, edit/pause/continue, discard/delete confirms, consent card, and §7 integration with the existing AI summary and PDF report. Fully usable on its own.

**M2 — Live streaming**
Token Cloud Function, WebSocket streaming, interim/final rendering, pause/continue reconnect logic, Wake Lock.

**M3 — Reliability**
Offline status, background reconnect, batch fallback rules, upload retry queue, iOS Safari audio path.

**M4 — Checklist chips (optional)**
Quiet prompt chips under the transcript: `Next steps`, `Who follows up`, `Open questions?`, `Risks or concerns?`. Start with simple keyword matching on the final transcript; a chip turns to a checked, dimmed state when covered. Never blocks Done.

---

## 9. Acceptance criteria

- [ ] Both Add buttons appear on the End Job sheet; Save & Finish Job still works with no notes
- [ ] Customer comments shows the consent card before the mic starts
- [ ] Live text appears within ~1 second of speaking (M2+)
- [ ] Pause stops the timer and the stream; Continue appends new text after existing text
- [ ] Typed edits are preserved and never overwritten by a re-transcription
- [ ] Turning off Wi-Fi/cell mid-recording does not lose audio; Done produces a transcript via batch fallback (M3)
- [ ] Each note shows on the Finish sheet with duration, preview, Review / edit, Play audio, Delete
- [ ] Re-opening a note appends to it rather than creating a duplicate
- [ ] Deepgram API key is not present anywhere in client code or network responses
- [ ] Works on iPhone Safari and Android Chrome
- [ ] Existing AI summary, action items, open questions, Draft/Approved flow, and PDF report still work exactly as before on jobs with no wrap-up notes
- [ ] A job with only wrap-up notes (no stop audio) produces a useful summary with action items
- [ ] Adding/editing a wrap-up note after approval flags the summary as out of date; regenerating returns it to Draft
- [ ] PDF report includes a Wrap-up notes section when notes exist

## 10. Test plan

- Desktop Chrome, iPhone Safari, Android Chrome
- Quiet room, noisy environment (fan/traffic), and airplane mode mid-recording
- Recording with 3+ pause/continue cycles
- Edit text, continue recording, edit again, Done
- Delete a note, re-record it
- Job with wrap-up notes only (no stops with audio)
