// PicTalk Evaluation Lab — offline simulator.
// Drives the real production build (with its service worker) in headless Chrome against
// the local Firebase emulators, cuts the signal at set moments, and checks that every
// photo and recording reaches the cloud whole and gets written down.
//
//   node lab/simulate.js                 build, run every scenario 3 times
//   node lab/simulate.js --runs 1 --only drop-live
//   node lab/simulate.js --save          also write src/lab/results.json (the /lab page)
//   node lab/simulate.js --no-build      reuse dist-lab
//   node lab/simulate.js --audio x.wav   play a WAV file as the microphone (default: Chrome's test tone)
//
// Needs: firebase emulators:start --only auth,firestore,storage,functions
// with functions/.env.local setting PICTALK_FAKE_STT=1 (stand-in transcriber, no cost).
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { SCENARIOS } = require('./scenarios');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const DIST = path.join(ROOT, 'dist-lab');
const PORT = 4175;
const BASE = `http://localhost:${PORT}`;
const PROJECT = 'pictalk-6cbff';
const BUCKET = 'pictalk-6cbff.firebasestorage.app';
const FS_URL = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const ST_URL = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`;
const ADMIN = { Authorization: 'Bearer owner' }; // emulator-only admin access
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const RUNS = Number(opt('--runs', 3));
const ONLY = opt('--only', null);
const AUDIO = opt('--audio', null);

// The harness's clock starts at the tap; the phone's recorder starts a moment later
// (opening the mic). A file this much shorter than the time held still counts as whole.
const AUDIO_SLACK_SEC = 1.0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout, every = 250) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(every);
  }
  return null;
}

// ---------- emulator reads (admin) ----------
const fsJson = async (p) => (await fetch(`${FS_URL}/${p}`, { headers: ADMIN })).json();
const val = (f) => {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(val);
  if ('mapValue' in f) return plain(f.mapValue.fields || {});
  if ('timestampValue' in f) return f.timestampValue;
  return undefined;
};
const plain = (fields) => Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, val(v)]));
async function listDocs(p) {
  const r = await fsJson(`${p}?pageSize=300`);
  return (r.documents || []).map((d) => ({ id: d.name.split('/').pop(), ...plain(d.fields) }));
}
async function getDoc(p) {
  const r = await fsJson(p);
  return r.fields ? { id: r.name.split('/').pop(), ...plain(r.fields) } : null;
}
async function listFiles(prefix) {
  const r = await (await fetch(`${ST_URL}?prefix=${encodeURIComponent(prefix)}`, { headers: ADMIN })).json();
  return (r.items || []).map((i) => i.name);
}
async function fileSize(name) {
  const r = await fetch(`${ST_URL}/${encodeURIComponent(name)}`, { headers: ADMIN });
  if (!r.ok) return null;
  return Number((await r.json()).size);
}
async function fileBytes(name) {
  const r = await fetch(`${ST_URL}/${encodeURIComponent(name)}?alt=media`, { headers: ADMIN });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}
// The stand-in transcriber writes "Test transcript (N bytes of audio)." — N is how much
// audio the Cloud Function actually received.
const standInBytes = (t) => Number((String(t || '').match(/\((\d+) bytes of audio\)/) || [])[1] || NaN);

// ---------- one simulated phone ----------
class Phone {
  constructor(browser, ctx, photo) {
    this.browser = browser;
    this.ctx = ctx;
    this.photo = photo;
    this.offline = false;
    this.swSessions = new Map();
    this.pages = [];
    this.log = [];
  }

  note(text) {
    this.log.push(`${new Date().toISOString().slice(11, 23)} ${text}`);
  }

  async open() {
    const page = await this.ctx.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    page.on('pageerror', (e) => this.note(`PAGE ERROR ${e.message}`));
    if (this.offline) await page.setOfflineMode(true);
    this.pages.push(page);
    this.page = page;
    return page;
  }

  /** Airplane mode on/off: the page and the app's service worker both lose the network. */
  async setOffline(on) {
    if (!on && this.uid) {
      // How many stops were already in the cloud the moment signal came back
      this.inCloudAtReconnect = (await listDocs(`users/${this.uid}/stops`)).length;
    }
    this.offline = on;
    for (const p of this.pages) if (!p.isClosed()) await p.setOfflineMode(on);
    for (const t of this.browser.targets()) {
      if (t.type() !== 'service_worker' || t.browserContext() !== this.ctx) continue;
      let s = this.swSessions.get(t);
      if (!s) {
        s = await t.createCDPSession();
        await s.send('Network.enable');
        this.swSessions.set(t, s);
      }
      await s.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    this.note(on ? 'signal OFF' : 'signal ON');
  }

  async waitText(t, timeout = 20000) {
    await this.page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
  }
  async click(sel, timeout = 15000) {
    await this.page.locator(sel).setTimeout(timeout).click();
    await sleep(300);
  }
  button(text) {
    return this.click(`button::-p-text(${text})`);
  }

  /** Load the app and wait for the anonymous sign-in. Returns the user id. */
  async launch() {
    await this.open();
    await this.page.goto(BASE + '/', { waitUntil: 'load' });
    await this.waitText('PicTalk');
    this.uid = await until(() => this.page.evaluate(readUid), 20000);
    if (!this.uid) throw new Error('no sign-in');
    return this.uid;
  }

  /** Wait until the service worker controls the page and has saved the app. */
  async waitForOfflineCopy() {
    await this.page.evaluate(() => navigator.serviceWorker.ready);
    await until(() => this.page.evaluate(() => !!navigator.serviceWorker.controller), 10000);
    await sleep(1500); // let install finish saving files
  }

  async startJob() {
    await this.button('Start New Job');
    await this.waitText('Saving to');
  }

  /**
   * One stop: photo, then talk for `talkMs` (null = photo only). `during(ms)` runs mid-recording.
   * Returns the seconds the harness held the recorder open.
   */
  async stop({ talkMs = 2500, during = null } = {}) {
    const [chooser] = await Promise.all([this.page.waitForFileChooser(), this.button('Take Photo')]);
    await chooser.accept([this.photo]);
    await sleep(300);
    let heldSec = null;
    if (talkMs) {
      await this.button('Tap to Talk');
      const t0 = Date.now();
      if (during) await during(t0); else await sleep(talkMs);
      const left = talkMs - (Date.now() - t0);
      if (left > 0) await sleep(left);
      await this.click('button.talk-btn');
      heldSec = (Date.now() - t0) / 1000;
      await sleep(400);
    }
    await this.button('Save This Stop');
    await sleep(500);
    return heldSec;
  }

  async jobId() {
    const jobs = await listDocs(`users/${this.uid}/jobs`);
    return jobs.find((j) => j.status === 'open')?.id || jobs[0]?.id;
  }

  /** Items still waiting in this phone's IndexedDB queue. */
  waiting() {
    return this.page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('keyval-store');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const tx = req.result.transaction('keyval', 'readonly');
        const keys = tx.objectStore('keyval').getAllKeys();
        keys.onsuccess = () => resolve(keys.result.filter((k) => /^pending-(stop|note):/.test(k)).length);
      };
    }));
  }

  /** Decode a stored recording in the browser and return its length in seconds. */
  async audioSeconds(name) {
    const bytes = await fileBytes(name);
    if (!bytes) return null;
    return this.page.evaluate(async (b64) => {
      const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      const ctx = new OfflineAudioContext(1, 1, 48000);
      try { return (await ctx.decodeAudioData(buf)).duration; } catch { return null; }
    }, bytes.toString('base64'));
  }
}

// Firebase Auth keeps the signed-in user in IndexedDB; read the uid from there.
function readUid() {
  return new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const all = req.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll();
        all.onsuccess = () => resolve(all.result.map((r) => r.value?.uid).find(Boolean) || null);
        all.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}

// ---------- shared checks ----------
/**
 * Every stop captured on the phone reached the cloud whole and was written down.
 * expected: [{ heldSec }] in capture order. Returns { checks, recoveryMs }.
 */
async function waitAndCheckStops(phone, expected, onlineAt, { timeout = 180000, heldOffline = true } = {}) {
  const uid = phone.uid;
  const atReconnect = phone.inCloudAtReconnect;
  const done = await until(async () => {
    const stops = await listDocs(`users/${uid}/stops`);
    const final = stops.filter((s) => ['transcribed', 'no_speech', 'transcription_failed'].includes(s.status) || (!s.audioPath && s.status === 'uploaded'));
    return stops.length >= expected.length && final.length === stops.length ? stops : null;
  }, timeout);
  const recoveryMs = done ? Date.now() - onlineAt : null;
  const stops = done || (await listDocs(`users/${uid}/stops`));
  stops.sort((a, b) => a.clientCreatedAt - b.clientCreatedAt);
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

  if (heldOffline) {
    // Proves the signal cut was real: the stops were stuck on the phone until it returned
    add('Stops waited on the phone until signal returned', atReconnect === 0, `${atReconnect} in the cloud at reconnect`);
  }
  add('Every stop reached the cloud (none lost, none doubled)', stops.length === expected.length, `${stops.length} of ${expected.length}`);
  const voiced = expected.map((e, i) => ({ ...e, stop: stops[i] })).filter((e) => e.heldSec != null);
  add('Every stop has its photo on file', stops.length && (await Promise.all(stops.map((s) => s.photoPath && fileSize(s.photoPath)))).every((n) => n > 0));

  const notWritten = [];
  const short = [];
  let secondsOnFile = 0;
  let secondsHeld = 0;
  for (const e of voiced) {
    const s = e.stop;
    if (!s?.audioPath) { notWritten.push('missing audio'); short.push('missing audio'); continue; }
    const size = await fileSize(s.audioPath);
    const secs = await phone.audioSeconds(s.audioPath);
    secondsOnFile += secs || 0;
    secondsHeld += e.heldSec;
    if (s.status !== 'transcribed') notWritten.push(`status ${s.status}`);
    else if (standInBytes(s.transcript) !== size) notWritten.push(`transcribed ${standInBytes(s.transcript)} of ${size} bytes`);
    if (secs == null || secs < e.heldSec - AUDIO_SLACK_SEC) short.push(`${secs?.toFixed(1)} s on file of ${e.heldSec.toFixed(1)} s`);
  }
  add('Every recording was written down from the whole file', voiced.length && !notWritten.length, notWritten.join('; ') || `${voiced.length} recordings`);
  add('No recording cut short', voiced.length && !short.length,
    short.join('; ') || `${secondsOnFile.toFixed(1)} s on file, ${secondsHeld.toFixed(1)} s recorded`);
  add('Stops kept in the order they were taken', stops.every((s, i) => !i || stops[i - 1].clientCreatedAt <= s.clientCreatedAt));

  const files = [...(await listFiles(`photos/${uid}/`)), ...(await listFiles(`voice/${uid}/`))].filter((f) => !f.includes('/wrapup-'));
  const referenced = new Set(stops.flatMap((s) => [s.photoPath, s.audioPath]).filter(Boolean));
  add('No stray files left behind', files.every((f) => referenced.has(f)), `${files.length} files`);
  add('Nothing left waiting on the phone', (await phone.waiting()) === 0);
  return { checks, recoveryMs, recordings: voiced.length, secondsHeld };
}

// ---------- run ----------
async function main() {
  const scenarios = SCENARIOS.filter((s) => !ONLY || s.id === ONLY);
  if (!scenarios.length) throw new Error(`No scenario "${ONLY}"`);
  fs.mkdirSync(OUT, { recursive: true });

  for (const [name, url] of [['Firestore', 'http://127.0.0.1:8080/'], ['Storage', 'http://127.0.0.1:9199/'], ['Auth', 'http://127.0.0.1:9099/'], ['Functions', 'http://127.0.0.1:5001/']]) {
    try { await fetch(url); } catch { throw new Error(`${name} emulator isn't running. Start: firebase emulators:start --only auth,firestore,storage,functions`); }
  }
  if (!flag('--no-build')) {
    console.log('Building the app (emulator mode) into dist-lab…');
    execSync('npx vite build --mode emulators --outDir dist-lab --emptyOutDir', { cwd: ROOT, stdio: 'ignore' });
  }
  const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', 'dist-lab', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await until(async () => (await fetch(BASE)).ok, 20000);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      ...(AUDIO ? [`--use-file-for-fake-audio-capture=${path.resolve(AUDIO)}`] : [])],
  });
  const chromeVersion = await browser.version();

  // A phone-sized test photo
  const photo = path.join(OUT, 'photo.jpg');
  {
    const p = await browser.newPage();
    const b64 = await p.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1600; c.height = 1200;
      const g = c.getContext('2d');
      g.fillStyle = '#3a4a5c'; g.fillRect(0, 0, 1600, 1200);
      g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.fillText('Lab photo', 120, 300);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    });
    fs.writeFileSync(photo, Buffer.from(b64, 'base64'));
    await p.close();
  }
  const distFiles = listDist();

  const runs = [];
  for (const sc of scenarios) {
    for (let r = 1; r <= RUNS; r++) {
      const ctx = await browser.createBrowserContext(); // fresh phone: new user, empty storage
      const phone = new Phone(browser, ctx, photo);
      const started = Date.now();
      let result;
      try {
        result = await sc.run(phone, { sleep, until, waitAndCheckStops, listDocs, getDoc, listFiles, fileSize, standInBytes, distFiles, BASE });
      } catch (err) {
        result = { checks: [{ name: 'Scenario finished', ok: false, detail: err.message.split('\n')[0] }] };
        try { await phone.page?.screenshot({ path: path.join(OUT, `${sc.id}-${r}-error.png`) }); } catch { /* page gone */ }
      }
      await ctx.close();
      const passed = result.checks.every((c) => c.ok);
      runs.push({ scenario: sc.id, run: r, passed, ms: Date.now() - started, ...result, log: phone.log });
      console.log(`${passed ? 'PASS' : 'FAIL'}  ${sc.id} #${r}${result.recoveryMs != null ? `  back online → written down in ${(result.recoveryMs / 1000).toFixed(1)} s` : ''}`);
      for (const c of result.checks) if (!c.ok || flag('--verbose')) console.log(`      ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
    }
  }
  await browser.close();
  server.kill();

  const report = summarize(scenarios, runs, chromeVersion);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(OUT, `run-${stamp}.json`), JSON.stringify({ ...report, runs }, null, 2));
  if (flag('--save')) {
    fs.writeFileSync(path.join(ROOT, 'src/lab/results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Saved src/lab/results.json');
  }
  const total = runs.filter((r) => r.passed).length;
  console.log(`\n${total} of ${runs.length} runs passed.`);
  process.exitCode = total === runs.length ? 0 : 1;
}

/** Files the built app is made of (what the phone must keep for offline use). */
function listDist() {
  const out = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else out.push('/' + path.relative(DIST, p).split(path.sep).join('/'));
    }
  };
  walk(DIST);
  return out.filter((f) => f !== '/sw.js');
}

const pct = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

function summarize(scenarios, runs, chromeVersion) {
  return {
    ranAt: new Date().toISOString(),
    environment: {
      browser: chromeVersion,
      viewport: '390×844 phone',
      backend: 'Firebase emulators (Auth, Firestore, Storage, Functions)',
      transcriber: 'Stand-in (PICTALK_FAKE_STT): reports how many bytes of audio it received',
      microphone: AUDIO ? path.basename(AUDIO) : "Chrome's built-in test tone",
    },
    scenarios: scenarios.map((sc) => {
      const mine = runs.filter((r) => r.scenario === sc.id);
      const names = [...new Set(mine.flatMap((r) => r.checks.map((c) => c.name)))];
      const rec = mine.map((r) => r.recoveryMs).filter((x) => x != null);
      return {
        id: sc.id,
        title: sc.title,
        what: sc.what,
        proves: sc.proves,
        runs: mine.length,
        passed: mine.filter((r) => r.passed).length,
        recordings: mine.reduce((n, r) => n + (r.recordings || 0), 0),
        recoveryMs: rec.length ? { typical: pct(rec, 0.5), slowest: Math.max(...rec), n: rec.length } : null,
        checks: names.map((name) => {
          const cs = mine.map((r) => r.checks.find((c) => c.name === name)).filter(Boolean);
          const failed = cs.filter((c) => !c.ok);
          return { name, passed: cs.filter((c) => c.ok).length, runs: cs.length, detail: (failed[0] || cs[cs.length - 1])?.detail || '' };
        }),
      };
    }),
  };
}

main().catch((err) => {
  console.error('LAB FAILED:', err.message);
  process.exit(1);
});
