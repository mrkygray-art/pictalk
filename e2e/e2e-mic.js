// Mic picker test: desktop shows it with 2+ mics and records from the chosen one; phones don't show it.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const APP = 'http://localhost:5176/';
const OUT = path.join(__dirname, 'e2e-mic');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two pretend mics; getUserMedia records what it was asked for and refuses unknown ids
const fakeMics = () => {
  const MICS = [
    { deviceId: 'id-desk', kind: 'audioinput', label: 'Desk Mic (USB)', groupId: 'g1' },
    { deviceId: 'id-cam', kind: 'audioinput', label: 'Webcam Microphone', groupId: 'g2' },
  ];
  window.__asked = [];
  navigator.mediaDevices.enumerateDevices = async () => MICS.map((m) => ({ ...m, toJSON() { return m; } }));
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    const id = c?.audio?.deviceId?.exact ?? 'default';
    window.__asked.push(id);
    if (id !== 'default' && !MICS.some((m) => m.deviceId === id)) {
      const e = new Error('no such mic'); e.name = 'OverconstrainedError'; throw e;
    }
    return orig({ audio: true });
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  // ---------- desktop ----------
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.evaluateOnNewDocument(fakeMics);
  const click = async (sel) => { await page.locator(sel).setTimeout(20000).click(); await sleep(400); };
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (t) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, t);

  await page.goto(APP, { waitUntil: 'load' });
  await waitText('No job open');
  await click('button::-p-text(Start New Job)');
  await waitText('Tap to Talk');
  await sleep(500);
  check('Desktop with 2 mics shows the microphone line', (await text()).includes('Microphone: Browser default'));

  await click('.mic-line button::-p-text(Change)');
  const choices = await page.$$eval('.sheet .mic-choice', (b) => b.map((x) => x.innerText));
  check('Change lists each mic plus Browser default', choices.join('|') === 'Desk Mic (USB)|Webcam Microphone|Browser default', choices.join('|'));
  await page.screenshot({ path: path.join(OUT, '01-sheet.png') });
  await click('.sheet button::-p-text(Desk Mic)');
  check('Chosen mic shows on the line', (await text()).includes('Microphone: Desk Mic (USB)'));
  check('Choice remembered on this computer', (await page.evaluate(() => localStorage.getItem('pictalk-mic'))).includes('id-desk'));

  await page.evaluate(() => { window.__asked = []; });
  await click('button.talk-btn');
  await sleep(1600);
  await click('button.talk-btn');
  check('Recording asks for exactly the chosen mic', (await page.evaluate(() => window.__asked)).join() === 'id-desk', await page.evaluate(() => window.__asked.join()));

  // id changed (e.g. unplugged and back): found again by name
  await page.evaluate(() => { localStorage.setItem('pictalk-mic', JSON.stringify({ id: 'old-id', label: 'Webcam Microphone' })); window.__asked = []; });
  await click('button.talk-btn');
  await sleep(1600);
  await click('button.talk-btn');
  const asked = await page.evaluate(() => window.__asked.join());
  check('If the saved mic id changed, it finds the mic by name', asked === 'old-id,id-cam', asked);
  check('...and remembers the new id', (await page.evaluate(() => localStorage.getItem('pictalk-mic'))).includes('id-cam'));

  // mic gone entirely: falls back to the default
  await page.evaluate(() => { localStorage.setItem('pictalk-mic', JSON.stringify({ id: 'gone', label: 'Unplugged Mic' })); window.__asked = []; });
  await click('button.talk-btn');
  await sleep(1600);
  await click('button.talk-btn');
  const asked2 = await page.evaluate(() => window.__asked.join());
  check('If the mic is unplugged, it still records with the default mic', asked2 === 'gone,default', asked2);
  check('No error shown', !(await text()).toLowerCase().includes("couldn't"));
  await page.screenshot({ path: path.join(OUT, '02-desktop.png') });

  // Browser default choice
  await page.waitForFunction(() => !document.querySelector('.mic-line button')?.disabled, { timeout: 15000 });
  await click('.mic-line button::-p-text(Change)');
  await click('.sheet button::-p-text(Browser default)');
  check('Browser default clears the choice', (await page.evaluate(() => localStorage.getItem('pictalk-mic'))) === null);

  // ---------- phone ----------
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.evaluateOnNewDocument(fakeMics);
  await phone.goto(APP, { waitUntil: 'load' });
  await phone.waitForFunction(() => document.body.innerText.includes('Tap to Talk') || document.body.innerText.includes('No job open'), { timeout: 30000 });
  if ((await phone.evaluate(() => document.body.innerText)).includes('Start New Job')) {
    await phone.locator('button::-p-text(Start New Job)').click();
  }
  await phone.waitForFunction(() => document.body.innerText.includes('Tap to Talk'), { timeout: 30000 });
  await sleep(800);
  console.log('phone pointer fine?', await phone.evaluate(() => matchMedia('(pointer: fine)').matches));
  check('Phone does not show the microphone line', !(await phone.evaluate(() => !!document.querySelector('.mic-line'))));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
