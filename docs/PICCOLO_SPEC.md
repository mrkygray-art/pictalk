# Piccolo — Quoting / CRM Pane for PicTalk

Spec for Claude Code. Save in the repo at `docs/PICCOLO_SPEC.md`.

---

## 0. Rules for Claude Code (read first)

1. **Work only on a feature branch:** `git checkout -b feature/piccolo`. Never commit to `main`.
2. **Never touch production.** Production is `pictalk-6cbff` (https://pictalk-6cbff.web.app).
   - Do NOT run `firebase deploy` (hosting, rules, functions, storage) against the production project from this branch.
   - Use a separate Firebase project (e.g. `pictalk-dev`) or the Firebase emulators for all backend work. Add it as an alias in `.firebaserc` (`firebase use dev`).
   - Preview hosting only: `firebase hosting:channel:deploy piccolo-preview --expires 30d` (against the dev project).
3. **Additive data changes only.** Do not rename, remove, or restructure existing PicTalk collections or fields. New collections and new optional fields only. `main` must keep working against the same data.
4. **Do not break PicTalk.** Existing capture flow (Take Photo / Tap to Talk / Save This Stop, saved stops list, End Job, AI summary, wrap-up notes, PDF job report) must behave exactly as before.
5. **Everything is user-editable.** No AI output is final until the user finalizes.
6. Before large changes, summarize the plan and the files you will touch.

---

## 1. Concept

One app, two panes, one login.

- **PicTalk pane** (existing): capture photos, audio, transcripts, field notes, customer notes, AI summary.
- **Piccolo pane** (new): turns a finished PicTalk job into a work order, BOM, and quote, all AI-drafted and fully editable, then finalizes, archives, and exports.

Both panes read and write the **same job record**, keyed by job ID and owned by the signed-in user's account. Nothing is "transferred" between them. Piccolo just opens the same job in a different view.

### Handoff

- At **End Job** in PicTalk, add a button: **"Send to Piccolo"** (link button).
  - The job data is already saved to Firestore/Storage by this point. The button only navigates and optionally triggers the AI draft.
- A persistent **pane switcher** (PicTalk | Piccolo) lets the user move back and forth at any time.
- Switching panes never loses or duplicates data. Edits in either pane update the same job.
- If the user adds more photos or notes in PicTalk after a Piccolo draft exists, Piccolo shows "New capture data since last draft — Re-draft?" (never overwrite user edits silently).

### Identity

Everything is tracked per user. Every visitor, including guests, is a real Firebase user with a permanent `uid` (see section 2). All jobs, drafts, quotes, and files carry the owner's `uid` (and `orgId`, see section 3).

**PicTalk is open to everyone with no login** (so recruiters and first-time users can try it instantly). Login is requested only when someone wants to save their work permanently or use the full Piccolo flow.

---

## 2. Authentication, guests, and roles

### 2.1 Three tiers

| Tier | How they get in | What they get |
|---|---|---|
| **Guest** | No login. Firebase **Anonymous Auth** creates a private user silently on first visit. | Full PicTalk capture (photos, audio, transcripts, AI summary). Jobs are temporary and expire after **7 days**. Can open the **Piccolo demo sandbox** (2.4). |
| **Personal account** | A guest taps "Save my work" and signs in with **Google** or an **emailed link**. Open to anyone. | Permanent jobs, private to them. Full Piccolo on their own jobs (draft, edit, finalize, export), subject to AI usage limits. |
| **Team account** | **Invite-only** by an admin. Google or emailed link. | Shared org jobs, roles, customers, admin console, quote settings, audit log. |

> Assumption: personal accounts are open to everyone and team/admin features are invite-only. Confirm in section 12.

### 2.2 Sign-in methods
- **Continue with Google** (use the popup flow; redirect flow is unreliable in Safari and installed home-screen apps because of tracking protection).
- **Email me a link** (Firebase passwordless email link). Optional later: Sign in with Apple.
- The Google sign-in pattern was built for the Bluey project (Vercel app). If the Bluey repo is available (`claude --add-dir ../bluey`), use it as a UX/flow reference only. PicTalk is on Firebase, so use Firebase Auth equivalents rather than copying Vercel-specific code.

### 2.3 Guest to account: account linking (nothing is copied)
1. First visit: `signInAnonymously()` creates `uid: abc123`. All jobs, photos, and audio save under that `uid` with `expiresAt = now + 7 days`.
2. After the first completed job, show a banner: **"Save your work so it follows you."** "Save my work" offers **Continue with Google** or **Email me a link**.
3. Call `linkWithCredential()` so the Google or email identity attaches to the **same** `uid`. The `uid` never changes, so jobs, media, and drafts are already theirs.
4. On successful link: set `tier: personal`, `isAnonymous: false`, and **clear `expiresAt`** on all of that user's jobs and media.
5. The cleanup function (below) must skip any user whose `isAnonymous` is false.

**Edge cases (must be handled in code):**
- **Credential already in use** (`auth/credential-already-in-use`, e.g. they signed in with Google before on another device): do not fail silently. Call a backend function `mergeGuestIntoAccount(guestUid, existingUid)` that moves the guest's jobs, stops, drafts, and Storage files into the existing account, clears `expiresAt`, writes an audit entry, then retires the guest user. Show "We added your guest jobs to your account."
- **Email link opened in a different browser or app** (common on iPhone: started in the home-screen app, tapped the link in Mail, opened in Safari): Firebase's stored email will be missing. Show a **"Confirm your email"** field and let the user type it. If no guest session exists in this browser, show a clear message ("Open this link in the same browser you started in"). Never silently create an empty new account.
- **Cleared browser data or new device before saving:** the guest identity is lost and jobs become unreachable. Mitigate with the "Save your work" banner after the first job, and a stronger prompt before expiry.
- **Existing team users who tap a guest link:** keep tiers clear; team membership comes only from an invite, never from guest linking.

### 2.4 Piccolo demo sandbox (for recruiters and guests)
- A **"Try Piccolo"** button opens a pre-loaded sample job (sample photos, transcripts, field and customer notes).
- Guests can run the AI draft, edit the BOM and quote, and export a PDF, all against a sandbox copy that resets (or is created fresh per visit). It never touches any real org data.
- Demo jobs are flagged `isDemo: true` and follow guest expiry rules.
- Real finalize/archive to a permanent record requires a personal or team account.

### 2.5 Guest expiry and cleanup
- Scheduled Cloud Function (daily): delete jobs (and their Storage media) where `expiresAt < now` **and** the owner is still anonymous.
- Send no emails to guests (there is no address). Show an in-app notice at 24 hours before expiry: "This job will be deleted tomorrow. Save your work."
- Show a plain privacy line on the guest screen: "Demo jobs are deleted after 7 days. Don't capture anything sensitive until you save your work."

### 2.6 Roles (team and personal)
| Role | Can do |
|---|---|
| `guest` | Capture in PicTalk, use demo sandbox. Own temporary data only. No admin, no cross-user access, no real quote archive. |
| `personal` | Everything on their **own** jobs: draft, edit, finalize, export. No admin console, no other users' data. |
| `admin` | Everything in the org: users, invites, all jobs, settings, exports |
| `estimator` | See and edit all org jobs, BOMs, quotes, pricing; finalize; export |
| `field` | Capture jobs, edit scope/notes; **cannot see pricing or margin** |
| `installer` | Read-only work orders for jobs assigned to them; no pricing |

Enforce in **Firestore and Storage security rules**, not only in the UI. Hiding a button is not security.

### 2.7 Team invite flow (invite-only applies to team roles)
1. Admin enters email + role in the admin console.
2. App creates `invites/{inviteId}` (status `pending`) and sends an email link.
3. Invitee signs in via Google or email link (or links an existing personal account).
4. On first sign-in, match the verified email to the invite, set `orgId` and the invited role, and mark the invite `accepted`.
5. Admin can resend, revoke, change role, or deactivate (soft-disable; never hard-delete users or their data).
6. If an invitee already has a personal account with that email, attach them to the org without losing their personal jobs.

---

## 3. Data model (Firestore + Cloud Storage)

All new docs include `orgId` (null/absent for guest and personal data), `createdAt`, `updatedAt`, `createdBy`. Start with a single org but **include `orgId` on every document now** so multi-company support is possible later without a migration. Security rules should scope reads/writes by `orgId` and role.

> Reuse existing PicTalk job/stop documents. Piccolo adds subcollections and fields; it does not replace them.

```
orgs/{orgId}
  name, logo, defaults { markupPct, taxPct, terms, quotePrefix }

users/{uid}
  email?, displayName?, tier (guest|personal|team), role, orgId?,
  isAnonymous, status (active|disabled), createdAt, upgradedAt?, lastSeenAt

usage/{uid}/days/{yyyymmdd}
  aiDrafts, aiTokens, uploadsBytes   // for rate limits and cost control

invites/{inviteId}
  email, role, orgId, status (pending|accepted|revoked), invitedBy

jobs/{jobId}                          // EXISTING — add optional fields only
  customerId?, assignedTo? [uids], piccoloStatus?
  expiresAt?   // set for guest jobs (now + 7 days); cleared on account link
  isDemo?      // true for sandbox jobs
  // piccoloStatus: none | drafted | editing | finalized

jobs/{jobId}/stops/{stopId}           // EXISTING (photo, audio, transcript)

customers/{customerId}
  name, contacts [{name, phone, email}], address, notes

jobs/{jobId}/drafts/{draftId}         // AI output, versioned, never overwritten
  version, generatedAt, model, promptVersion
  sourceSnapshot { summary, fieldNotes, customerNotes, stopIds[] }
  workOrder { ... }, bom [ line ], quote { ... }
  aiOriginal   // untouched copy of what the AI produced

jobs/{jobId}/working/current          // the user's editable copy
  workOrder, bom [ line ], quote, summary, notes
  editedBy, updatedAt

jobs/{jobId}/finals/{versionId}       // immutable snapshots
  version (v1, v2, ...), finalizedAt, finalizedBy
  workOrder, bom, quote, summary, notes
  mediaManifest [ { type, storagePath, stopId } ]

auditLog/{entryId}
  uid, action, jobId?, before?, after?, at
```

### BOM / quote line shape
```json
{
  "id": "uuid",
  "description": "4MP outdoor dome camera",
  "qty": 4,
  "unit": "ea",
  "partNumber": "",
  "partNumberStatus": "none | user | ai_suggested",
  "unitCost": null,
  "unitPrice": null,
  "priceSource": "none | user | ai_estimate",
  "location": "North exterior wall",
  "notes": "",
  "source": {
    "stopIds": ["..."],
    "basis": "heard | seen_in_photo | inferred",
    "quote": "short excerpt from transcript or note, if any"
  },
  "category": "equipment | cable | labor | misc",
  "sortOrder": 0
}
```

Storage paths: `orgs/{orgId}/jobs/{jobId}/...` for photos, audio, and generated exports.

---

## 4. AI drafting (no parts catalog)

There is **no catalog**. The AI builds the package from the job's own data.

### Inputs
- AI job summary, action items, open questions
- **Field notes** and **customer notes** (highest-value inputs; treat as authoritative)
- Per-stop transcripts and photos (use vision analysis on photos together with the stop transcript)
- Customer/location/job name

### Outputs (single structured JSON response, validate against a schema)
1. **Work order** for PM and installers: scope of work, per-location task list, device list, mounting/cable notes, customer constraints, open questions. **No pricing.**
2. **BOM:** line items per the shape above, rolled up and grouped by location/category.
3. **Quote draft:** BOM lines plus labor lines and terms, using org defaults.
4. **Questions list:** gaps the AI could not resolve.

### Guardrails (important)
- **Never invent part numbers.** Leave `partNumber` blank unless the user said one aloud or it appears in a note/photo text. If the AI proposes one, set `partNumberStatus: "ai_suggested"` and show a "verify" badge.
- **Prices default to blank.** Optional org/user setting: "AI price estimates", which, when on, fills `unitPrice` with `priceSource: "ai_estimate"` and a visible **ESTIMATE** badge. Estimates must never appear on an exported quote without a warning (see Finalize).
- **Every line cites its source** (`stopIds`, `basis`, `quote`) so the user can verify quickly.
- **Label confidence:** `heard`, `seen_in_photo`, or `inferred`. UI sorts/flags `inferred` lines for review.
- **Flag gaps as questions** (e.g. "No cable run length mentioned", "Mounting height unknown") rather than guessing.
- **Quantities** come from what was said or visibly counted. When counting from a photo, say so in `basis`.
- Drafts are **versioned and non-destructive.** Re-drafting creates a new draft; it never overwrites `working/current`. Offer "Replace my edits" or "Merge/compare" explicitly.
- Keep `aiOriginal` untouched for each draft.

### Implementation notes
- Call the AI from a **backend function** (Firebase Cloud Function or equivalent). Do not expose API keys in the client.
- Use structured output / JSON schema and validate before saving. On failure, show a friendly retry, never partial garbage.
- Store `model` and `promptVersion` on every draft for later evaluation.
- Compare `aiOriginal` vs final edits to measure what users change most (see section 8).

---

## 5. Piccolo UI (keep it dead simple)

Design goal matches PicTalk: easy enough for a non-technical user. Mobile-first, big tap targets.

### Job screen in Piccolo: tabs
1. **Overview:** customer, location, summary, field notes, customer notes (all editable), open questions from AI.
2. **Work Order** (PM/installer view): editable; no pricing visible to `field`/`installer` roles.
3. **BOM:** editable table.
4. **Quote:** editable table with labor, markup, tax, totals, terms.
5. **Media:** photos, audio, transcripts (read-only here, edit in PicTalk).

### Editable table behavior
- Tap any cell to edit: description, qty, unit, part number, cost, price, location, notes.
- Add line, delete line, reorder (drag or up/down), duplicate line.
- Badges: `inferred`, `ai_suggested`, `ESTIMATE`, `needs price`.
- Tap a line's source chip to jump to the originating stop (photo + transcript).
- Totals recalc live (subtotal, markup %, tax, labor, total).
- Autosave to `working/current` with a visible "Saved" indicator. Undo for the last few edits.

### Primary buttons
- **Draft with AI** (or **Re-draft**)
- **Finalize**
- **Export**
- **Back to PicTalk** (pane switcher)

---

## 6. Finalize, archive, and export

### Finalize
- Validation before finalizing (warn, user can override with confirmation):
  - Lines with no price
  - Lines with `ai_suggested` part numbers not verified
  - Any `ESTIMATE` prices still present
  - Unanswered AI open questions
- On finalize: write an **immutable snapshot** to `jobs/{jobId}/finals/{versionId}` with the work order, BOM, quote, summary, notes, and a manifest of all linked media (photos, audio, transcripts). Set `piccoloStatus: finalized`.
- Later changes create **v2, v3, ...** rather than mutating a final.
- All media and text remain saved in the database/Storage under the job so the full record (picture, audio, text) is preserved.

### Export (from any finalized version, and from drafts marked "DRAFT")
- **PDF:** work order, BOM, and quote, each selectable. Keep the existing PicTalk PDF job report. PDF stays available for anyone who wants to work from a PDF or mark it up.
- **CSV:** BOM and quote lines (one file each).
- **JSON:** full job package (job, stops, summary, notes, work order, BOM, quote, media manifest with download URLs).
- **Zip bundle (optional):** PDF + CSV + JSON + photos + audio.
- **Delivery options:** Download to device/desktop, native share sheet on mobile, and email-to-self/others. Exports are generated on demand and may be cached in Storage.
- Role rules: `field` and `installer` exports exclude all pricing/cost/margin fields. Enforce server-side, not just by hiding UI.
- Guest demo exports are watermarked "DEMO".
- Watermark PDFs "DRAFT" until finalized.

---

## 7. Admin console (section visible to `admin` only)

- **Users:** list, invite, resend/revoke invite, change role, deactivate/reactivate.
- **Customers:** create/edit customers and contacts; jobs attach to a customer.
- **Jobs:** all jobs, filters (status, customer, assignee, date), assign to user, set status (captured → drafted → quoted → won/lost → installed).
- **Quote settings:** company name/logo, quote numbering prefix, default markup %, tax %, default terms/payment terms, labor rate defaults.
- **AI settings:** toggle AI price estimates; prompt version; model.
- **Audit log:** who did what and when, filterable by user/job.
- **Data tools:** export all (CSV/JSON), storage usage, retention settings.
- **Guests and personal accounts:** counts, recent signups, AI usage and cost per user, manual purge, block abusive users.
- **Org settings:** name, branding.

User portal (all roles, filtered by role): my jobs, job detail in the allowed panes, profile, sign out.

---

## 8. Learning from edits (no catalog required)

- Save the `aiOriginal` vs final diff per job (which lines added, removed, changed; which fields edited).
- On new drafts, optionally include the user's **recent finalized lines** as examples in the prompt so the AI prefers their wording, part numbers, and pricing habits ("last time you called this X"). This is how a catalog emerges from real use without a setup screen.
- Keep this opt-out per org. Do not mix data across orgs.

---

## 9. Security checklist

- Firestore + Storage rules enforce `orgId` scoping and role permissions; test them with the emulator and write rule unit tests.
- Pricing/cost fields never sent to `field`/`installer` clients (consider storing pricing in a separate subcollection or doc that rules restrict to `admin`/`estimator`).
- Invite-only enforcement checked server-side on first sign-in.
- Signed, expiring URLs for media in exports and share links.
- No API keys in client code.
- **Open-app cost and abuse control:** enable **Firebase App Check**; per-user and per-day limits on AI drafts, vision calls, and uploads (tighter for guests); max file sizes and audio length; global daily spend cap with alerting.
- **Tier isolation in rules:** guests and personal users can only read/write their own `uid`'s data; demo sandbox is separate from any org data; nothing a guest does can reach `orgs/*`.
- Account-merge function runs server-side only, verifies both identities, and logs to `auditLog`.
- Audit log for finalize, export, role changes, and deletes.

---

## 10. Build phases (each shippable on the branch)

1. **Foundation:** branch + dev Firebase project + emulators; auth (Google popup + email link), roles, `users`/`invites`/`orgs`; pane switcher shell with empty Piccolo pane; security rules + tests.
1b. **Guests and linking:** Anonymous Auth, 7-day `expiresAt`, "Save my work" banner, `linkWithCredential` flow, "Confirm your email" fallback, `credential-already-in-use` merge function, daily cleanup function, App Check, usage limits, demo sandbox. **Test on a real iPhone** (Safari and installed home-screen app).
2. **Handoff + AI draft:** "Send to Piccolo" button at End Job; backend draft function; schema validation; draft storage; Overview tab.
3. **Editable work order + BOM:** editable tables, source chips, badges, autosave, undo, re-draft with compare.
4. **Quote:** labor, markup, tax, totals, terms; role-based price visibility.
5. **Finalize + archive + export:** validation, immutable versions, PDF/CSV/JSON/zip, share/download/email.
6. **Admin console:** user management, customers, jobs, settings, audit log, data tools.
7. **Learning + evaluation:** edit diffs, prompt examples from past finals; add a PicTalk Evaluation Lab-style run button for draft quality.

---

## 11. Acceptance criteria

- Production `pictalk-6cbff` is untouched; `main` unaffected; all work lives on `feature/piccolo` against dev/emulators.
- End Job → "Send to Piccolo" opens the same job in Piccolo; switching panes back and forth never loses or duplicates data.
- AI draft produces work order, BOM, quote, and open questions from summary, field notes, customer notes, transcripts, and photos, with no invented part numbers and blank prices by default.
- Every line is editable and cites its source; edits autosave.
- Finalize creates an immutable versioned snapshot with all media preserved.
- PDF, CSV, and JSON exports work and can be downloaded to a desktop or shared; pricing is excluded for `field`/`installer`.
- Anyone can use PicTalk with no login; guest jobs expire after 7 days and are cleaned up unless the user has saved their work.
- "Save my work" with Google or email link keeps the same `uid`, clears expiry, and keeps all jobs, photos, and audio with no copying.
- Existing-account and wrong-browser (iPhone) cases are handled gracefully (merge or confirm-email), never losing data or silently creating an empty account.
- Team roles are invite-only; roles enforced by security rules; admin can invite, revoke, and change roles.
- Guests can never see or reach org data or other users' data; AI and upload limits prevent runaway cost.
- Existing PicTalk features still work unchanged.

---

## 12. Open decisions (ask the user before building the affected piece)

1. **Personal accounts:** spec assumes anyone can sign up for a free personal account with full Piccolo on their own jobs, and only team/admin features are invite-only. Confirm, or restrict real quoting to invited users.
2. **AI price estimates:** off by default (recommended), or include labeled estimates?
3. **Single company or multi-company?** `orgId` is on every document so either works; confirm before building org switching or per-org branding.
4. **Guest and personal AI limits:** how many AI drafts per day per guest and per personal user?
5. **Customer-facing share link** for quotes (view/approve): later phase or now?
6. **Email sending** for invites and exports: Firebase Extensions "Trigger Email", Resend, or Gmail API?
7. **Sign in with Apple:** add now for iPhone users, or later if Google/email link causes friction?
