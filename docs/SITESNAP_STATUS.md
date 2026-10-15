# SiteSnap AI: where it stands (2026-10-14)

A brief for planning what to build next. It covers what SiteSnap is, what works today, what was learned about Procore, what's deliberately not built, and the open questions. Details live in the docs linked at the end.

## What SiteSnap is

A phone-first web app for construction crews that works **inside Procore**: people sign in with their Procore account, pick a Procore project, and talk to each other about the job with photos and voice. It's a fork of PicTalk (photo + voice notes for field techs), rebuilt for Procore.

Two things it does:
1. **Project messaging, like Microsoft Teams for a jobsite.** A Procore project is the team; messages are threads. You tag the people a message is for, attach photos and a voice note (transcribed), and AI pulls out the to-dos ("send the submittal", "fix the outlet in 204") and who they're for.
2. **Report an Issue (beta): voice + photo → a real Procore record.** A foreman takes a photo and says what's wrong; AI drafts an **Observation** or **Punch Item** using the project's own lists; one tap creates it in Procore with the photo and the voice recording attached. The thread then follows the record.

Only user so far: Ky (the developer), testing in Procore's developer sandbox ("Sandbox Test Project"). No real customers yet.

## Status at a glance

| Area | Status |
|---|---|
| Procore sign-in (OAuth), project picker, project directory search | Live |
| Messaging: feed, tagging, photos, voice, offline sending, AI to-dos | Live |
| Messaging round 2, phase 1: quick replies (Done / On it / Delayed / Need info), seen / answered tracking, close / reopen | Live |
| Report an Issue → Procore Observation / Punch Item | Live but hidden: only on a phone that opened the app with `?beta=report` |
| Record follow-up: to-dos, Done = ready for review, Close in Procore, sync on open | Live (same beta) |
| Sandbox test directory: 8 companies, 32 people, roles, permission templates | Done, verified |
| PM dashboard (messaging phase 2) | Not built: plan first, Ky approves |
| Procore webhooks (Procore → SiteSnap updates) | Not built (needs a stored token or service account) |
| Syncing messages into Procore (Email Communications) | Not built |
| Push / email alerts | Not built (in-app unread counts only) |
| Change Events (cost / schedule impact) | Not built; flagged inside Observations for now |
| Inside Procore's own window (embedded app) | Launcher only: Procore's login page can't load in its iframe |

## What works today, in more detail

