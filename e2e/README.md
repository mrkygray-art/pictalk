# Browser test scripts

Automated checks written while building PicTalk. Each script drives headless Chrome with
[puppeteer-core](https://pptr.dev) and prints PASS/FAIL (or ok/FAIL) lines. They are not part of
the app and are never published.

**Setup (once):** `npm install --no-save puppeteer-core` in this folder. The scripts launch
Chrome from `C:/Program Files/Google/Chrome/Application/chrome.exe`; change that path on
other machines.

**Running:** `node <script>.js`. Most expect the Firebase emulators (`firebase emulators:start --only auth,firestore,storage,functions`, with `functions/.env.local` setting `PICTALK_FAKE_AI=1` and `PICTALK_FAKE_STT=1`) and the dev server (`VITE_USE_EMULATORS=true npx vite --port 5176`). `e2e-eng.js` is the Engineering Mode test (21 checks); `pt-portfolio-shots.js` made the portfolio screenshots and reads its photos from a sibling `pt-shots/` folder.

Scripts with "live" in the name talk to the deployed site (and may create real data or use paid
services); the rest use a local server or emulator. Screenshot scripts write PNGs next to
themselves.
