// Wrap-up notes M1 end-to-end test against the emulators (phone viewport).
// Functions emulator uses stand-ins for Deepgram (PICTALK_FAKE_STT) and Claude (PICTALK_FAKE_AI).
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5176/';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-pictalk/databases/(default)/documents';
const ADMIN = { Authorization: 'Bearer owner' };
const OUT = path.join(__dirname, 'e2e-wrapup');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, timeout = 30000, every = 500) => {
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
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('pictalk-initials', 'KG');
    window.__pictalkFailStream = true; // this test covers the after-Done (batch) path; live is tested in e2e-live.js
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    window.__gum = 0;
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; return orig(c); };
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });

  const photo = path.join(OUT, 'p.jpg');
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#468'; g.fillRect(0, 0, 800, 600); return c.toDataURL('image/jpeg').split(',')[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));

  const shot = (n, full = false) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full });
  const click = async (sel) => { await page.locator(sel).setTimeout(20000).click(); await sleep(400); };
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (t, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
  const timerValue = () => page.$eval('.rec-timer', (e) => e.innerText.trim());

  await page.goto(APP, { waitUntil: 'load' });
  await waitText('No job open');
  const uid = await page.evaluate(async () => {
    const m = await import('/src/firebase.js');
    for (let i = 0; i < 50 && !m.auth.currentUser; i++) await new Promise((r) => setTimeout(r, 200));
    return m.auth.currentUser.uid;
  });

  // ---- a job with one photo-only stop (no stop audio) ----
  await click('button::-p-text(Start New Job)');
  const [ch] = await Promise.all([page.waitForFileChooser(), click('button::-p-text(Take Photo)')]);
  await ch.accept([photo]);
  await click('button::-p-text(Save This Stop)');
  await sleep(2500);
  const stopsBefore = await (await fetch(`${FS}/users/${uid}/stops`, { headers: ADMIN })).text();

  await click('button::-p-text(End Job)');
  const fields = await page.$$('.sheet .detail-fields input');
  await fields[0].type('Acme Company');
  await fields[1].type('123 West Ave');
  const sheet1 = await text();
  check('End Job sheet shows Wrap-up notes with both Add buttons',
    sheet1.includes('Wrap-up notes') && sheet1.includes("Optional · while it's fresh") && sheet1.includes('Add field notes') && sheet1.includes('Add customer comments'));
  await shot('01-end-sheet');

  // ---- field notes: record, pause (timer stops), continue, edit, done ----
  await click('button::-p-text(Add field notes)');
  await page.waitForSelector('.recorder');
  check('Field notes opens the recorder without a consent card', !(await text()).includes('Let the customer know'));
  await sleep(2600);
  const sub = await page.$eval('.rec-sub', (e) => e.innerText);
  check('Recorder shows the job name as typed', sub.includes('Acme Company – 123 West Ave'), sub);
  await shot('02-recording');
  await click('button[aria-label="Pause"]');
  const t1 = await timerValue();
  await sleep(2200);
  const t2 = await timerValue();
  check('Pause stops the timer', t1 === t2 && t1 !== '0:00', `${t1} -> ${t2}`);
  await click('button[aria-label="Continue"]');
  await sleep(2200);
  const t3 = await timerValue();
  check('Continue resumes the timer', t3 > t2, `${t2} -> ${t3}`);
  await click('button[aria-label="Edit"]');
  await page.waitForSelector('.rec-editor');
  const pill = await page.$eval('.rec-pill', (e) => e.innerText);
  check('Edit pauses and shows "Paused · editing"', pill === 'Paused · editing', pill);
  await page.type('.rec-editor', 'Panel has water damage.');
  await shot('03-editing');
  await click('button::-p-text(Done – attach to job)');
  await page.waitForSelector('#wrapup-field');
  await shot('04-field-attached');

  // transcript arrives and is appended after the typed text (edited text never overwritten)
  const fieldDone = await until(async () => {
    const d = await fsGet(`users/${uid}/jobs/${await jobIdOf()}/wrapUpNotes/field`);
    return d.fields?.text?.stringValue?.includes('Test transcript') ? d : null;
  }, 40000);
  async function jobIdOf() {
    const r = await fsGet(`users/${uid}/jobs`);
    return (r.documents || []).map((d) => d.name.split('/').pop()).find(Boolean);
  }
  const fieldText = fieldDone?.fields.text.stringValue || '';
  check('Typed text kept; recording transcript appended after it',
    fieldText.startsWith('Panel has water damage.') && fieldText.includes('Test transcript') && fieldDone.fields.edited?.booleanValue === true, JSON.stringify(fieldText));
  const segs1 = fieldDone?.fields.segments?.arrayValue?.values || [];
  const durStored = Number(fieldDone?.fields.durationSec?.integerValue || fieldDone?.fields.durationSec?.doubleValue);
  check('One audio piece stored; duration excludes paused time', segs1.length === 1 && durStored >= 3 && durStored <= 6, `pieces ${segs1.length}, ${durStored}s`);

  // ---- customer comments: consent card first; mic not started until Start recording ----
  const gumBefore = await page.evaluate(() => window.__gum);
  await click('button::-p-text(Add customer comments)');
  await waitText('Let the customer know this will be recorded and transcribed.');
  await sleep(800);
  check('Consent card shown and mic not started yet', (await page.evaluate(() => window.__gum)) === gumBefore);
  await shot('05-consent');
  await click('button::-p-text(Start recording)');
  await sleep(2400);
  check('Mic starts after Start recording', (await page.evaluate(() => window.__gum)) === gumBefore + 1);
  await click('button[aria-label="Done"]');
  await page.waitForSelector('#wrapup-customer');
  const jobId = await jobIdOf();
  const custDone = await until(async () => {
    const d = await fsGet(`users/${uid}/jobs/${jobId}/wrapUpNotes/customer`);
    return d.fields?.text?.stringValue ? d : null;
  }, 40000);
  check('Customer comments transcribed and consent recorded',
    !!custDone && custDone.fields.consentShown?.booleanValue === true && custDone.fields.edited?.booleanValue === false);
  await waitText('Customer comments ·', 10000);
  await sleep(800);
  const sheet2 = await text();
  check('Cards show duration, preview, Review / edit, Play audio, delete',
    /Field notes · \d:\d\d/.test(sheet2) && /Customer comments · \d:\d\d/.test(sheet2) &&
    sheet2.includes('Panel has water damage.') && (sheet2.match(/Review \/ edit/g) || []).length === 2 &&
    (sheet2.match(/Play audio/g) || []).length === 2 && (await page.$$('.note-btn.is-icon')).length === 2);
  check('Helper text mentions the job summary', sheet2.includes('Wrap-up notes go into the job summary.'));
  await shot('06-both-attached');

  // ---- discard: start a re-record on field notes via Review/edit + Continue, then discard ----
  await page.evaluate(() => document.querySelector('#wrapup-field .note-btn').click());
  await page.waitForSelector('.rec-editor');
  await click('button::-p-text(Continue recording)');
  await sleep(1500);
  await click('.rec-discard');
  await waitText('Discard these notes?');
  await shot('07-discard-confirm');
  await click('.rec-confirm-card button.danger-btn');
  await sleep(1500);
  const afterDiscard = await fsGet(`users/${uid}/jobs/${jobId}/wrapUpNotes/field`);
  check('Discard drops the new recording (note unchanged)', (afterDiscard.fields.segments?.arrayValue?.values || []).length === 1);

  // ---- finish: lands on job page, summary built from notes even with no stop audio ----
  await click('button::-p-text(Save & Finish Job)');
  await waitText('AI draft', 60000);
  await sleep(800);
  const review = await text();
  const summaryValue = await page.$eval('textarea.is-summary', (t) => t.value);
  check('Notes-only job gets a summary that uses both notes', summaryValue.includes('plus 2 wrap-up notes'), summaryValue);
  check('Items cite the notes ("Field notes ›")', review.includes('Field notes ›') && review.includes('Customer comments ›'));
  check('Job page also shows the wrap-up notes', !!(await page.$('#wrapup-field')) && !!(await page.$('#wrapup-customer')));
  await page.locator('.stop-link::-p-text(Field notes ›)').click();
  await sleep(900);
  const jumped = await page.evaluate(() => {
    const el = document.getElementById('wrapup-field');
    const r = el.getBoundingClientRect();
    return el.classList.contains('is-flash') && r.top < innerHeight && r.bottom > 0;
  });
  check('Tapping "Field notes ›" jumps to the note', jumped);
  await page.evaluate(() => window.scrollTo(0, 0));

  // ---- approve, PDF has wrap-up notes and the new footer ----
  await click('button::-p-text(Approve Summary)');
  await waitText('Approved by KG', 15000);
  await click('button::-p-text(Export PDF)');
  await waitText('PDF ready', 60000);
  await click('button::-p-text(Download PDF)');
  const pdf = await until(() => fs.readdirSync(OUT).find((f) => f.endsWith('.pdf')), 15000);
  check('PDF downloaded', !!pdf, pdf);
  if (pdf) fs.copyFileSync(path.join(OUT, pdf), path.join(__dirname, 'wrapup.pdf'));
  await page.keyboard.press('Escape');
  await sleep(600);

  // ---- edit a note after approval -> out of date -> regenerate returns to draft ----
  await page.evaluate(() => document.querySelector('#wrapup-customer .note-btn').click());
  await page.waitForSelector('.rec-editor');
  await page.$eval('.rec-editor', (t) => t.focus());
  await page.keyboard.press('End');
  await page.keyboard.type(' Customer also wants a camera at the gate.');
  await click('button::-p-text(Done – attach to job)');
  await waitText('Wrap-up notes changed since this summary was written.', 20000);
  check('Editing a note after approval flags the summary as out of date', true);
  await shot('08-out-of-date');
  await page.locator('.summary-stale button').click();
  await waitText('Regenerate the summary?', 10000);
  const confirmText = await text();
  check('Regenerate warns it goes back to draft', confirmText.includes('go back to draft'));
  await click('.sheet button.danger-btn');
  await waitText('AI draft', 60000);
  await sleep(1000);
  check('Regenerating returns the summary to Draft and clears the banner',
    !(await text()).includes('Wrap-up notes changed since this summary was written.'));

  // ---- continue an existing note: appends, no duplicate ----
  await page.evaluate(() => document.querySelector('#wrapup-field .note-btn').click());
  await page.waitForSelector('.rec-editor');
  await click('button::-p-text(Continue recording)');
  await sleep(2200);
  await click('button[aria-label="Done"]');
  const twoPieces = await until(async () => {
    const d = await fsGet(`users/${uid}/jobs/${jobId}/wrapUpNotes/field`);
    const v = d.fields?.segments?.arrayValue?.values || [];
    return v.length === 2 && v.every((x) => x.mapValue.fields.status.stringValue === 'transcribed') ? d : null;
  }, 40000);
  const notesList = await fsGet(`users/${uid}/jobs/${jobId}/wrapUpNotes`);
  check('Re-opening appends a second piece to the same note (no duplicate)',
    !!twoPieces && (notesList.documents || []).length === 2 &&
    (twoPieces.fields.text.stringValue.match(/Test transcript/g) || []).length === 2);

  // ---- hand-edited summary: regenerate asks the specific question ----
  await waitText('Wrap-up notes changed since this summary was written.', 20000);
  await page.$eval('textarea.is-summary', (t) => t.focus());
  await page.keyboard.press('End');
  await page.keyboard.type(' Hand edit.');
  await page.evaluate(() => document.activeElement.blur());
  await sleep(800);
  await page.locator('.summary-stale button').click();
  await waitText('Regenerate?', 10000);
  check('Hand-edited summary: "Your edits to the summary will be replaced."', (await text()).includes('Your edits to the summary will be replaced.'));
  await click('.sheet button.plain-btn');

  // ---- delete a note ----
  await page.evaluate(() => document.querySelector('#wrapup-customer .note-btn.is-icon').click());
  await waitText('Delete these notes?');
  await page.evaluate(() => [...document.querySelectorAll('#wrapup-customer .note-btn')].find((b) => b.innerText === 'Delete').click());
  const gone = await until(async () => (await fetch(`${FS}/users/${uid}/jobs/${jobId}/wrapUpNotes/customer`, { headers: ADMIN })).status === 404, 15000);
  await sleep(800);
  check('Delete removes the note; Add button returns', !!gone && (await text()).includes('Add customer comments'));

  // ---- raw stop data untouched ----
  const stopsAfter = await (await fetch(`${FS}/users/${uid}/stops`, { headers: ADMIN })).text();
  check('Raw stop data unchanged', stopsBefore === stopsAfter);

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  if (PAGE) {
    await PAGE.screenshot({ path: path.join(OUT, 'zz-failure.png') }).catch(() => {});
    console.error('SCREEN:', (await PAGE.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 900));
  }
  process.exit(2);
});
