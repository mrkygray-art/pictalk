// A job with no usable speech: one photo-only stop, one voice note that transcribes to nothing.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, 'e2e-nospeech');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const photo = path.join(OUT, 'p.jpg');
  const b64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; c.getContext('2d').fillRect(0, 0, 800, 600); return c.toDataURL('image/jpeg').split(',')[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));
  const click = async (s) => { await p.locator(s).setTimeout(20000).click(); await sleep(400); };
  await p.goto('http://localhost:5176/', { waitUntil: 'load' });
  await p.waitForFunction(() => document.body.innerText.includes('No job open'));
  await click('button::-p-text(Start New Job)');
  const [ch] = await Promise.all([p.waitForFileChooser(), click('button::-p-text(Take Photo)')]);
  await ch.accept([photo]);
  await click('button::-p-text(Save This Stop)');
  await click('button::-p-text(Tap to Talk)'); await sleep(1200);
  await click('button.talk-btn'); await sleep(500);
  await click('button::-p-text(Save This Stop)'); await sleep(3000);
  await click('button::-p-text(End Job)');
  await click('button::-p-text(Save & Finish Job)');
  // The emulator can't reach Deepgram, so the voice note ends with no transcript
  await p.waitForFunction(() => document.body.innerText.includes('No summary for this job'), { timeout: 90000 });
  const t = await p.evaluate(() => document.body.innerText);
  const noButton = !(await p.$('button::-p-text(Build Summary)'));
  console.log(noButton && !t.includes('[400]') ? 'PASS  no-speech job shows the note and no Build Summary button' : 'FAIL');
  await p.screenshot({ path: path.join(OUT, 'no-speech.png') });
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
