# SiteSnap AI: Changes Spec

Put this file in the repo at `docs/sitesnap-changes.md` and work from it.
Branch: `sitesnap`. Do not touch `master`.

## 1. Goal

SiteSnap is the conversation layer for job sites, and Procore is the system of record.

- A foreman takes a photo and asks a question (where are the materials, what is the ETA, who is in charge).
- SiteSnap finds the responsible person and starts a thread inside the app.
- The conversation (text and photos) happens in SiteSnap. **No SMS or text messages.**
- SiteSnap writes a matching record to Procore so there is a public record, and keeps its status in sync.
- Foremen never log in to Procore. PMs and owners see open, unanswered, and aging items in the Procore dashboard and can step back into any thread.

## 2. Current state (already working, do not rebuild)

- Vite app deployed to Vercel as `sitesnap-procore` at `https://sitesnap-procore.vercel.app`.
- Production Branch is set to `sitesnap`. **Every push to `sitesnap` goes live and is what Procore loads.** Be careful with half-finished work (use a feature flag or a preview branch).
- Installed in the Procore developer sandbox as "SiteSnap AI" (version 0.2.0) with a Fullscreen embedded component.
  - Component URL: `https://sitesnap-procore.vercel.app?companyId={{procore.company.id}}&projectId={{procore.project.id}}`
  - Data Connector: User Level Authentication.
- Sandbox company ID: `4291776`. Test project: `001 - SiteSnap Test Project`, ID `373235`.
- Embedded mode works: reads `companyId` and `projectId` from the URL, detects the iframe, shows a debug strip, and shows a "Capture in a new tab" button when embedded.
- Procore OAuth (authorization code flow) works: "Connect Procore" signs in, then lists the project's Directory people through server-side routes under `/api/procore/*`.
- Environment variables set in Vercel (names only, never print values): `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`, `PROCORE_LOGIN_URL` (`https://login-sandbox.procore.com`), `PROCORE_API_URL` (`https://sandbox.procore.com`), `SESSION_SECRET`.
- Sandbox redirect URI registered in the Procore developer portal: `https://sitesnap-procore.vercel.app/api/procore/callback`.
- Procore's embedded frame blocks the microphone. Mic and camera work in a normal browser tab. So voice capture happens in the new tab, and the embedded view is a launcher and dashboard.

## 3. Hard rules

1. Never commit, log, or print secrets or tokens. Procore tokens stay server-side. No `VITE_` variable may hold a secret.
2. Do not modify `master`.
3. `sitesnap-ai.vercel.app` belongs to someone else. Do not connect to it, log in to it, or reference it.
4. Do not add Twilio, SMS, or any text-message sending.
5. Verify Procore endpoints, headers, and permissions against Procore's current API reference. Do not guess. If something cannot be confirmed, say so and stop at that point.
6. Add tests for new logic, with mocked Procore responses. Run the full suite twice before trusting a failure (an earlier run had a startup timing failure that passed on rerun).
7. No new dependencies without asking.

## 4. Changes to build (in this order)

### Step 1: UI cleanup
- Hide **Piccolo** behind a feature flag (off for SiteSnap). Do not delete its code.
- Remove the guest-mode banner and the "Save my work" prompt text. Replace with a clear sign-in state ("Sign in to SiteSnap", "Connected to Procore as ...").
- Rebrand visible text from PicTalk to SiteSnap AI. Keep the capture flow: photo, voice note, save a stop, AI description.
- Keep the original PicTalk behavior on `master` untouched.

### Step 2: Fix the people list
- The Directory list shows a dash under most names (role or company missing). Print the raw Directory response shape (names only, no tokens) and report which fields hold job title, company, and role.
- Show company and role for each person. Return phone and email only on the server side, and only when needed.
- Allow a PM to tag a person with a responsibility label (PM, Superintendent, Purchasing, Sub foreman) when Directory titles are missing.

