// Portfolio screenshots of PicTalk Engineering Mode + 3 app screens, in the emulators
// (speech and AI are stand-ins there; captions say so). Each shot: 360x571.5 CSS px at 2x = 720x1143.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5176/';
const PHOTOS = path.join(__dirname, '..', 'pt-shots');
const OUT = path.join(PHOTOS, 'out');
fs.mkdirSync(OUT, { recursive: true });
const W = 360, H = 571.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WORDS = [
  'Bullet camera on the north siding next to the wall light. The housing is faded and the mount is loose. Replace it with a Verkada bullet camera and a new junction box.',
  'IDF in the back room. Four racks with good cable management. The patch panel on the left wall needs labels, and the PoE switch in rack two is almost full.',
  'Keypad card reader on the front entrance door frame. The red light stays on and the door strike is slow to release. Check the REX sensor and the power supply.',
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: 572, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('pictalk-initials', 'KG'));

  const click = async (sel) => { await page.locator(sel).setTimeout(20000).click(); await sleep(450); };
  const waitText = (t, timeout = 40000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
  const noToast = () => page.waitForFunction(() => !document.querySelector('.toast'), { timeout: 8000 }).catch(() => {});
  // A phone-screen shot (viewport 360x572 at 2x), with the target just below the sticky job bar
  const screen = async (name) => {
    await noToast();
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('shot', name);
  };
  const shotFrom = async (name, selectorOrY, gap = 10) => {
    await noToast();
    const y = typeof selectorOrY === 'number' ? selectorOrY
      : await page.$eval(selectorOrY, (n) => n.getBoundingClientRect().top + window.scrollY);
    const bar = await page.$eval('.job-bar', (n) => n.getBoundingClientRect().height).catch(() => 0);
    await page.evaluate((t) => window.scrollTo(0, t), Math.max(0, y - bar - 16 - gap));
    await screen(name);
  };
  const addStop = async (photo) => {
    const [ch] = await Promise.all([page.waitForFileChooser(), click('button.photo-btn')]);
    await ch.accept([path.join(PHOTOS, photo)]);
    await click('button.talk-btn');
    await sleep(3000);
    await click('button.talk-btn');
    await sleep(600);
    await click('button::-p-text(Save This Stop)');
  };
  const editWords = async (index, words) => {
    const buttons = await page.$$('button.stop-more::-p-text(Edit words)');
    await buttons[index].click();
    await page.waitForSelector('textarea.words-field');
    await page.$eval('textarea.words-field', (t) => { t.value = ''; });
    await page.type('textarea.words-field', words, { delay: 0 });
    await click('form.sheet-form button[type="submit"]');
    await sleep(600);
  };

  await page.goto(APP, { waitUntil: 'load' });
  await waitText('No job open');
  await click('button.eng-toggle');
  await click('button::-p-text(Start New Job)');

  // Stop 1 online
  await addStop('camera.jpg');
  await page.waitForFunction(() => /Status: transcribed/.test(document.body.innerText), { timeout: 60000 });

  // Stop 2 while offline -> Engineering shot of the waiting stop
  await page.setOfflineMode(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await addStop('idf.jpg');
  await sleep(1200);
  await shotFrom('eng-offline', '.eng-panel h3');
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => /Waiting on this phone\s*0/.test(document.querySelector('.eng-panel').innerText), { timeout: 30000 });

  // Stop 3 online
  await addStop('entrance.jpg');
  await page.waitForFunction(() => (document.body.innerText.match(/Status: transcribed/g) || []).length >= 3, { timeout: 90000 });

  // Real words via Edit words (stops are listed newest first: 3, 2, 1)
  await editWords(2, WORDS[0]);
  await editWords(1, WORDS[1]);
  await editWords(0, WORDS[2]);
  await sleep(1500);

  // Engineering shots: the panel, and a stop card with its timing line
  await shotFrom('eng-panel', '.eng-panel');
  const stopY = await page.evaluate(() => document.querySelectorAll('.stop')[1].querySelector('.eng-line').getBoundingClientRect().top + window.scrollY - 150);
  await shotFrom('eng-stop', stopY);

  // App shots (Engineering Mode off for clean screens)
  await click('button.eng-toggle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await click('button::-p-text(End Job)');
  await page.type('.detail-fields label:nth-child(1) input', 'Harbor Logistics');
  await page.type('.detail-fields label:nth-child(2) input', 'Main warehouse');
  await click('button::-p-text(Add field notes)');
  await page.waitForFunction(() => /Customer wants it replaced this month/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await sleep(600);
  await screen('app-live-words');
  // Tidy the stand-in's words the way a tech would, with the recorder's own Edit
  await click('button[aria-label="Edit"]');
  await page.waitForSelector('.recorder textarea');
  await page.$eval('.recorder textarea', (t) => { t.select(); });
  await page.keyboard.press('Backspace');
  await page.type('.recorder textarea', 'Panel door is loose and the hinge is rusted. Customer wants it replaced this month.');
  await click('button::-p-text(Done – attach to job)');
  await sleep(2500);
  await page.evaluate(() => document.querySelector('.sheet')?.scrollTo?.(0, 0));
  await screen('app-end-job');
  await click('button::-p-text(Save & Finish Job)');
  await sleep(3000);
  await click('button::-p-text(My Jobs)').catch(() => {});
  await page.waitForFunction(() => /Harbor Logistics/.test(document.body.innerText), { timeout: 20000 });
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await screen('app-jobs');
  console.log('errors', errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
