// PicTalk Engineering Mode end-to-end test against the emulators (phone viewport).
// Functions emulator uses stand-ins for Deepgram (PICTALK_FAKE_STT) and Claude (PICTALK_FAKE_AI).
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5176/';
const FS = 'http://127.0.0.1:8080/v1/projects/pictalk-6cbff/databases/(default)/documents';
const ADMIN = { Authorization: 'Bearer owner' };
const OUT = path.join(__dirname, 'e2e-eng');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('pictalk-initials', 'KG'));

  const photo = path.join(OUT, 'p.jpg');
  await page.goto(APP, { waitUntil: 'load' });
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#468'; g.fillRect(0, 0, 800, 600); return c.toDataURL('image/jpeg').split(',')[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));
  const shot = (n, full = true) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full });
  const click = async (sel) => { await page.locator(sel).setTimeout(20000).click(); await sleep(400); };
  const waitText = (t, timeout = 40000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
  const body = () => page.evaluate(() => document.body.innerText);

  await waitText('No job open');
  check('Off by default: no Engineering panel', !(await page.$('.eng-panel')));
  check('Toggle link is shown', /Engineering Mode/.test(await body()));
  await click('button.eng-toggle');
  check('Engineering panel opens', !!(await page.$('.eng-panel')));
  check('Pipeline steps shown', (await page.$$('.eng-pipe li')).length === 7);
  check('Sync shows signed in', /Yes \(anonymous account\)/.test(await page.$eval('.eng-panel', (n) => n.innerText)));

  // ---- one stop with photo + voice ----
  await click('button::-p-text(Start New Job)');
  const [ch] = await Promise.all([page.waitForFileChooser(), click('button::-p-text(Take Photo)')]);
  await ch.accept([photo]);
  await click('button::-p-text(Tap to Talk)');
  await sleep(2500);
  await click('button.talk-btn');
  await sleep(500);
  await click('button::-p-text(Save This Stop)');
  await page.waitForFunction(() => /Stop uploaded/.test(document.querySelector('.eng-log')?.innerText || ''), { timeout: 30000 }).catch(() => {});
  const log1 = await page.$eval('.eng-log', (n) => n.innerText);
  check('Log: saved on this phone', /Saved on this phone[\s\S]*IndexedDB/.test(log1));
  check('Log: upload timed per file', /Stop uploaded[\s\S]*photo \d+ KB in [\d.]+ m?s[\s\S]*voice \d+ KB in [\d.]+ m?s[\s\S]*record/.test(log1), log1.split('\n').slice(0, 4).join(' | '));
  await page.waitForFunction(() => /Uploaded → words/.test(document.querySelector('.stop .eng-line')?.innerText || ''), { timeout: 60000 }).catch(() => {});
  const line = await page.$eval('.stop .eng-line', (n) => n.innerText).catch(() => '');
  console.log('      stop line:', line.replace(/\n/g, ' | '));
  check('Stop line: phone → cloud', /Phone → cloud: [\d.]+ m?s/.test(line));
  check('Stop line: upload this session', /Upload this session: photo/.test(line));
  check('Stop line: transcription split (download, Deepgram)', /Uploaded → words: [\d.]+ m?s \(download [\d.]+ m?s, Deepgram [\d.]+ m?s\)/.test(line));
  check('Stop line: model + confidence', /emulator-stand-in · confidence 100%/.test(line));
  check('Stop line: status', /Status: transcribed/.test(line));
  await shot('1-stop');

  // ---- offline: the stop waits on the phone, then syncs ----
  await page.setOfflineMode(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const [ch2] = await Promise.all([page.waitForFileChooser(), click('button::-p-text(Retake Photo), button::-p-text(Take Photo)')]);
  await ch2.accept([photo]);
  await click('button::-p-text(Save This Stop)');
  await sleep(800);
  const panelOff = await page.$eval('.eng-panel', (n) => n.innerText);
  check('Offline shown', /Offline: stops wait on this phone/.test(panelOff));
  check('Waiting on this phone: 1', /Waiting on this phone\s*1/.test(panelOff));
  check('Pending stop line', /On this phone \(IndexedDB\) · tries 0/.test(await body()));
  await shot('2-offline');
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => /Waiting on this phone\s*0/.test(document.querySelector('.eng-panel').innerText), { timeout: 30000 }).catch(() => {});
  const panelOn = await page.$eval('.eng-panel', (n) => n.innerText);
  check('Back online: queue empties', /Waiting on this phone\s*0/.test(panelOn));
  check('Last sync result', /1 uploaded, 0 failed/.test(panelOn));

  // ---- live words in the wrap-up recorder ----
  await click('button::-p-text(End Job)');
  await click('button::-p-text(Add field notes)');
  await page.waitForFunction(() => /Live words: live · token [\d.]+ m?s/.test(document.querySelector('.eng-live')?.innerText || ''), { timeout: 20000 }).catch(() => {});
  const liveLine = await page.$eval('.eng-live', (n) => n.innerText).catch(() => '');
  check('Recorder: live words line', /Live words: live · token [\d.]+ m?s · connection/.test(liveLine), liveLine);
  await sleep(2500);
  await shot('3-live', false);
  await click('button[aria-label="Done"]');
  await sleep(1500);
  await click('button::-p-text(Save & Finish Job)');

  // ---- AI summary ----
  await page.waitForFunction(() => /Model: emulator-stand-in/.test(document.body.innerText), { timeout: 90000 }).catch(() => {});
  const all = await body();
  const sum = all.slice(all.indexOf('Model:'), all.indexOf('Model:') + 200);
  console.log('      summary line:', sum.replace(/\n/g, ' | '));
  check('Summary: model, time, attempts', /Model: emulator-stand-in · [\d.]+ m?s · 1 attempt/.test(all));
  check('Summary: count of 5', /Summaries made for this job: 1 of 5/.test(all));
  await shot('4-summary');

  // ---- turning it off ----
  await click('button::-p-text(Back), button.back-btn').catch(() => {});
  check('No page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
