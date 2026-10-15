# SiteSnap AI: project messaging (build notes)

From `SPEC-messaging-pivot.md`. Ky's decisions (2026-10-14):
1. Use the recommendation: Procore Email Communications carries conversations (Correspondence as fallback). It stays a messaging platform, and the AI flags tasks ("send someone files", "fix this") with who they're for.
2. Everyone signs in.
3. Procore sign-in is the SiteSnap sign-in, so the author is tracked.
4. Remove the old jobs. SiteSnap works like Microsoft Teams: a project is the team, conversations are its threads.

Research behind 1: `docs/sitesnap-messaging-research.md` (branch `sitesnap-messaging-research`).

## Built (branch `sitesnap-messaging`)

**Sign-in.** `POST /api/procore/session` (`api/procore/session.js`) runs after Procore OAuth:
- It reads `/rest/v1.0/me` and the user's projects (`api/_projects.js`, shared with `/api/procore/projects`).
- It writes `procoreUsers/{procoreUserId}` and `procoreProjects/{companyId}_{projectId}/members/{procoreUserId}`. It removes the member docs of projects Procore no longer lists, so a person taken off a project loses its feed.
- It returns a Firebase custom token (uid `procore_{id}`, claim `procoreUserId`), signed with the existing `FIREBASE_SERVICE_ACCOUNT_B64` key.

The app (`src/messaging/useProcoreSession.js`) signs in with it. There are no guests in messaging mode.

**Data** (Firestore, `procoreProjects/{key}/…`):
- `conversations/{cid}`
  - written by the app: `createdBy`, `tagged[]`, `taggedIds[]`, `status` (open / closed), `createdAt`, `lastActivityAt`
  - written by the server: `lastMessage`, `messageCount`, `firstPhotoPath`, `openTasks[]`, `taskAssigneeIds[]`
- `conversations/{cid}/messages/{mid}`
  - written by the app: `authorId`, `authorName`, `text`, `transcript`, `transcriptStatus`, `photos[]`, `voicePath`, `aiDescription`
  - written by the server: `tasks[]`, `tasksStatus`, plus `transcript` when the app couldn't transcribe first
- `members/{me}/reads/{cid}`: `lastReadAt`, used for For Me unread dots

Files: Storage `messages/{key}/{cid}/{mid}/photo-{n}.{ext}` and `voice.{ext}`.

Tagged people are stored as `procoreUserId`, name, company and title only. Email and phone are never stored.

**Rules:**
- Only a project's members read its conversations, messages and files.
- People write only as themselves.
- A new conversation must tag at least one person.
- Anyone on the project can tag more people or open / close a conversation; nobody can untag.
- Messages are written once. Summaries, transcripts and tasks are server-only.
- Default visibility is the whole project, per the spec. "Private to tagged people" is a later switch, not built.

**Functions** (`functions/messaging.js`):
- `onConversationMessage` (on each new message):
  - transcribes a voice note sent without signal;
  - updates the feed card;
  - asks Claude (opus-5-5, effort low, JSON schema) for tasks: what someone tagged is asked to do, assigned to tagged ids only (a named company means everyone tagged at it), with a due phrase.
  - Failures never block the message. The emulator uses a stand-in: "please / send / need / can you" makes one task for everyone tagged.
