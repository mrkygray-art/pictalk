# SiteSnap AI: messaging pivot, research before building

For `SPEC-messaging-pivot.md`, Build Order step 1 (research and report, no building). Written 2026-10-14.

**Sources:**
- Procore's published API reference data: developers.procore.com/api/v1/resource_groups and the per-resource OpenAPI JSON.
- Procore support docs (support.procore.com): Emails, Correspondence, Observations, Tasks and Punch List user guides; the permissions matrices; "What is in the emails sent from Procore?"; iOS notification settings.

Nothing here was tried against the sandbox. "Not confirmed" means the docs don't say.

## 1. Which Procore object should carry a conversation

| Object | Holds | Notifies on create (via API) | Recipients | Min. permission to create | Replies both ways | `private` |
|---|---|---|---|---|---|---|
| **Email Communications** (Emails tool) | subject, body, photos (`image_ids`), files (`upload_ids`) | Yes, it is a sent email; can't be suppressed | To / CC / BCC = Project Directory user ids | Standard | **Yes**: recipients reply from their own mail app, the reply is stored in the Emails tool, and the API reads threads (`GET /communications/{id}/threads`) | Limits viewing in Procore to the creator and admins, but Default Distribution members still get it |
| **Correspondence** (generic tool items) | title, description, photos, files; responses with files | Yes ("Create & Issue"); `skip_emails` flag on item and response | assignees + distribution (Directory users) | Standard on the correspondence type | Yes: email replies become responses; API list/create responses | Strong: only the people on the item + admins |
| Observations | name, description, files; response logs | **No**, not distributed on create; needs `send_unsent` or `send_email` | users eligible for the category | Standard, but assigning is restricted | Not confirmed by email; API response logs | not confirmed |
| Task Items + comments | title, description, files; comments | Not confirmed; `send_unsent` digests | users | Standard + "Create Tasks" granular | API comments; email replies not confirmed | creator, assignees, admins |
| Images (Photos) | one photo + description | no targeted notification | none | not confirmed | no comments API | per photo |
| RFIs | question + files | yes (RFI workflow) | users | Standard creates drafts only | formal Q&A only | yes |
| Instructions | title, description, files | `send_emails`, default off | attention + distribution | not confirmed | not confirmed | yes |
| Punch Items | description, photos; comments | explicit send / delayed digest | users | Standard can't assign | API comments only | yes |
| Daily Log notes | comment | none | none | not confirmed | no | no |
| Coordination Issues | title (80 chars), description, files, one assignee | not confirmed | one assignee + watchers | tool must be on | activity feed | yes |
| Conversations tool | (Procore's own chat) | | | | **No public API** (none of 649 resource groups) | |

**Recommendation**
- **Primary: Email Communications (the Emails tool).** It is the only object that is actually a message thread.
  - A Standard user can create it.
  - The tagged people get the transcript and photo links in their normal inbox and can **reply by email without a Procore login**.
  - Those replies land in Procore and can be read back, so the sync is two-way.
- **Fallback: Correspondence**, when a company has a General Correspondence type set up.
  - It has stronger privacy and iOS push notifications.
  - It depends on company configuration, which is why it's not the primary.
- **Avoid:** Observations, Punch and Tasks, which don't notify on create and restrict assigning. Photos, Daily Log and Coordination Issues have no targeted recipients.
- This **replaces the earlier Step 6 decision (Task)** in `sitesnap-procore-findings.md`; Task was chosen for status tracking, not messaging.

**Email Communications details (from the reference):**
- Create: `POST /rest/v1.0/project/{project_id}/email_communications?topic_type=&topic_id=` (both required; `topic_type=project` for a standalone thread). Body: `communication{subject, private}`, `email{body, image_ids, upload_ids, distribution_ids, cc_distribution_ids, bcc_distribution_ids}`.
- Reply: `POST .../email_communications/{id}/emails`.
- Read: `GET /rest/v1.0/communications/{id}/threads`.
- Photos: upload first (`/rest/v1.1/projects/{id}/uploads`), then pass `upload_ids`.

**Watch-outs:**
- Every send is a real email, so test only in the sandbox project.
- Default Distribution members on the project receive everything, even "private" emails.
- Recipients must be in the Project Directory.
- Webhooks for Emails / Correspondence aren't confirmed (they're listed per project at `GET /rest/v1.0/webhooks/resources?project_id=`), so plan to poll threads.