### Step 3: Separate Firebase project
- SiteSnap currently shares the original PicTalk Firebase project (`pictalk-6cbff`). Create a dedicated Firebase project for SiteSnap before storing any thread data.
- Add the new Vercel domain to Firebase Authentication authorized domains.
- App Check is currently in Monitoring mode. Do not enforce it until the new domain is on the reCAPTCHA (Fraud Defense) key's domain list.

### Step 4: Foreman identity
- Foremen sign in to SiteSnap with the existing Google or emailed-link sign-in, once.
- Match the signed-in email to a Procore Directory person for the current project, so the app knows who they are and which company they belong to.
- PMs and owners sign in through Procore OAuth (already working).

### Step 5: Conversation threads
- A thread = one question + photos + replies + an owner + a status (Open, Waiting, Resolved).
- Suggest an owner automatically, then let the foreman change it. Suggestion order:
  1. The assignee on a related PO, RFI, or Submittal.
  2. The Directory role (superintendent, purchasing).
  3. The PM as the fallback.
- Threads, photos, and replies live in the new Firebase project, scoped to a Procore company and project.
- Security rules: a user can only read threads for projects they belong to. Tokens and contact details are never readable from the client.

### Step 6: Write to Procore
- Prototype first: when a thread is created, create **one Task** in the sandbox project with the photo attached, the question as the description, the assignee set, the foreman's name in the text (service writes may not show the real author), and a link back to the SiteSnap thread.
- Before building, check the docs and report: the Tasks (and Observations) endpoints, required headers and permissions, how photos attach, and whether they fit this use. Observations may fit better (photo-centric, assignable, status and due date). Recommend one.
- If a call returns forbidden, report exactly which tool permission is missing. It will need to be added on the Configuration Builder page and a new app version created and installed.
- Mirror status and key replies back to the Procore item. Closing the thread closes the Procore item.
- Do not use RFIs for casual questions.
- Do not build on Procore's Conversations tool unless its API is confirmed.

### Step 7: Notifications (in-app only)
- No SMS. Use:
  - An in-app inbox with unread badges and "waiting on you" threads.
  - Push notifications through Firebase Cloud Messaging. Note that iPhone push needs the app added to the Home Screen.
  - Optional quiet email fallback for threads unopened for a day.
- Write the notification layer so the delivery channel is swappable.

### Step 7b: PM dashboard in the embedded app
- In the Procore frame, show: open threads, unanswered threads, aging items, and who each is waiting on.
- A PM can reply, reassign, or resolve from there. Replies notify the other person through the in-app channels above.
- Voice capture stays out of the frame (mic blocked). "Capture in a new tab" stays.

### Step 8: Keep in sync
- Use Procore webhooks to learn when an item changes or is commented on in Procore, and reflect it in the thread. Check the webhooks docs first and report what events are available.

## 5. Later: embedded sign-in

Not now. When needed, the design is:
- Sign-in runs in a popup. The server keeps the Procore token and hands the frame a one-time ID, which the frame exchanges for a short-lived session ID held in memory.
- Prefer Firestore for sessions with encrypted tokens and rules blocking client reads. Treat the Storage Access API as a fallback only.
- Procore's helper doc says the OAuth code may come back after `#` in the URL. The callback currently reads only `?code=`. Test what the sandbox actually returns.
- Do not add `@procore/procore-iframe-helpers` until this is decided.

## 6. Definition of done for each step

- Tests pass (run twice).
- No secrets in code, logs, or the client bundle.
- Tested in the Procore sandbox: inside the frame and in the new tab.
- A short note of what changed and what could not be verified.
- Pushed to `sitesnap` only when safe to go live, since pushes deploy to Production.

## 7. Open questions to report back

1. Which Procore item fits best: Task or Observation?
2. Are service accounts available for writes, and how are they installed for a real customer?
3. Where do job title and company live in the Directory response?
4. Does the Directory call include users who are not invited or are inactive?
5. What does the sandbox return after OAuth: `?code=` or a `#` fragment?
6. Which webhook events cover Task or Observation changes?
