# Evaluation Lab — offline simulator

`simulate.js` builds the real app (`vite build --mode emulators` into `dist-lab/`, which is
never deployed), serves it, and drives it in headless Chrome at phone size against the local
Firebase emulators. Each scenario in `scenarios.js` cuts the signal at a set moment, for the page
and the service worker, like airplane mode. It then checks that every photo and recording
reached the cloud whole and was written down. Results are shown at `/lab` (`src/lab/LabPage.jsx`).

**Setup (once):** `npm install --no-save puppeteer-core` at the repo root, and
`npm run setup:emulator`. Chrome is launched from
`C:/Program Files/Google/Chrome/Application/chrome.exe` (change `CHROME` in `simulate.js` on
other machines).

**Run:**

```bash
firebase emulators:start --only auth,firestore,storage,functions   # functions/.env.local: PICTALK_FAKE_STT=1
node lab/simulate.js                       # every scenario, 3 runs each
node lab/simulate.js --only drop-live --runs 1 --verbose
node lab/simulate.js --save                # also writes src/lab/results.json for the /lab page
```

Other options: `--no-build` (reuse `dist-lab/`) and `--audio clip.wav` (play a WAV file as the
microphone instead of Chrome's test tone). Raw results, with a timestamped log per run, go to
`lab/out/` (git-ignored). Keep personal voice recordings out of the repo: `lab/clips/*.wav` is
git-ignored.

**How "nothing lost" is checked.** The stand-in transcriber writes
"Test transcript (N bytes of audio)", where N is how much audio the Cloud Function received.
The lab compares N with the stored file's size. It also decodes each stored recording to compare
its length with how long the mic was held, and records how many stops were already in the cloud
when signal returned (it must be 0, which proves the cut was real).

`before-fixes.json` is the first run, on the code before the lab's fixes. It's the evidence for
the fixes log (`src/lab/fixes.js`).
