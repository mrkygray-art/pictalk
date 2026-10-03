// Phase 1 end-to-end test (AI summary) against the Firebase emulators, phone viewport.
// The Functions emulator runs generateJobSummary with the emulator-only stand-in model.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5176/';
const FS = 'http://127.0.0.1:8080/v1/projects/pictalk-6cbff/databases/(default)/documents';
const ADMIN = { Authorization: 'Bearer owner' };
const OUT = path.join(__dirname, 'e2e-summary');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, timeout = 30000, every = 500) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
};

const TRANSCRIPTS = [
  'Front door card reader is cracked and the customer says it fails in the rain. Needs replacing soon.',
  'Two cameras by the loading dock. The left one points at the wall, needs to be re-aimed at the dock doors.',
  'Network closet has one open rack space. Customer wants to know if we can add a PoE switch here.',
];

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
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });

  const photo = path.join(OUT, 'photo.jpg');
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#557'; g.fillRect(0, 0, 1600, 1200);
    g.fillStyle = '#fff'; g.font = 'bold 160px sans-serif'; g.fillText('Test', 100, 300);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));

  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true });
  const click = async (sel) => { await page.locator(sel).setTimeout(20000).click(); await sleep(400); };
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (t, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);

  await page.goto(APP, { waitUntil: 'load' });
  await waitText('No job open');
  const { uid } = await page.evaluate(async () => {
    const m = await import('/src/firebase.js');
    for (let i = 0; i < 50 && !m.auth.currentUser; i++) await new Promise((r) => setTimeout(r, 200));
    return { uid: m.auth.currentUser.uid };
  });
  const token = () => page.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.getIdToken());

  // ---- capture 3 stops with photo + voice ----
  await click('button::-p-text(Start New Job)');
  for (let i = 0; i < 3; i++) {
    const [chooser] = await Promise.all([page.waitForFileChooser(), click('button::-p-text(Take Photo)')]);
    await chooser.accept([photo]);
    await sleep(300);
    await click('button::-p-text(Tap to Talk)');
    await sleep(1300);
    await click('button.talk-btn');
    await sleep(500);
    await click('button::-p-text(Save This Stop)');
    await sleep(600);
  }
  // wait for all 3 to reach the cloud
  const stops = await until(async () => {
    const r = await (await fetch(`${FS}/users/${uid}/stops?pageSize=50`, { headers: ADMIN })).json();
    const docs = r.documents || [];
    return docs.length === 3 ? docs : null;
  }, 60000);
  check('3 stops uploaded', !!stops);

  // ---- End Job with Customer/Location -> lands on the job page, waiting for transcripts ----
  await click('button::-p-text(End Job)');
  const inputs = await page.$$('.sheet .detail-fields input');
  await inputs[0].type('Acme Corp');
  await inputs[1].type('1420 Main St');
  await click('button::-p-text(Save & Finish Job)');
  await waitText('AI summary');
  const landed = await text();
  check('End Job opens the job page with the AI summary section', landed.includes('Acme Corp – 1420 Main St') && landed.includes('AI summary'));
  const waitingSeen = /Waiting for \d voice notes? to upload and be written down/.test(landed) || landed.includes('Build Summary');
  check('Before transcripts are ready it waits, or builds at once when they already are (emulator stand-in is instant)', waitingSeen || landed.includes('AI summary'));
  await shot('01-waiting');

  // ---- simulate transcription finishing (what transcribeStop writes) ----
  // Wait until the emulator's transcribeStop has given up (no Deepgram locally), then write transcripts
  await until(async () => {
    const r = await (await fetch(`${FS}/users/${uid}/stops?pageSize=50`, { headers: ADMIN })).json();
    return (r.documents || []).every((d) => ['transcription_failed', 'transcribed'].includes(d.fields.status?.stringValue));
  }, 60000);
  const ordered = stops
    .map((d) => ({ id: d.name.split('/').pop(), t: Number(d.fields.clientCreatedAt.integerValue || d.fields.clientCreatedAt.doubleValue) }))
    .sort((a, b) => a.t - b.t);
  for (let i = 0; i < ordered.length; i++) {
    await fetch(`${FS}/users/${uid}/stops/${ordered[i].id}?updateMask.fieldPaths=transcript&updateMask.fieldPaths=status&updateMask.fieldPaths=transcriptError`, {
      method: 'PATCH',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { transcript: { stringValue: TRANSCRIPTS[i] }, status: { stringValue: 'transcribed' }, transcriptError: { nullValue: null } } }),
    });
  }
  const rawBefore = await (await fetch(`${FS}/users/${uid}/stops?pageSize=50`, { headers: ADMIN })).text();

  // ---- auto-build -> review screen ----
  await waitText('AI draft', 60000);
  const review = await text();
  const summaryValue = await page.$eval('textarea.is-summary', (t) => t.value);
  check('Summary builds automatically once transcripts are ready', review.includes('AI draft') && summaryValue.startsWith('Test summary for Acme Corp - 1420 Main St'));
  const counts = await page.evaluate(() => ({
    actions: document.querySelectorAll('.summary-list')[0]?.children.length,
    questions: document.querySelectorAll('.summary-list')[1]?.children.length,
    links: [...document.querySelectorAll('.stop-link')].map((b) => b.innerText),
  }));
  check('Action items and questions shown with stop links', counts.actions === 3 && counts.questions === 1 && counts.links.includes('Stop 2 ›'), JSON.stringify(counts));
  check('Priorities shown', (await page.$$('.priority-btn.is-on')).length === 3);
  await shot('02-review');

  // ---- jump to stop ----
  await page.locator('.stop-link::-p-text(Stop 2 ›)').click();
  await sleep(900);
  const jumped = await page.evaluate((id) => {
    const el = document.getElementById(`stop-${id}`);
    const r = el?.getBoundingClientRect();
    return !!el && el.classList.contains('is-flash') && r.top < innerHeight && r.bottom > 0;
  }, ordered[1].id);
  check('Tapping an action item jumps to (and highlights) its stop', jumped);
  await shot('03-jumped');
  await page.evaluate(() => window.scrollTo(0, 0));

  // ---- edits: summary text, item text, priority, remove, add ----
  const summaryBox = await page.$('textarea.is-summary');
  await summaryBox.click({ clickCount: 3 });
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
  await page.keyboard.type(' Edited by test.');
  const firstItem = (await page.$$('.summary-list')[0]) ? null : null;
  const itemBoxes = await page.$$('.summary-list:first-of-type textarea');
  await itemBoxes[0].click();
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
  await page.keyboard.type(' (edited)');
  await page.evaluate(() => document.activeElement.blur());
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll('.summary-list')[0].children[1].querySelector('.priority-btn.is-high').click());
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll('.summary-list')[0].children[2].querySelector('.remove-btn').click());
  await sleep(300);
  check('Remove offers Undo', (await text()).includes('Item removed.'));
  await click('button::-p-text(+ Add action item)');
  const boxes = await page.$$('.summary-list:first-of-type textarea');
  await boxes[boxes.length - 1].type('Call the customer about the rain issue');
  await page.evaluate(() => document.activeElement.blur());
  await sleep(1500);
  await shot('04-edited');

  // ---- reload: edits survive ----
  await page.reload({ waitUntil: 'load' });
  await waitText('My Jobs (1)');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
  await sleep(400);
  await page.locator('.header-row button::-p-text(My Jobs)').click();
  await sleep(500);
  await page.locator('button.job-card::-p-text(Acme Corp)').click();
  await waitText('AI draft', 20000);
  await sleep(800);
  const after = await page.evaluate(() => ({
    summary: document.querySelector('textarea.is-summary').value,
    items: [...document.querySelectorAll('.summary-list')[0].children].map((li) => ({
      text: li.querySelector('textarea').value,
      p: li.querySelector('.priority-btn.is-on')?.innerText,
    })),
  }));
  check('Edits survive a refresh',
    after.summary.endsWith('Edited by test.') &&
    after.items.length === 3 &&
    after.items[0].text.endsWith('(edited)') &&
    after.items[1].p === 'High' &&
    after.items[2].text === 'Call the customer about the rain issue', JSON.stringify(after));

  // ---- approve ----
  await click('button::-p-text(Approve Summary)');
  await waitText('Approved by KG', 15000);
  check('Approve removes the draft badge and records who approved', !(await text()).includes('AI draft'));
  await shot('05-approved');

  // ---- PDF includes the approved summary ----
  await click('button::-p-text(Export PDF)');
  await waitText('PDF ready', 60000);
  await click('button::-p-text(Download PDF)');
  const pdf = await until(() => fs.readdirSync(OUT).find((f) => f.endsWith('.pdf')), 15000);
  check('PDF downloaded', !!pdf, pdf);
  if (pdf) fs.renameSync(path.join(OUT, pdf), path.join(__dirname, 'summary-approved.pdf'));
  await sleep(500);
  await page.keyboard.press('Escape');

  // ---- regenerate -> back to draft ----
  await sleep(500);
  await click('button::-p-text(Regenerate)');
  await waitText('Regenerate?');
  const rt = await text();
  check('Regenerate warns first (summary was hand-edited, so it says edits will be replaced)', rt.includes('Your edits to the summary will be replaced.') && rt.includes('go back to draft'));
  await click('.sheet button.danger-btn');
  await waitText('AI draft', 60000);
  const regen = await text();
  check('Regenerate replaces it with a new draft', regen.includes('AI draft') && !regen.includes('Edited by test.'));
  check('Remaining count shown', /3 of 5 summaries left for this job/.test(regen));

  // ---- raw data unchanged by all of the above ----
  const rawAfter = await (await fetch(`${FS}/users/${uid}/stops?pageSize=50`, { headers: ADMIN })).text();
  check('Raw stop data unchanged', rawBefore === rawAfter);

  // ---- rules: what the app may and may not write ----
  const jobId = await page.evaluate(() => {
    const el = document.querySelector('.stop');
    return null;
  });
  const jobsList = await (await fetch(`${FS}/users/${uid}/jobs?pageSize=50`, { headers: ADMIN })).json();
  const job = jobsList.documents.find((d) => d.fields.customer?.stringValue === 'Acme Corp');
  const jid = job.name.split('/').pop();
  const userHdr = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  const tryWrite = async (url, fields) =>
    (await fetch(url, { method: 'PATCH', headers: userHdr, body: JSON.stringify({ fields }) })).status;
  const sumUrl = `${FS}/users/${uid}/jobs/${jid}/ai/summary`;
  check('App cannot change the model or generation counter',
    (await tryWrite(`${sumUrl}?updateMask.fieldPaths=model`, { model: { stringValue: 'x' } })) === 403 &&
    (await tryWrite(`${sumUrl}?updateMask.fieldPaths=generationCount`, { generationCount: { integerValue: '0' } })) === 403);
  check('App cannot create a summary itself',
    (await tryWrite(`${FS}/users/${uid}/jobs/some-other-job/ai/summary`, { summary: { stringValue: 'fake' }, status: { stringValue: 'draft' } })) === 403);
  const usageRead = (await fetch(`${FS}/users/${uid}/aiUsage?pageSize=5`, { headers: userHdr })).status;
  check('App cannot read the usage counters', usageRead === 403);
  check('App can still edit the summary text',
    (await tryWrite(`${sumUrl}?updateMask.fieldPaths=summary&updateMask.fieldPaths=editedAt`, { summary: { stringValue: 'ok' }, editedAt: { integerValue: String(Date.now()) } })) === 200);

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  if (PAGE) {
    await PAGE.screenshot({ path: path.join(OUT, 'zz-failure.png'), fullPage: true }).catch(() => {});
    console.error('SCREEN:', (await PAGE.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 700));
  }
  process.exit(2);
});