- `transcribeMessageVoice` and `describeMessagePhoto` (composer callables, members only, paths inside the project's folder).
- `setMessageTask` (an assignee or the sender marks a task done or reopens it).

**App** (`src/messaging/`, rendered by `main.jsx` unless `VITE_FEATURE_JOBS=1`):
- Sign in with Procore, then the project picker (the link's project, else the last one, else the only one), with Switch Project.
- **Feed**: For Me (tagged and open: highlighted, unread dot, task badge, count on the tab) | All Project (others' look calmer, never alert) | Mine.
- **New Message**: To: → search (Name / Title / Company / All, "Tag everyone at {company}", "Tag all N matches", "N people tagged") → photos (up to 10) → Tap to Talk (the words come back before sending and can be edited) → note → optional "Describe photo with AI" (editable, removable) → Send.
  - Send is blocked with a message when no one is tagged.
- **Conversation**: Started by / To:, Add People, Close / Reopen, messages (photos, voice, words, AI description, tasks with Mark Done), and a reply with the same tools.
- **Offline**: messages wait in IndexedDB (`pending-message:`) with their files and send when there's signal ("Sending…" / "Not sent yet"). Firestore's cache keeps read conversations, and the directory is cached per project.

Hidden, not deleted (`VITE_FEATURE_JOBS=1` brings them back): My Jobs, Start New Job, Save This Stop, End Job, Recent jobs, the ? help and its guide, Reset Example Jobs, and the "No job open" banner.

**Tests:** `tests/messaging-session.test.js`, `tests/messaging-rules.test.js`, `tests/messaging-functions.test.js`, and `e2e/e2e-messaging.js` (sender, tagged person, untagged member and non-member, in four browsers).

## Round 2, Phase 1 (`SITESNAP-MESSAGING-NEXT.md`, 2026-10-14)

- **Quick replies.**
  - The list lives in `src/messaging/quickReplies.js` (labels, what the sender is told, and the Delayed reasons). Edit it there; the rules only check lengths.
  - People a message was sent to see four big buttons (Done, On it, Delayed, Need info) plus More.
  - One tap sends a message with just `status {code, label}` through the normal send queue. Delayed asks why and for a new date first, both optional.
  - In the Reply composer, a quick reply can go along with a photo, voice note or note.
  - The thread shows a colored status line; the feed card reads "Delayed · Weather · new date Fri".
  - The server keeps each person's latest one on the conversation (`statuses.{pid}`). **Done** also finishes that person's open to-dos in the thread.
- **Tracking, in plain words**, under To: on each thread: "Tia Tagged · Seen 2:14 PM · On it 2:20 PM".
  - Server-only: `seen.{pid}` (first open, from the read mark, via `onConversationRead`), `answered.{pid}`, `firstResponseAt` / `firstResponseBy`, plus the status times. Phase 2 reports are built from these.
- **One Reply button** on an open thread. Tapping it opens the composer; Cancel puts the button back.
- **Closed.**
  - Only the sender or someone tagged closes or reopens. Each leaves a line in the thread ("Closed by Tia"), so the others get the unread alert.
  - A closed thread shows only Closed and Reopen.
  - The rules refuse new messages on a closed conversation. The only exception is the Closed line written in the same batch that closes an open one; the rules compare the conversation before and after that batch.
- **AI photo description hidden:** `SHOW_AI_PHOTO_DESCRIPTION = false` in `src/features.js`. The functions and saved text are kept.
- **Header:** name · company · title, from the signed-in person's own Procore project directory entry. Only what exists is shown.
- **Words:** Messages, not Conversations; "To do" for flagged tasks.
- **Address bar:** `?procore=` is cleared from it after sign-in.

**Deploy before merging this round** (the new rules allow `status` / `event` on messages; the app sends them):
```
firebase deploy --only firestore:rules,functions:onConversationMessage,functions:onConversationRead,functions:setMessageTask --project sitesnap-procore
```

## Not built yet (the spec's later steps)
- **Procore sync adapter** (Email Communications, with `procoreSyncStatus` / `procoreRef` and Retry). Also pushing flagged tasks into Procore as Task Items.
- **Alerts beyond the in-app unread count** (Procore email through the sync, web push).
- **Feed search** (a nice-to-have in the spec).
- **Role-group tagging from permission templates:** the sandbox had none filled in. Title search covers Procore roles.

## To publish (in this order)
1. Deploy to `sitesnap-procore`:
   ```
   firebase deploy --only firestore:rules,firestore:indexes,storage,functions:onConversationMessage,functions:transcribeMessageVoice,functions:describeMessagePhoto,functions:setMessageTask,functions:describeStopPhoto --project sitesnap-procore
   ```
   `describeStopPhoto` is included because `photo.js` now shares its helpers. Indexes take a few minutes to build; the feed's For Me and Mine queries need them.
2. Merge `sitesnap-messaging` into `sitesnap` (Vercel deploys it).
3. Remove the old job data:
   - Firestore: `firebase firestore:delete users --recursive --project sitesnap-procore`. It holds only the old app's profiles, jobs, stops and usage counters; 16 accounts, 4 jobs and 2 stops on 2026-10-14.
   - Storage, in Cloud Shell: `gcloud storage rm -r gs://sitesnap-procore.firebasestorage.app/photos gs://sitesnap-procore.firebasestorage.app/voice gs://sitesnap-procore.firebasestorage.app/exports` (and `/finals` if it exists).
   - Optional: turn off Anonymous, Google and Email-link sign-in in Firebase Auth. Messaging signs in only through Procore.
4. Sandbox test with a sender, a tagged person and an untagged project member.

## Phone alerts (web push), 2026-10-15

- **How:** Firebase Cloud Messaging (already in the `firebase` / `firebase-admin` packages; nothing new installed). The Messages screen has an Alerts line (`src/messaging/PushToggle.jsx`, `pushStore.js`): Turn on asks the browser's permission, gets this phone's push address from FCM through our own service worker, and saves it at `procoreUsers/{procoreUserId}/pushTokens/{token}` (rules: each person adds or removes only their own; nobody reads them but the server).
- **Who's alerted:** on every new message (including quick replies and Closed / Reopened lines), the thread's starter and everyone tagged, except the person who wrote it (`alertTargets` / `sendAlerts` in `functions/messaging.js`). The alert: the author's name, the feed card's line, and a link that opens the thread (`/?companyId=&projectId=&cid=`). Addresses Procore/FCM says are gone are deleted.
- **Service worker** (`public/sw.js`): shows the notification (`push`) and opens or focuses the app on tap (`notificationclick`).
- **iPhone:** web push only works for the Home Screen app (iOS 16.4+); the Alerts line says so in Safari.
- **Setup:** `VITE_FCM_VAPID_KEY` in Vercel = the public Web Push key from Firebase (Project settings → Cloud Messaging → Web Push certificates → Generate key pair). It's a public key, safe in a `VITE_` variable. Without it the Alerts line doesn't show.
- **Deploy:** `firebase deploy --only firestore:rules,functions:onConversationMessage --project sitesnap-procore`.
- Tests: `tests/alerts.test.js`, the push-address rules in `tests/messaging-rules.test.js`.