**Who writes it:** sending as the signed-in sender (their own Procore sign-in) makes them the author and needs their own Emails permission. The earlier decision (a PM's stored token) would make every message look like it came from the PM. Recommend: the sender's own token, falling back to a PM token only for senders who aren't Procore users. This needs a decision.

## 2. Notifications

| Channel | Who | Feasible | Notes |
|---|---|---|---|
| Procore email (via Emails tool) | tagged people | yes | Full text in the email; attachments as download links; replies by email work |
| Procore mobile push | tagged people | **no for Emails** | iOS push exists for Correspondence, Observation assigned and Photo comment mentions, not Emails |
| SiteSnap in-app unread badge | tagged people (For Me only) | yes | ReadState per user per conversation |
| SiteSnap email | tagged people | yes, later | Would double up with Procore's email; skip while the Emails tool sends |
| Web push (Firebase Cloud Messaging) | tagged SiteSnap users | yes, with limits | Android Chrome: yes. **iPhone: only when SiteSnap is added to the Home Screen (iOS 16.4+) and the user taps Allow.** Never inside Procore's frame. Needs a push step in our own service worker (`public/sw.js`). |
| Text messages | | not in v1 | per spec |

Untagged project members: visible in the feed, no email, no push, no badge.

## 3. Tagged people who aren't SiteSnap users
- They get Procore's email: subject, the transcript and description in the body, and photos as download links.
- They can reply from their mail app; the reply lands in the Procore thread, and SiteSnap reads it back into the conversation.
- "View in Procore" needs a Procore login; reading the email doesn't.
- No SiteSnap account is needed for any of this.
- They must be in the project's Procore Directory to be addressable.
- Not confirmed: whether photos show inline in the email or only as links. Check in the sandbox.

## 4. Existing job data (recommend: read-only archive, no migration)
- `sitesnap-procore` holds only test data: 16 accounts (mostly guests), 4 jobs, 2 stops, 0 wrap-up notes, 0 PM tags (counted 2026-10-14, no contents read).
- Recommend: keep it untouched, and hide My Jobs behind the flag. With the flag on, old jobs stay viewable read-only.
- Nothing is migrated or deleted. A migration tool isn't worth building for 4 test jobs.

## 5. Conflicts with what's deployed
1. **Identity:** the feed needs to know which Procore user is reading (For Me, unread, project membership). Today, SiteSnap sign-in (Firebase: guest / Google / email link) and Procore sign-in (a cookie on our server) are separate, and Firestore rules can't see the Procore one.
   - **Proposal:** after Procore sign-in, our server issues a Firebase sign-in tied to that Procore user and records which projects they're on (from Procore's project list).
   - Firestore rules then allow reading a project's conversations only for its members.
   - Reading works offline from Firestore's cache, and the feed updates live.
   - Procore becomes the sign-in for messaging. This is Step 4 (foreman identity) arriving early.
2. **Where messages live:** today stops are per person (`users/{uid}/stops`). Conversations are shared, so they'd go under `procoreProjects/{company}_{project}/conversations/...` (that collection is server-only today; the rules would open read access to project members).
3. **Step 6 decision (Task)** is replaced by Email Communications, if you agree.
4. **Directory search is live, and recipients are saved on stops.** It's reused as the To: search. Stop recipients stay as archive data.
5. **The help guide and the ? button** get hidden by the flag. `tests/help.test.js` checks the guide's button names, so the guide gets updated to the new screens. It isn't deleted.
6. **Inside Procore's frame:** the mic is blocked there, so the feed and reading can work in the frame, but New Message with voice opens a new tab (as Capture does today).
7. **"Private to tagged people" later:** possible on our side (rules check the tagged list). The Procore email is still visible to the Emails tool's admins and Default Distribution. Recommend adding it later as a per-conversation switch, off by default.

## 6. Data still requested earlier
- Phone coverage (`?shape=1`): still needs Ky's signed-in run.
- Vendor trades: only in the `view=extended` vendor list (`trades[]`), and only with Directory read permission. `trade_name` is the DBA, not the trade. Sandbox fill is unknown; a read-only count check would tell.
