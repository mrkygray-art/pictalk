# Ask the SiteSnap Guide: findings (spec section 7)

Branch `ask-guide`, 2026-10-18. Code: `src/messaging/AskGuide.jsx`, the name row in `MessagingApp.jsx`, styles at the
end of `src/index.css`, flag `VITE_FEATURE_ASK` in `src/features.js`. Automated check: `e2e/e2e-ask.js`.

## Decisions from Ky (2026-10-18, after section 0)

- The Ask button is on the **sign-in screen** (top right, above the title) and the **project home** (right end of
  the name / Sign out row). Not on other screens.
- The guest demo (`/demo`) gets it too.
- The button is a small pill (14 px text, 18 px icon) with a 44 px tap area that doesn't make the row taller.
- Inside Procore's frame, SiteSnap still shows only its "Open SiteSnap AI in a New Tab" launcher (Procore's login
  can't load in a frame), so there is no Ask button there. People use Ask in the tab the launcher opens, which is
  one frame deep, not two.
- `viewport-fit=cover` was not added. Without it the browser keeps pages clear of the notch, status bar and home
  indicator on iPhone (Safari and the Home Screen app) and Android. The panel still adds `env(safe-area-inset-*)`
  padding, so it stays correct if that changes later.

## How it was built

- One component; CSS alone switches the layout, so rotating or resizing never moves or reloads the iframe.
  - Phone (under 768 px wide, or under 501 px tall): bottom sheet, 85% of the visible height (full height in
    landscape), dim backdrop, page locked, Tab wraps inside.
  - 768 px wide and 501 px tall and up: 420 px right-side panel, no backdrop, the page stays usable.
  - A phone on its side (e.g. 932 x 430) stays a full-height sheet, as the spec's table says, even though it's
    wider than 768 px.
- Heights use `dvh`. On phones the sheet follows `visualViewport` (height and offset), so it shrinks to the area
  above the keyboard and doesn't slide off the top.
- The iframe is made on the first open (with a connection) and kept until the page is left, including across
  switching projects. Signing in loads a new page, so a conversation started on the sign-in screen doesn't carry
  over to the home screen.
- Nothing about the person or project is sent: the address is fixed, `referrerpolicy="no-referrer"`, no `allow`,
  `sandbox="allow-scripts allow-same-origin allow-forms"`. Nothing about the guide is stored in SiteSnap.

## Results

Automated: headless Chrome against the Firebase emulators, `/api/procore/*` mocked. "Stand-in" means a small
local page took the guide's place; "live" means the real guide.

| # | Question | Result |
|---|---|---|
| 1 | Panel on a phone, safe-area spacing | **Phone-size Chrome (390 x 844, touch): passes.** 85% sheet, close button 44 px, page locked, Tab kept inside. Real iPhone Safari and Android Chrome: **not tested yet (needs Ky's phone).** |
| 2 | Inside Procore's frame | **Not applicable as built:** the framed view is the launcher only (see decisions). The live guide sends no `X-Frame-Options` or `frame-ancestors`, so it frames from any site. Run against the live guide from localhost: it loaded, with no "Refused to frame" message. |
| 3 | Typing in the guide on iPhone with the keyboard open | **Not tested yet (needs a real iPhone).** The sheet sizes itself from `visualViewport`; the guide's text box is 16 px (not overridden). |
| 4 | Close and reopen keeps the conversation | **Passes** (stand-in): text typed in the guide is still there after X, backdrop, Escape, rotation and resizing; the guide was requested once. |
| 5 | Offline message, recovery | **Passes**: offline shows "The guide needs a connection…" and no iframe is made; back online, the guide loads. If the connection drops after it has loaded, the message covers the guide until it returns, and the conversation is kept. |
| 6 | Phone and desktop layouts, resizing across 768 px | **Passes**: 1280 x 800 shows the 420 px side panel with no backdrop and the cards usable; narrowing to 700 px turns it into the sheet and back, same conversation, one load. |
| 7 | Rotation | **Passes** in Chrome's phone mode (844 x 390): full-height sheet, conversation kept. Real phones: **not tested yet.** |
| 8 | On-screen keyboard, no zoom on tap | **Not tested yet (needs real phones).** |
| 9 | Keyboard only on desktop | **Passes**: Enter on Ask opens it, focus moves to Close, Escape closes, focus returns to Ask. One limit: while the cursor is *inside the guide's own text box*, Escape goes to the guide's page (a different site), which SiteSnap can't hear. Tab out of the guide, or use the X. |
| 10 | 200% zoom, largest text | **Not tested yet.** No fixed heights besides the 44 px buttons; the title wraps. |
| 11 | iPhone Home Screen app | **Not tested yet (needs a real iPhone).** |

Other checks that passed: the Ask button shows on the sign-in screen and home, not on Messages; it sits at the
right end of the name row without making the row taller or reaching the cards; the iframe's address, title,
referrer policy, sandbox and missing `allow` are as specified; no `Referer` header reached the guide; Loading shows
until the frame loads; a guide that takes over 10 s shows "The guide could not load." with Try again and Open in a
new tab (the address without `?embed=1`); the guest demo has Ask. No page errors.

Known limit: a cross-origin frame's `load` event also fires when the frame shows a browser error page, so a refused
or broken guide may show an empty panel rather than "could not load". Today's guide allows framing, so this
doesn't happen now.

## Still to do on real devices (Ky)

iPhone Safari, iPhone Home Screen app, Android Chrome, iPad Safari, desktop Edge / Firefox / Safari: open Ask on the
sign-in screen and home, type a question with the keyboard up, rotate, close and reopen, and turn on airplane mode.
