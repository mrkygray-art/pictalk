# Guest demo link

From Ky's spec `sitesnap-guest-demo-spec.md` (2026-10-17). A visitor opens
**https://sitesnap-procore.vercel.app/demo** and lands in SiteSnap's project picker, signed in as Ky's
view-only Procore guest. No login page, no username or password, no popup, no third-party cookie.

## How it works

| Piece | Where |
| --- | --- |
| `/demo` (rewritten to `/api/procore/demo`) | `api/procore/demo.js`: rate limit, check the stored guest sign-in (refreshes it if needed), set the demo session cookie, redirect to `/?demo=1` (picker first). `?project=<id>` opens one allowlisted project. Fails → plain "temporarily unavailable" page (support email + portfolio link), never Procore's login. `noindex`. |
| Stored guest sign-in | Firestore `sitesnapDemo/guestAuth` (server only; the rules deny all client access). Tokens sealed with AES-256-GCM under `DEMO_TOKEN_ENCRYPTION_KEY`; also `guestUserId`, the allowlisted `projects` the guest can open, `status`, `lock`, times. |
| Demo session | The usual `pc_session` cookie (httpOnly, Secure, SameSite=Lax), holding only `{ role: "demo", sid, last }`. `session()` in `api/_procore.js` sees the role and asks `api/_demo.js` for the guest token, server side, for that one request. Ends after 2 hours idle. |
| Single-flight refresh | `guestTokens()` in `api/_demo.js`: refresh 5 minutes early; one refresh per server (`inflight`), one across servers (a 60 s lease in the same document, taken in a transaction). The new pair is saved before it's used. While one server refreshes, the others keep using the still-valid token (or wait for the new one). Procore refusing the refresh → `status: "failed"`, an `[ALERT] SiteSnap demo …` log line, and the unavailable page until Ky authorizes again. No loops. |
| Allowlist | `DEMO_PROJECT_IDS` (the same variable demo staging uses: `HP:373715,WG:373716,LV:373717`, or plain ids). The picker lists only those; any Procore request for another project id (path `/projects/{id}` or `project_id`) is refused with 403 `demo_project` before it leaves the server. |
| Up to the send (Ky, 2026-10-17) | A demo visitor can use every feature until it would send: photos, voice notes (uploaded and written down), Fill It In, Organize, inspection answers / notes / photos / N/A (kept on the phone), tagging people, replies. The view-only note shows at **Send to Procore**, message **Send** (New Message, Reply, Add People, quick replies), Snap's **Save**, Daily log **Send**, inspection **Submit** and a Fail's **Create Observation** (the item is then marked Fail on the phone). `src/messaging/demoMode.js` switches off the message, photo and inspection queues, so nothing leaves even if a button slipped through. |
| Demo AI limits | Demo visitors may run only the AI steps before a send: `transcribeMessageVoice`, `classifyCapture`, `organizeDailyLog` (`requireMember(..., { demoAi: true })` in `functions/messaging.js`). `reserveDemoAi`: **50 a day** for all demo visitors together (Pacific days, `sitesnapDemo/aiUsage/days/{date}`) and 15 an hour per visitor (hashed IP, `sitesnapDemo/aiUsage/visitors/{hash}`); past that, a friendly "type the words instead" message (Fill It In and Organize still work without AI). `storage.rules` let a demo sign-in upload only `voice.*` files, and the function deletes a demo recording right after writing it down. |
| Read only | 1) every POST through `requireSameOriginJson` is refused with `{ error: "demo_read_only", message: "This is a view-only demo.", demo: true }` (except SiteSnap sign-in, sign-out and the OAuth callback, which change nothing in Procore); 2) the Procore layer (`procoreGet`, `procoreSend`) sends only GETs for a demo session; 3) the sandbox tool pages are blocked; 4) the Firebase sign-in carries `demo: true`, and `firestore.rules` refuse its writes (`storage.rules`: voice notes only); 5) `requireMember` in `functions/messaging.js` refuses it except the capped AI steps above. |
| Guest identity | Never shown: the SiteSnap name is "Guest", `/api/procore/me` answers `{ name: "Guest", email: null }`, the guest's own row is left out of the directory, tokens never reach the browser. |
| Quota | Identical demo reads are answered from memory for 45 s; a server spends at most 100 Procore calls a minute on the demo; 60 requests a minute per IP (hashed, in `sitesnapDemo/rate/ips/{hash}`). The project list comes from the stored authorization (no Procore calls). |
| App | `src/messaging/demo.js` (context, `useDemoGuard`), `DemoBanner.jsx` (the pinned "Demo mode: view only · Exit demo" banner and the friendly sheet), `demoMode.js` (the queues' switch). Close/Reopen and to-do Done also show the note. Phone alerts and read marks are off; the feed opens on All Project. The sign-in screen has **Explore as a guest** under "Use a different Procore account". |

## Ky's setup (once)

1. **Deploy the rules and the functions change** (before turning the demo on):
   `firebase deploy --only firestore:rules,storage,functions:classifyCapture,functions:organizeDailyLog,functions:transcribeMessageVoice,functions:describeMessagePhoto,functions:setMessageTask --project sitesnap-procore`
2. **Vercel env** (project `sitesnap-procore`, Production), then redeploy:
   - `DEMO_ENABLED=true`
   - `DEMO_TOKEN_ENCRYPTION_KEY=` 32+ random characters (for example the output of `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). Changing it later makes the stored sign-in unreadable: authorize again.
   - `DEMO_ADMIN_EMAILS=` your own Procore login email (comma-separated if more than one).
   - `DEMO_PROJECT_IDS` is already set; keep only the three guest projects in it.
   - Nothing changes in the Procore app: the authorize step uses the same redirect URI.
3. **Authorize the guest**: sign in to SiteSnap with your own Procore account, open
   `/admin/demo-authorize`, press **Sign Out of Procore** (close that tab when it says you're signed out), then
   **Authorize the Guest** and sign in with the guest's Procore email and password. The page refuses your own
   account, and says which allowlisted projects the guest can't open.
4. Open `/demo` in a private window (desktop Chrome and iPhone Safari).
5. Optional: **Add Sample Messages** on the same page loads a few conversations per demo project
   (`api/_demoMessages.js`, threads `sample-*` with `sample: true`) so every Messages tab has something:
   For Me (guest in To), CC, Sent (guest started it) and All Project. The people are the demo staging people,
   matched by email in each project's directory; anyone missing skips that thread (the page says which).
   Each message runs through `onConversationMessage` like a real one (feed card, AI to-dos). Loading again
   replaces them; **Remove Sample Messages** deletes them and their read marks.

If the demo ever shows "temporarily unavailable": open `/admin/demo-authorize`; it shows the failure reason. Search
the Vercel logs for `[ALERT] SiteSnap demo` (a Vercel log alert or drain on that text can email you; SiteSnap
itself has no email sending).

## Acceptance tests

`tests/demo.test.js` covers the spec's list with mocked Procore (no login on `/demo`, exactly three projects,
403 for others, nothing identifying or secret in answers, every write refused at both layers, one refresh for many
visitors, saving the new pair, waiting for another server's refresh, the unavailable page, refused refresh marks it
failed once, idle expiry, rate limit, cache, Exit demo, normal sign-ins unchanged, owner-only authorize).
`tests/messaging-rules.test.js` and `tests/messaging-functions.test.js` cover the `demo: true` claim.
Still to check by hand on the live site after setup: tests 1, 5 and 6 on a real iPhone, and 7 (after 90 minutes,
or with **Test a Refresh Now** on the authorize page).

Not built: the optional "Try voice capture" (spec section 10); voice is shown but blocked like every other write.
