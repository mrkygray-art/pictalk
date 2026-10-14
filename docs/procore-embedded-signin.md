# Procore sign-in from inside the iframe (design note)

Status: proposal, not built. Branch `sitesnap`, 2026-10-13.

## Today

- **Inside Procore's iframe**, PicTalk is only a launcher. It shows the company and project IDs and a "Capture in a new tab" button. There's no sign-in in the frame.
- **In the top-level tab**, sign-in runs the normal OAuth flow (`api/procore/login` → Procore → `api/procore/callback`). The tokens stay on the server, in an encrypted httpOnly cookie that page scripts can't read.

## Why the frame can't just use that cookie

Inside Procore, our page is a third-party frame under `app.procore.com`. A `SameSite=Lax` cookie isn't sent there. `SameSite=None` cookies are blocked or partitioned by current browsers.

A cookie set in a popup is filed under our own site, but the frame's cookies are filed under Procore's site. So a cookie from the popup isn't visible to the frame either.

## Proposed flow

The Procore token never reaches the browser. The browser only ever holds two random IDs: a one-time handoff ID, and a short-lived session ID kept in memory.

1. **Frame:** "Connect Procore" makes a random `frameNonce` and keeps it in memory. On the same click (so popup blockers allow it), it opens a popup at `/api/procore/login?companyId&projectId&popup=<frameNonce>`.
2. **Popup:** runs today's server flow unchanged. The state cookie works there because the popup is a top-level page on our own site.
3. **Callback, server side:**
   - Exchange the code.
   - Save the tokens, encrypted, in Firestore `procoreSessions/{id}`.
   - Create a handoff record `procoreHandoffs/{sha256(handoffId)}` holding `{ sessionId, nonceHash, expiresAt: +60 s }`.
4. **Callback page in the popup:**
   - Send `window.opener.postMessage({ type: "procore:handoff", handoffId }, OUR_ORIGIN)`. The target origin is exact: the frame is our own page.
   - Close the popup.
   - The frame accepts the message only if `event.origin === OUR_ORIGIN` and `event.source` is the popup it opened.
5. **Frame:** POSTs `{ handoffId, frameNonce }` to `/api/procore/handoff`. The server handles it in one Firestore transaction:
   - Check the handoff exists, hasn't expired, and matches the nonce, then delete it so it can't be used twice.
   - Create `procoreFrameSessions/{sha256(sid)}` with `{ sessionId, expiresAt: +30 min }`, where `sid` is 32 random bytes.
   - Return `sid`.
6. **Frame:** keeps `sid` in a JS variable only. Nothing goes in localStorage, sessionStorage, IndexedDB, cookies or a `VITE_` variable. It calls `/api/procore/me` and `/api/procore/directory` with `Authorization: Bearer <sid>` and no cookies.
   - Reloading the frame means connecting again. If the user is still logged in to Procore, the popup finishes in about a second.
7. **Server, per call:**
   - Look up `sha256(sid)` and check its expiry.
   - Decrypt the tokens and refresh them if needed, inside a transaction. Procore issues a new refresh token on every refresh, so the transaction also stops two refreshes at once, which the cookie version can't.
   - Write the new tokens back, encrypted.

A later option: Procore's `@procore/procore-iframe-helpers` (`authenticate` / `notifySuccess`) could replace steps 1 and 4. Not adding it for now.

## Firestore storage

- **Encryption:** tokens use AES-256-GCM with their own server-only key, `PROCORE_TOKEN_KEY`. That's separate from `SESSION_SECRET`, so one leaked secret doesn't expose both. The document ID is bound in as associated data, and a key ID is stored so the key can be rotated.
- **Rules:** clients can't read or write any of the three collections.

  ```
  match /procoreSessions/{id}      { allow read, write: if false; }
  match /procoreHandoffs/{id}      { allow read, write: if false; }
  match /procoreFrameSessions/{id} { allow read, write: if false; }
  ```

  Only the server, using the Admin SDK, touches them. Add `tests/rules.test.js` cases proving a signed-in user can't read them.
- **Hashed IDs:** handoff and frame-session documents are stored under a hash of the ID, so someone who could read the database still couldn't use them.
- **Expiry:** a Firestore TTL policy on `expiresAt` removes old handoffs and frame sessions. `procoreSessions` ends after 30 days idle.
- **Sign-out:** delete the user's documents and call Procore's `/oauth/revoke`. Procore's docs say apps should support revoking access.
- **Project:** the Procore sandbox uses the test Firebase project `pictalk-dev-52368`, and live Procore uses `pictalk-6cbff`, never mixed.

## Storage Access API (fallback only)

Use this only if the popup handoff isn't possible, for example where a customer's IT blocks popups.

From a click, the frame calls `document.requestStorageAccess()`. If the browser grants it, a `SameSite=None; Secure` session cookie is sent to the frame.

It's a fallback because:
- Safari only grants it after the user has visited our site as a top-level page.
- Browser support and prompts vary.
- It brings back cookie-based sessions in the frame.

## Getting the IDs inside Procore

- **Full-screen app:** Procore fills `{{procore.company.id}}` and `{{procore.project.id}}` into our URL (already handled).
- **Side-panel app:** post `{ type: "initialize" }` to the exact Procore origin (`app.procore.com`, `us02` or `uk01`). Procore answers with a `setup` message containing `company_id`, `project_id`, `view` and `id`.

## Open questions

1. **Code in the query or after `#`?** The callback handles both and logs which one Procore used (`Procore callback: code arrived in the query` / `… after '#'`). Check the Vercel logs after the first sandbox sign-in.
2. **Firestore access from Vercel.** This needs either `firebase-admin` (a new root dependency), or the Firestore REST API with a service-account token signed using `node:crypto` (no dependency, more code). Another option is moving these endpoints to the existing Cloud Functions, which already use `firebase-admin`.
3. **Allowed frame parents.** The page should set `frame-ancestors` to Procore's origins, including sandbox and every region.

## Testing plan

- Unit tests against the Firestore emulator (already part of `npm test`), covering the handoff rules: one use, 60-second expiry, nonce match, and the refresh transaction.
- Rules tests for the three collections.
- An e2e test like `e2e/e2e-procore.js`, with the stand-in Procore and a host page that frames the app and runs the popup.
