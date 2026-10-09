// Edit words end-to-end test against the emulators (phone viewport).
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = 'http://localhost:5176/';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-pictalk/databases/(default)/documents';
const ADMIN = { Authorization: 'Bearer owner' };
const OUT = path.join(__dirname, 'e2e-words');
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
const fsJson = async (p) => (await fetch(`${FS}/${p}`, { headers: ADMIN })).json();
const ORIGINAL = ['Two cameras on the north wall need new mounts.', 'The IDF closet is locked, ask for a key.'];
const CORRECTED = 'Three cameras on the north wall need new Verkada mounts.';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('pictalk-initials', 'KG');
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });

  const photo = path.join(OUT, 'p.jpg');
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#468'; g.fillRect(0, 0, 800, 600); return c.toDataURL('image/jpeg').split(',')[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));

  const shot = (n, full = true) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full });
  const click = async (sel) => { await page.locator(sel).setTimeout(20000).click(); await sleep(400); };
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (t, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
  // Click "Edit words" on the card for Stop n
  const editStop = async (n) => {
    await page.evaluate((n) => {
      const card = [...document.querySelectorAll('.stop')].find((c) => c.querySelector('strong')?.innerText === `Stop ${n}`);
      [...card.querySelectorAll('button')].find((b) => b.innerText === 'Edit words').click();
    }, n);
    await page.waitForSelector('.sheet textarea.words-field');
    await sleep(300);
  };
  const typeWords = async (words) => {
    await page.$eval('.sheet textarea.words-field', (t) => { t.select(); });
    await page.keyboard.press('Backspace');
    await page.type('.sheet textarea.words-field', words);
  };

  await page.goto(APP, { waitUntil: 'load' });
  await waitText('No job open');
  const uid = await page.evaluate(async () => {
    const m = await import('/src/firebase.js');
    for (let i = 0; i < 50 && !m.auth.currentUser; i++) await new Promise((r) => setTimeout(r, 200));
    return m.auth.currentUser.uid;
  });
  const token = () => page.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.getIdToken());

  // ---- two stops with voice ----
  await click('button::-p-text(Start New Job)');
  for (let i = 0; i < 2; i++) {
    const [ch] = await Promise.all([page.waitForFileChooser(), click('button::-p-text(Take Photo)')]);
    await ch.accept([photo]);
    await sleep(300);
    await click('button::-p-text(Tap to Talk)');
    await sleep(1300);
    await click('button.talk-btn');
    await sleep(500);
    await click('button::-p-text(Save This Stop)');
    await sleep(600);
  }
  const stops = await until(async () => {
    const docs = (await fsJson(`users/${uid}/stops?pageSize=50`)).documents || [];
    return docs.length === 2 && docs.every((d) => ['transcription_failed', 'transcribed', 'no_speech'].includes(d.fields.status?.stringValue)) ? docs : null;
  }, 60000);
  check('2 stops uploaded and processed', !!stops);
  const ordered = stops
    .map((d) => ({ id: d.name.split('/').pop(), t: Number(d.fields.clientCreatedAt.integerValue || d.fields.clientCreatedAt.doubleValue) }))
    .sort((a, b) => a.t - b.t);
  for (let i = 0; i < 2; i++) {
    await fetch(`${FS}/users/${uid}/stops/${ordered[i].id}?updateMask.fieldPaths=transcript&updateMask.fieldPaths=status&updateMask.fieldPaths=transcriptError`, {
      method: 'PATCH',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { transcript: { stringValue: ORIGINAL[i] }, status: { stringValue: 'transcribed' }, transcriptError: { nullValue: null } } }),
    });
  }
  await waitText(ORIGINAL[0]);
  const editButtons = await page.$$eval('.stop button', (bs) => bs.filter((b) => b.innerText === 'Edit words').length);
  check('Each stop with words has an Edit words button', editButtons === 2, `${editButtons}`);
  await shot('01-cards');

  // ---- edit stop 1 on the camera screen ----
  await editStop(1);
  const prefill = await page.$eval('.sheet textarea.words-field', (t) => t.value);
  check('Text box starts with the current words', prefill === ORIGINAL[0]);
  await shot('02-sheet', false);

  // Cancel changes nothing
  await typeWords('throw this away');
  await click('.sheet button::-p-text(Cancel)');
  check('Cancel keeps the old words', (await text()).includes(ORIGINAL[0]) && !(await text()).includes('throw this away'));

  await editStop(1);
  await typeWords(CORRECTED);
  await click('.sheet button::-p-text(Save)');
  await waitText(CORRECTED);
  const afterSave = await text();
  check('Card shows the corrected words, old words gone', !afterSave.includes(ORIGINAL[0]));
  check('No "edited" label on the card', !/edited/i.test(await page.$eval('.stop', (e) => e.innerText)));
  const doc1 = await until(async () => { const d = await fsJson(`users/${uid}/stops/${ordered[0].id}`); return d.fields.editedTranscript?.stringValue ? d : null; });
  check('Original transcript kept untouched in the database', doc1?.fields.transcript.stringValue === ORIGINAL[0]);
  check('Correction saved alongside it', doc1?.fields.editedTranscript.stringValue === CORRECTED && !!doc1.fields.transcriptEditedAt);
  await shot('03-saved');

  // ---- End Job -> summary uses the corrected words ----
  await click('button::-p-text(End Job)');
  const inputs = await page.$$('.sheet .detail-fields input');
  await inputs[0].type('Acme Corp');
  await inputs[1].type('1420 Main St');
  await click('button::-p-text(Save & Finish Job)');
  await waitText('AI draft', 60000);
  const items = await page.$$eval('.summary-list .item-text', (ts) => ts.map((t) => t.innerText).join(' | '));
  check('Summary uses the corrected words', items.includes('Three cameras on the north wall') && !items.includes('Two cameras'), items.slice(0, 160));
  check('Summary screen has no Open questions section', !(await text()).includes('Open questions') && !(await text()).includes('Add question'));
  check('Summary not marked out of date right after it was built', !(await text()).includes('changed since this summary'));
  const sum = await fsJson(`users/${uid}/jobs/${(await fsJson(`users/${uid}/jobs?pageSize=50`)).documents.find((d) => d.fields.customer?.stringValue === 'Acme Corp').name.split('/').pop()}/ai/summary`);
  check('Summary remembers which words it used', !!sum.fields.stopsUsed?.mapValue.fields[ordered[0].id]);

  // ---- summary shown as text with Edit buttons ----
  const sumPath = `users/${uid}/jobs/${(await fsJson(`users/${uid}/jobs?pageSize=50`)).documents.find((d) => d.fields.customer?.stringValue === 'Acme Corp').name.split('/').pop()}/ai/summary`;
  check('Summary is plain text, not an open text box', (await page.$$('.summary-card textarea')).length === 0 && !!(await page.$('.summary-card .summary-text')));
  check('Edit summary button shown', (await text()).includes('Edit summary'));
  check('Regenerate is a small link, not a big button', await page.$eval('.regen-link', (b) => b.innerText === 'Regenerate summary' && !b.classList.contains('big-btn')));
  await shot('10-summary-view');

  await click('button::-p-text(Edit summary)');
  check('Edit summary opens a sheet with the current text', (await page.$eval('.sheet textarea', (t) => t.value)).startsWith('Test summary for'));
  await page.$eval('.sheet textarea', (t) => t.select());
  await page.keyboard.press('Backspace');
  await page.type('.sheet textarea', 'Checked the north wall cameras and the IDF closet.');
  await shot('11-summary-sheet', false);
  await click('.sheet button::-p-text(Save)');
  await waitText('Checked the north wall cameras and the IDF closet.');
  const sd1 = await until(async () => { const d = await fsJson(sumPath); return d.fields.summary?.stringValue === 'Checked the north wall cameras and the IDF closet.' ? d : null; });
  check('Summary edit saved', !!sd1 && !!sd1.fields.editedAt);

  // edit an action item: text + priority
  await page.evaluate(() => document.querySelector('.summary-list .item-edit').click());
  await page.waitForSelector('.sheet textarea');
  await sleep(300);
  await page.evaluate(() => document.querySelector('.sheet .priority-btn.is-high').click());
  await page.$eval('.sheet textarea', (t) => t.select());
  await page.keyboard.press('Backspace');
  await page.type('.sheet textarea', 'Replace the three north wall camera mounts');
  await shot('12-item-sheet', false);
  await click('.sheet button::-p-text(Save)');
  await waitText('Replace the three north wall camera mounts');
  const first = await page.$eval('.summary-list .item-text', (e) => e.innerText);
  check('Action item edit shows with its new priority', first.startsWith('High') && first.includes('Replace the three north wall camera mounts'), first);

  // add, then remove with undo
  const count = () => page.$$eval('.summary-list .summary-item', (l) => l.length);
  const n0 = await count();
  await click('button::-p-text(+ Add action item)');
  await page.type('.sheet textarea', 'Get the IDF key from Maria');
  await click('.sheet button::-p-text(Save)');
  await waitText('Get the IDF key from Maria');
  check('Add action item works', (await count()) === n0 + 1);
  await page.evaluate(() => [...document.querySelectorAll('.summary-list .item-edit')].pop().click());
  await page.waitForSelector('.sheet');
  await sleep(300);
  await click('.sheet button::-p-text(Remove This Item)');
  check('Remove works and offers Undo', (await count()) === n0 && (await text()).includes('Item removed.'));
  await click('button::-p-text(Undo)');
  check('Undo puts it back', (await count()) === n0 + 1);

  // approve; Cancel keeps it approved, a saved edit returns it to draft
  await click('button::-p-text(Approve Summary)');
  await waitText('Approved by KG', 15000);
  await click('button::-p-text(Edit summary)');
  await click('.sheet button::-p-text(Cancel)');
  await sleep(500);
  check('Cancel leaves an approved summary approved', (await text()).includes('Approved by KG'));
  await click('button::-p-text(Edit summary)');
  await page.type('.sheet textarea', ' More detail.');
  await click('.sheet button::-p-text(Save)');
  await waitText('AI draft', 15000);
  check('Saving an edit puts an approved summary back to draft', !(await text()).includes('Approved by KG'));
  await shot('13-summary-after');

  // ---- edit stop 2 on the job page -> out of date ----
  await editStop(2);
  await typeWords('The IDF closet is locked, ask Maria for the key.');
  await click('.sheet button::-p-text(Save)');
  await waitText('changed since this summary', 15000);
  check('Editing a stop after the summary shows the out-of-date banner', (await text()).includes('Regenerate'));
  await shot('04-outofdate');

  // Putting the words back to the original clears the correction and the banner
  await editStop(2);
  await typeWords(ORIGINAL[1]);
  await click('.sheet button::-p-text(Save)');
  const cleared = await until(async () => {
    const d = await fsJson(`users/${uid}/stops/${ordered[1].id}`);
    return 'nullValue' in (d.fields.editedTranscript || {}) ? d : null;
  }, 15000);
  check('Saving the original words again clears the correction', !!cleared);
  await sleep(1000);
  check('...and the out-of-date banner goes away', !(await text()).includes('changed since this summary'));

  // ---- PDF shows only the final words ----
  await click('button::-p-text(Export PDF)');
  await waitText('PDF ready', 60000);
  await click('button::-p-text(Download PDF)');
  const pdf = await until(() => fs.readdirSync(OUT).find((f) => f.endsWith('.pdf')), 15000);
  check('PDF downloaded', !!pdf);
  if (pdf) {
    const pdfPath = path.join(OUT, pdf);
    let all = '';
    const n = 3;
    for (let p = 1; p <= n; p++) {
      try { all += execFileSync('node', [path.join(__dirname, 'pdfall.mjs'), pdfPath], { cwd: __dirname }).toString(); break; } catch (e) { console.log(e.message); }
    }
    const flat = all.replace(/\s+/g, ' ');
    check('PDF has the corrected words', flat.includes('Three cameras on the north wall need new Verkada mounts.'));
    check('PDF does not have the original wrong words', !flat.includes('Two cameras on the north wall'));
    check('PDF has no Open questions section', !flat.includes('Open questions'));
    check('PDF has no "edited" label', !/edited/i.test(flat));
    fs.copyFileSync(pdfPath, path.join(__dirname, 'words.pdf'));
  }
  await page.keyboard.press('Escape');

  // ---- rules ----
  const userHdr = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  const tryWrite = async (fields) =>
    (await fetch(`${FS}/users/${uid}/stops/${ordered[0].id}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, { method: 'PATCH', headers: userHdr, body: JSON.stringify({ fields }) })).status;
  check('Rules: a correction over 5000 characters is refused', (await tryWrite({ editedTranscript: { stringValue: 'x'.repeat(5001) } })) === 403);
  check('Rules: a correction must be text', (await tryWrite({ editedTranscript: { integerValue: '5' } })) === 403);
  check('Rules: a normal correction is allowed', (await tryWrite({ editedTranscript: { stringValue: CORRECTED } })) === 200);

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
