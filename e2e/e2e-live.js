// Wrap-up notes M2 (live transcription) test against the emulators, phone viewport.
// The token function returns the emulator stand-in, so the app plays a pretend live stream:
//   "Panel door is loose." "and the hinge is rusted." [paragraph] "Customer wants it replaced this month."
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5176/';
const FS = 'http://127.0.0.1:8080/v1/projects/pictalk-6cbff/databases/(default)/documents';
const ADMIN = { Authorization: 'Bearer owner' };
const OUT = path.join(__dirname, 'e2e-live');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, timeout = 30000, every = 400) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  return null;
};
const fsGet = async (p) => (await fetch(`${FS}/${p}`, { headers: ADMIN })).json();

let PAGE;
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();
  PAGE = page;
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('pictalk-initials', 'KG'));

  const click = async (sel) => { await page.locator(sel).setTimeout(20000).click(); await sleep(300); };
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
  const pill = () => page.$eval('.rec-pill', (e) => e.innerText).catch(() => '');
  const finalText = () => page.$eval('.rec-transcript', (e) => {
    const p = e.querySelector('.rec-final');
    if (!p) return { white: '', gray: '' };
    const gray = p.querySelector('.rec-interim')?.innerText || '';
    return { white: p.innerText.replace(gray, '').trim(), gray: gray.trim() };
  }).catch(() => ({ white: '', gray: '' }));

  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.innerText.includes('No job open'));
  const uid = await page.evaluate(async () => {
    const m = await import('/src/firebase.js');
    for (let i = 0; i < 50 && !m.auth.currentUser; i++) await new Promise((r) => setTimeout(r, 200));
    return m.auth.currentUser.uid;
  });
  const jobId = async () => ((await fsGet(`users/${uid}/jobs`)).documents || [])[0]?.name.split('/').pop();
  const tokenCount = async () => {
    const r = await fsGet(`users/${uid}/streamUsage`);
    return (r.documents || []).reduce((n, d) => n + Number(d.fields.count.integerValue), 0);
  };

  await click('button::-p-text(Start New Job)');
  await sleep(500);
  await click('button::-p-text(End Job)');

  // ---- 1. live words while recording ----
  await click('button::-p-text(Add field notes)');
  const sawGray = await until(async () => (await finalText()).gray, 6000, 100);
  check('Gray in-progress words appear while speaking', !!sawGray, sawGray);
  check('Pill shows "Live · listening"', (await pill()) === 'Live · listening');
  check('Blinking caret shown while live', !!(await page.$('.rec-caret')));
  const firstWhite = await until(async () => (await finalText()).white.includes('Panel door is loose.') && (await finalText()).white, 6000, 100);
  check('Finished words turn white', !!firstWhite, firstWhite);
  await shot('01-live');

  // ---- 2. pause closes the stream; continue opens a new one and appends ----
  await click('button[aria-label="Pause"]');
  const afterPause = await finalText();
  check('Pause: pill "Paused", gray words cleared', (await pill()) === 'Paused' && !afterPause.gray);
  const tokensAfterFirst = await tokenCount();
  await sleep(1500);
  check('No new words while paused', (await finalText()).white === afterPause.white);
  await click('button[aria-label="Continue"]');
  await until(async () => (await pill()) === 'Live · listening', 6000, 100);
  const tokensAfterContinue = await tokenCount();
  check('Continue gets a new token and reconnects', tokensAfterContinue === tokensAfterFirst + 1, `${tokensAfterFirst} -> ${tokensAfterContinue}`);
  const appended = await until(async () => {
    const w = (await finalText()).white;
    return w.startsWith(afterPause.white) && w.length > afterPause.white.length ? w : null;
  }, 8000, 150);
  check('New words are added after the existing ones', !!appended, appended);
  await until(async () => (await finalText()).white.includes('this month.'), 8000, 150);
  const withPara = await page.$eval('.rec-final', (p) => p.firstChild.textContent);
  check('A pause in speech starts a new paragraph', /\n\n/.test(withPara));
  await shot('02-appended');

  // ---- 3. done: live words saved as the transcript, no second (batch) transcription ----
  const shown = (await finalText()).white;
  await click('button[aria-label="Done"]');
  const j = await until(jobId, 10000);
  const note = await until(async () => {
    const d = await fsGet(`users/${uid}/jobs/${j}/wrapUpNotes/field`);
    const seg = d.fields?.segments?.arrayValue?.values?.[0]?.mapValue.fields;
    return seg && seg.status.stringValue === 'transcribed' ? d : null;
  }, 30000);
  const seg = note?.fields.segments.arrayValue.values[0].mapValue.fields;
  const saved = note?.fields.text.stringValue || '';
  check('Saved text matches the live words', saved.replace(/\s+/g, ' ').trim() === shown.replace(/\s+/g, ' ').trim(), JSON.stringify(saved));
  check('Piece marked live; batch transcription skipped',
    seg?.source.stringValue === 'live' && note.fields.transcriptSource.stringValue === 'live' && !saved.includes('Test transcript'));
  check('liveTranscript stored on the note', (note?.fields.liveTranscript?.stringValue || '').includes('Panel door is loose.'));

  // ---- 4. live unavailable: recording continues offline; words written after Done ----
  await page.evaluate(() => { window.__pictalkFailStream = true; });
  await click('button::-p-text(Add customer comments)');
  await click('button::-p-text(Start recording)');
  await until(async () => (await pill()) === 'Recording · offline', 6000, 100);
  check('Stream unavailable: pill "Recording · offline", recording continues', (await pill()) === 'Recording · offline');
  await shot('03-offline');
  await sleep(2200);
  await click('button[aria-label="Done"]');
  const cust = await until(async () => {
    const d = await fsGet(`users/${uid}/jobs/${j}/wrapUpNotes/customer`);
    return d.fields?.text?.stringValue ? d : null;
  }, 30000);
  const cseg = cust?.fields.segments.arrayValue.values[0].mapValue.fields;
  check('Batch fallback writes the words after Done',
    (cust?.fields.text.stringValue || '').includes('Test transcript') && cseg?.source.stringValue === 'batch');
  await page.evaluate(() => { window.__pictalkFailStream = false; });

  // ---- 5. type during a live session, keep talking: no duplicated words ----
  const before = ((await fsGet(`users/${uid}/jobs/${j}/wrapUpNotes/field`)).fields.text.stringValue.match(/Panel door is loose\./g) || []).length;
  await page.evaluate(() => document.querySelector('#wrapup-field .note-btn').click());
  await page.waitForSelector('.rec-editor');
  await page.$eval('.rec-editor', (t) => t.focus());
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
  await page.keyboard.type(' Also check the latch.');
  await click('button::-p-text(Continue recording)');
  await until(async () => (await finalText()).white.includes('Customer wants it replaced this month.') &&
    ((await finalText()).white.match(/Panel door is loose\./g) || []).length === before + 1, 12000, 150);
  await click('button[aria-label="Done"]');
  const edited = await until(async () => {
    const d = await fsGet(`users/${uid}/jobs/${j}/wrapUpNotes/field`);
    const v = d.fields?.segments?.arrayValue?.values || [];
    return v.length === 2 && v.every((x) => x.mapValue.fields.status.stringValue === 'transcribed') ? d : null;
  }, 30000);
  const et = edited?.fields.text.stringValue || '';
  check('Typed text kept, new live words after it, nothing doubled',
    et.includes('Also check the latch.') && (et.match(/Panel door is loose\./g) || []).length === before + 1 &&
    et.indexOf('Also check the latch.') < et.lastIndexOf('Panel door is loose.') && edited.fields.edited.booleanValue === true,
    JSON.stringify(et));

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  if (PAGE) {
    await PAGE.screenshot({ path: path.join(OUT, 'zz-failure.png') }).catch(() => {});
    console.error('SCREEN:', (await PAGE.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 700));
  }
  process.exit(2);
});