**Sign-in and people**
- Everyone signs in with Procore (server-side OAuth; tokens in an encrypted httpOnly cookie, never in the browser's storage). The Procore sign-in becomes the SiteSnap sign-in, so every message and record has a real author.
- The project picker lists the projects the person can open. The directory is cached per project for offline use.
- "Who is this for?" search: by name, title (job title or Procore project role), or company; one typo forgiven; "tag everyone at {company}".
- Each person's role comes from Procore Project Roles first, then job title, then permission template, then a tag a PM can set.

**Messaging**
- Feed: **For Me** (tagged and open, unread dots, to-do badges), **All Project**, **Mine**.
- New message: To: → photos (up to 10) → Tap to Talk (words come back before sending and can be edited) → note → Send. It can't be sent without tagging someone.
- AI to-dos: Claude reads each message and assigns tasks only to tagged people, with a due phrase. People mark them done.
- Quick replies with a status line on the thread ("Delayed · Weather · new date Fri"). Done also finishes that person's to-dos.
- Tracking under To: ("Tia · Seen 2:14 PM · On it 2:20 PM"). Phase 2 reports would be built on this.
- Works with no signal: messages wait on the phone and send later.
- Only project members can read a project's messages, enforced by database rules.

**Report an Issue (beta)**
- Classifier (Claude, strict JSON): picks Observation vs Punch Item, and fills in the assignee, trade, location, type and due date only when they match the project's real lists. Anything unsure stays blank for the foreman to pick. It scored 5 of 5 on the spec's sample sentences.
- Confirmation card → **Send to Procore** with the reporter's own Procore sign-in, so Procore shows the real author. "Reported by … via SiteSnap AI" goes in the description.
- Photo and audio attach to the Procore record. Ky confirmed both open and play in Procore.
- Follow-up: Done in SiteSnap moves the item to "ready for review"; the PM closes it (one tap in SiteSnap, or in Procore). Opening the thread re-reads the record's status from Procore.
- Ky's first real reports both came out as Observations because the wording was vague. The screen now says plainly where each record goes.

**Test data in the sandbox**
- 8 companies and 32 people: Ironbridge (the GC) plus 7 trade subcontractors (electrical, plumbing / mechanical, roofing, concrete, fire protection, drywall / framing, low voltage / security), each with a PM, a supervisor, and 2–3 workers.
- PMs have the Project Manager project role. Permission templates: Ironbridge staff are Internal; everyone at a subcontractor is Subcontractor - External.
- All fictional (555-01XX phones); their emails go to one test inbox.
- Loaded and checked by a hidden, sandbox-only page (`/api/procore/seed-directory`) that can re-run safely.

## What we learned about Procore (things that shape the next steps)

- **Permissions are per person.** Each person can only create what their own Procore permissions allow, and Procore answers 403 otherwise. Anyone who reports issues needs Observations / Punch List access.
- **Observations created via the API are private by default.** SiteSnap sends `personal: false` so the team can see them.
- **Procore doesn't email anyone when the API creates a record.** SiteSnap would need to trigger the notification (decided: assignee only).
- **Rate limit: about 25 calls per 10 seconds per user.** Bulk work has to be paced.
- **Directory data in real projects is often thin.** In the original sandbox only 1 of 9 people had a job title, 2 had a company and 0 had a permission template. Features can't assume these are filled in.
- **Webhooks exist** for Observations, Punch Items and Change Events, but need a sign-in that isn't a person's (stored token or service account).
- **Service accounts (DMSA)** are Procore's production answer for writing without a person present. Not built; it needs a new app version and a company admin to install it.
- No API delete for users or companies (only inactive); project roles must already exist in the company; editing a user's Active flag doesn't take them out of the directory.

## Decisions already made (Ky, 2026-10-13 / 14)

- Messaging, not jobs: the old PicTalk jobs / stops screens are hidden (not deleted).
- Everyone on a project has a Procore login; each person writes with their own.
- Done in SiteSnap = ready for review; the PM closes.
- Procore's email on create goes to the assignee only.
- Visibility: the whole project sees messages ("private to tagged people" is a later switch).
- No SMS / Twilio. No new dependencies without asking.
- Pushes to the `sitesnap` branch go live (Ky is the only user).

## Not built yet (already on the list)

1. **PM dashboard** (messaging phase 2): open items by person / company, overdue, response times. Plan first; Ky approves.
2. **Webhooks**, so a record closed in Procore closes the SiteSnap thread on its own (needs a stored token or a DMSA).
3. **Procore sync for messages** (Email Communications), and pushing AI to-dos into Procore as Tasks.
4. **Alerts**: web push and/or Procore email, beyond the in-app counts.
5. **Change Events** for cost / schedule impact (phase 2 of Report an Issue).
6. **Report an Issue out of beta** after more phone testing.
7. **Signing in inside Procore's window** (the embedded app), so people don't leave Procore.
8. Feed search; role-group tagging (e.g. "all superintendents") from permission templates, now that the test data has them.

## Open questions

- Who counts as "PM and above" for dashboard access?
- Should a subcontractor's PM see the whole project's messages, or only their company's?
- Prototype with each person's own token, or move to a service account before any real company tries it?
- Which matters most to a real GC: faster issue capture (Report an Issue), less email / phone tag (messaging), or visibility for the PM (dashboard)?
- What would make a superintendent open SiteSnap instead of texting?

## Technical shape (for context)

- React + Vite PWA (installable, works offline), hosted on Vercel at sitesnap-procore.vercel.app; the `sitesnap` branch deploys to production.
- Procore calls run in Vercel functions (`api/procore/*`). Firebase project `sitesnap-procore`: Firestore for messages, Storage for photos / voice, Cloud Functions for transcription (Deepgram) and AI (Claude).
- Tests: node:test suites against the Firebase emulators and a mocked Procore, plus browser end-to-end tests.

## Where the details are (repo `mrkygray-art/pictalk`, branch `sitesnap`)

- `docs/sitesnap-messaging.md`: messaging build notes, data model, rules, what's next.
- `docs/PROCORE_API_NOTES.md`: Report an Issue (steps 1–4), sandbox results, test people page.
- `docs/sitesnap-procore-findings.md`: Procore API findings, directory, service accounts, webhooks.
- `docs/DECISIONS.md`: Ky's decisions for voice + photo → Procore record.
- `docs/sitesnap-changes.md`: the original SiteSnap plan (steps 1–8).
