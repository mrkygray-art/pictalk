# PicTalk — AI Summary, Action Items, and Secure Share Link

## Read this first (instructions for Claude Code)

1. Before writing any code, inspect the repo and summarize back to me: framework, file structure, how jobs/stops are stored (Firestore collections? fields?), how photos/audio are stored, how transcription works today, how auth and user/admin roles work, how the PDF export is built, and whether Cloud Functions exist yet.
2. Then propose a plan for Phase 1 only and wait for my approval.
3. Do not change the existing capture flow or styling (Take Photo / Tap to Talk / Save This Stop, saved stops list, End Job, industrial look). New screens should match the existing look.
4. Never modify or overwrite raw captured data (photos, audio, transcripts). AI output is stored separately, on top of it.
5. Ask before adding any new dependency or paid service. Explain what it costs, if anything.
6. Work one phase at a time. Commit after each phase with a clear message. Tell me what to test on my phone before moving on.
7. Keep secrets (API keys) server-side only. Nothing sensitive in client code.

## Context

PicTalk is a mobile-first site-walk app. A user captures "stops" (photo + voice + transcript), groups them into a job, and at End Job enters Customer and Location (job name = Customer – Location – Date/Time). It can export a PDF, re-exportable after edits. Hosted on Firebase (pictalk-6cbff.web.app). Users and admin roles exist.

Goal of this work: after End Job, AI turns the stops into a reviewable summary and action items, then the user can send the customer a secure link to view the report.

---

## Phase 1 — AI summary and action items

### Flow
1. User taps End Job and enters Customer and Location (existing).
2. App calls a server function `generateJobSummary(jobId)`.
3. Show a loading state ("Building summary…"), then the Job review screen.
4. Job review screen shows an "AI draft" badge, summary, action items (with priority), and open questions.
5. User can edit any text, delete items, add items, change priority.
6. Tapping an action item jumps to the stop it came from.
7. "Approve summary" removes the draft badge and records who approved and when.
8. "Regenerate" re-runs the AI (warn it replaces unapproved edits).
9. PDF export includes the approved summary and action items at the top. If not approved, PDF works as it does today.

### Server function
- Firebase Cloud Function (callable). Note: Cloud Functions requires the Blaze plan. Tell me if the project isn't on it.
- Anthropic API key stored in Firebase Secret Manager, never in the client.
- Use a current Claude model (check Anthropic docs for the model string).
- Verify the caller owns the job (or is admin) before running.
- Input to the model: job name, customer, location, and each stop's index, id, timestamp, and transcript.
- Require JSON-only output matching the schema below. Validate it; retry once on bad JSON; show a friendly error if it still fails.

### Output schema
```json
{
  "summary": "3-5 plain sentences a customer could read",
  "action_items": [
    {
      "id": "string",
      "text": "short imperative task",
      "priority": "high | medium | low",
      "source_stop_ids": ["stopId"]
    }
  ],
  "open_questions": [
    { "id": "string", "text": "string", "source_stop_ids": ["stopId"] }
  ]
}
```

### Prompt rules for the model
- Use only what's in the transcripts. Never invent quantities, part numbers, prices, or measurements.
- Every action item and question must reference at least one source stop.
- Open questions = things mentioned but unresolved, or info a follow-up would obviously need.
- Plain language. Works for any trade (security, electrical, HVAC, property management, etc.). Don't assume a trade.

### Data (suggested — adapt to existing structure)
`jobs/{jobId}/ai/summary`:
- `status`: "draft" | "approved"
- `summary`, `action_items`, `open_questions` (schema above, plus user edits)
- `generatedAt`, `model`, `approvedAt`, `approvedBy`

### Done when
- End Job → review screen with real AI output from my test job.
- Edits save and survive refresh.
- Tapping an action item opens its stop.
- Approved summary appears in the PDF.
- Raw stop data is unchanged.

---

## Phase 2 — Secure share link (demo version)

### Flow
1. On an approved job, user taps "Share report".
2. Options: expiration (1, 7, 14, 30 days; default 14), include audio (default off).
3. "Create secure link" → copy link / native share sheet.
4. Share screen shows status (active, expired, revoked) and view activity ("Viewed 2× · last 3:42 PM").
5. "Revoke link" kills access immediately.

### How it works
- Creating a share saves a frozen snapshot of the approved report under a long random token (at least 32 random bytes, URL-safe). Later edits don't change the shared version until the user re-shares.
- Collection: `shares/{token}` with `jobId`, `ownerUid`, `snapshot`, `createdAt`, `expiresAt`, `revoked`, `includeAudio`.
- Public URL: `/r/{token}`.
- The public page loads data only through a Cloud Function `getSharedReport(token)` that checks the token exists, isn't revoked, and isn't expired. Firestore rules must block all direct client reads of `shares`.
- Photos (and audio if included) are served with short-lived signed URLs generated by the function, not public storage URLs.
- Each successful open logs to `shares/{token}/views` (timestamp, user agent). The share screen reads the count and last view.
- Expired or revoked links show a clean "This link is no longer available" page.

### Customer page
- No login, no install. Mobile-first, same industrial look.
- Header: job name, "Prepared by {user name}", date.
- Summary, then action items, then each stop (photo + transcript quote).
- "Download PDF" button.
- Read-only in this phase.

### Done when
- Link opens on another phone with no login.
- Expired and revoked links are blocked.
- Guessing or editing the token fails.
- Direct Firestore/Storage access to shared data is denied (show me the rules test).
- View count updates.

---

## Phase 3 — Later (do not build yet)
- Email verification code before the customer can open the link.
- Customer can approve action items and comment; responses flow back to the job.
- Photo understanding (vision) to flag mismatches between what was said and what the photo shows.
- "Ask the job" chat.
