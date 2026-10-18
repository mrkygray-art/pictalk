# SiteSnap: "Ask" button and Guide panel

Target repo: `sitesnap-procore` (Vercel). Place this file in `docs/`. Build on a separate branch so production is not affected.

## 0. Before writing any code (Claude Code: do this first)

1. Read the codebase and summarize back:
   - Where the project home screen (the six cards, header, Alerts line) is rendered
   - The current header row that shows the signed-in name and "Sign out"
   - The existing design tokens, colors, and component styles
   - How SiteSnap behaves inside Procore's embedded frame
2. Reuse existing patterns and styles. Do not add a new UI library.
3. Do not change any existing card, route, or feature.

## 1. Goal

Add an **Ask** icon button to the project home screen. Tapping it opens a panel that shows the SiteSnap Guide, a separate chatbot that answers questions about the home screen cards, workflows, and what to expect. The guide is already live and stays a separate service. This feature only embeds it.

Guide address (embed this exact address): `https://sitesnap-guide.mrkygray.workers.dev/?embed=1`

## 2. Out of scope

- Voice input to the guide (microphone does not work inside Procore's frame)
- Passing the user's name, project, company, or any Procore data to the guide
- A native chat UI (that is a possible later version)
- Changes to the guide itself (handled in its own repo)

## 3. Placement and look

- **Ask button:** on the project home screen, in the row that shows the user's name and "Sign out", aligned to the right end of that row. Do not use a floating button, so it cannot cover the Alerts line or the cards.
- Icon: a simple speech-bubble-with-question-mark or "?" in a circle, in the existing amber accent. Visible label "Ask" next to the icon.
- Tap target at least 44 px, contrast at least 4.5:1, matching the current iPhone-style skin. No emoji.
- Shown only on the project home screen for now.

## 4. Panel behavior

- Layout depends on screen size (bottom sheet on phones, side panel on larger screens). See section 4b for the exact rules.
- Header: title "Ask the SiteSnap Guide" and a close button (44 px). Below the header, one small line: "Questions are saved to improve this guide."
- Body: an iframe pointing at the guide address in section 1.
- Close with the close button, the backdrop, or the Escape key. Closing returns focus to the Ask button.
- Respect safe-area insets on iPhone (top and bottom) so nothing sits under system bars.
- While the panel is open, the page behind it does not scroll.

### Iframe settings

- `title="SiteSnap Guide"`
- `referrerpolicy="no-referrer"`. SiteSnap's address contains project and company IDs in its query string, and these must not be sent to the guide.
- No `allow` attribute (no microphone, camera, or location).
- `sandbox="allow-scripts allow-same-origin allow-forms"`
- Create the iframe the first time the panel is opened. Keep it mounted afterward so the conversation is kept when the panel is closed and reopened during the same session.

### States

- **Loading:** show "Loading the guide..." until the frame finishes loading.
- **Slow or failed (10 seconds):** show "The guide could not load." with a **Try again** button and an **Open in a new tab** link to the guide address (without `?embed=1`).
- **Offline** (`navigator.onLine` is false): show "The guide needs a connection. Your other SiteSnap features still work." Do not create the iframe until the connection returns.
- The guide is not part of the offline queue. Nothing is queued or retried.

## 4b. Phone and desktop compatibility

The feature must work equally well on phones, tablets, and desktop browsers. Build one responsive component, not two separate ones.

### Layout by screen size

| Screen | Layout | Behavior |
|---|---|---|
| Phone, portrait (under 768 px wide) | Bottom sheet, full width, about 85% of the visible height, rounded top corners | Modal: dim backdrop, page behind does not scroll, focus stays inside the panel |
| Phone, landscape (under 500 px tall) | Sheet fills the full visible height | Same as portrait, so the chat input has room |
| Tablet and desktop (768 px wide and up) | Right-side panel, about 420 px wide, full visible height | Not modal: no dim backdrop, and the page behind stays usable |

- Use `dvh` units (dynamic viewport height), not `vh`, so mobile browser toolbars do not cut the panel off.
- If the screen is resized or rotated while the panel is open, switch layouts without reloading the iframe or losing the conversation.
- On desktop, the panel must not cover the six cards entirely on narrow windows. Below 768 px it becomes the bottom sheet.

### Touch and mouse

- Every control works with a finger or a mouse. No feature depends on hover.
- Tap targets are at least 44 px on touch screens.
- Mouse users get hover and pressed states. Everyone gets a visible keyboard focus ring (`:focus-visible`).

### Keyboard (desktop)

- The Ask button and close button are reachable with Tab and activated with Enter or Space.
- Escape closes the panel when focus is inside it.
- On open, focus moves into the panel. On close, focus returns to the Ask button.
- On phones (modal), Tab does not leave the panel while it is open. On desktop (non-modal), it can.

### On-screen keyboard (phones)

- When the phone keyboard opens, the chat input must stay visible. Use the `visualViewport` API to size the sheet to the visible area, because iOS Safari does not resize the page when the keyboard opens.
- Do not let the sheet slide off the top of the screen when the keyboard is open.
- The guide's text box uses a font size of at least 16 px so iOS does not zoom in on focus. This is already true in the guide. Do not override it.

### Safe areas, zoom, and motion

- Respect `env(safe-area-inset-*)` on all four sides (top and bottom in portrait, left and right in landscape).
- The layout works at 200% browser zoom and with the largest system text size. No fixed pixel heights that clip content.
- If the user has "reduce motion" turned on (`prefers-reduced-motion`), the panel appears without a slide animation.
- Works in the installed Home Screen version of SiteSnap on iPhone (phone alerts depend on it), not only in Safari.

### Browsers and devices to support

- iPhone: Safari, and the Home Screen app
- Android: Chrome
- iPad: Safari
- Desktop: Chrome, Edge, Firefox, Safari
- Inside Procore's embedded frame on desktop and on phone. If Procore's own mobile app is used to open SiteSnap, test there too and report the result.

## 5. Privacy and data

- Send nothing about the user to the guide: no name, email, Procore IDs, project name, or current screen.
- Do not log the contents of the guide conversation in SiteSnap's database.
- The guide's own service records the questions people type. The line in section 4 tells the user.

## 6. Constraints

- Plain-language copy for foremen. No Procore jargon on field screens.
- Do not request any new Procore permissions or scopes.
- Feature flag: `VITE_FEATURE_ASK` (default off). When off, the Ask button is not rendered.

## 7. Verify before finishing (blocking)

Test these and report the results before calling the feature done. Record findings in `docs/ask-guide-findings.md`.

1. **Does the panel work on a phone** (iPhone Safari and Android Chrome) with correct safe-area spacing?
2. **Does it work inside Procore's embedded frame?** SiteSnap runs in that frame, so the guide is nested two levels deep. If the guide does not appear, open the browser console and copy the exact "Refused to frame" message. It names the address that must be allowed.
3. **Does typing work** in the guide's text box inside the sheet on iPhone, including when the keyboard opens? Check that the input is not hidden behind the keyboard.
4. **Does closing and reopening** keep the conversation during the session?
5. **Does the offline message** appear when the connection is off, and does the panel recover when it returns?
6. **Phone and desktop layouts (section 4b):** do the bottom sheet (phone) and side panel (desktop) both look right, and does resizing a desktop window across 768 px switch between them without losing the conversation?
7. **Rotation:** on a phone, rotate while the panel is open. Does the layout stay usable in landscape?
8. **On-screen keyboard:** on iPhone Safari and Android Chrome, is the chat input still visible with the keyboard open, and does the page avoid zooming when the input is tapped?
9. **Keyboard-only on desktop:** can you open the panel, type a question, and close it without a mouse, with Escape closing it and focus returning to the Ask button?
10. **Zoom and text size:** at 200% browser zoom and the largest system text size, is everything still readable and reachable?
11. **Home Screen app on iPhone:** does the panel work in the installed version, with correct spacing under the status bar and home indicator?

If any answer changes the design, stop and ask before improvising.

## 8. Acceptance criteria

- With the flag on, an Ask button appears on the project home screen in the name row, and with the flag off it does not.
- Tapping it opens the guide in a bottom sheet (phone) or a side panel (desktop). Close, backdrop, and Escape all work.
- A question typed in the panel gets an answer.
- No user or project data is sent to the guide, and the referrer is not sent.
- Loading, failure, and offline states show the messages in section 4.
- On phones the panel is a bottom sheet, and on screens 768 px wide and up it is a side panel. Resizing or rotating while open does not reload the guide or lose the conversation.
- The chat input stays visible when the phone keyboard is open, and the page does not zoom on focus.
- Works with touch, mouse, and keyboard only. Escape closes the panel, and focus returns to the Ask button.
- Works at 200% zoom, with reduced motion turned on, and in the iPhone Home Screen app.
- Works in iPhone Safari, Android Chrome, iPad Safari, and desktop Chrome, Edge, Firefox, and Safari, including inside Procore's frame.
- Nothing else on the home screen changes, including the six cards and the Alerts line.
- `docs/ask-guide-findings.md` records the results of section 7.
