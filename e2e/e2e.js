// End-to-end test of PicTalk (naming-pdf branch) against the Firebase emulators,
// at a phone-sized viewport. Uses Chrome's fake mic; photos go in through the real
// file chooser. Saves screenshots and downloaded PDFs next to this script.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5175/';
const OUT = path.join(__dirname, 'e2e');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PAGE;
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  PAGE = page;
  page.on('console', (m) => ['error', 'warn'].includes(m.type()) && console.log('CONSOLE', m.type() + ':', m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  // Test photos: phone-sized JPEGs made in the browser
  const photos = [];
  for (let i = 0; i < 3; i++) {
    const b64 = await page.evaluate(async (i) => {
      const c = document.createElement('canvas');
      c.width = 4032; c.height = 3024;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 4032, 3024);
      grd.addColorStop(0, `hsl(${i * 90},40%,60%)`);
      grd.addColorStop(1, `hsl(${i * 90 + 150},30%,25%)`);
      g.fillStyle = grd; g.fillRect(0, 0, 4032, 3024);
      g.fillStyle = '#fff'; g.font = 'bold 320px sans-serif'; g.fillText(`Photo ${i + 1}`, 200, 600);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }, i);
    const f = path.join(OUT, `photo-${i + 1}.jpg`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    photos.push(f);
  }

  // Force the download path (headless Chrome can't show a share sheet), but record
  // whether this browser offered sharing.
  await page.evaluateOnNewDocument(() => {
    window.__hadCanShare = typeof navigator.canShare === 'function';
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });

  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const click = async (text) => {
    await page.locator(`button::-p-text(${text})`).setTimeout(15000).click();
    await sleep(400);
  };
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const cardsText = () => page.$$eval('.job-card', (els) => els.map((e) => e.innerText).join(' || '));
  const openMyJobs = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await page.locator('.header-row button::-p-text(My Jobs)').click();
    await page.waitForSelector('h1.page-title');
    await sleep(500);
  };
  const waitText = (text, timeout = 20000) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

  async function saveStop(photoIndex, withVoice = true) {
    const [chooser] = await Promise.all([page.waitForFileChooser(), click('Take Photo')]);
    await chooser.accept([photos[photoIndex % photos.length]]);
    await sleep(300);
    if (withVoice) {
      await click('Tap to Talk');
      await sleep(1500);
      await page.locator('button.talk-btn').click();
      await sleep(600);
    }
    await click('Save This Stop');
    await sleep(500);
  }

  await page.goto(APP, { waitUntil: 'load' });
  await waitText('No job open');
  const home = await bodyText();
  check('Demo notice shown', home.includes('Demo app · Up to 10 stops per job · Voice notes are deleted after 5 days'));
  await shot('01-home');

  // ---- Job 1: three stops, end with Customer + Location ----
  await click('Start New Job');
  await waitText('Saving to');
  for (let i = 0; i < 3; i++) await saveStop(i);
  await waitText('3 stops saved');
  check('Saved 3 stops', true);
  await click('End Job');
  await waitText('Add who and where this job was for');
  await shot('02-end-job-sheet');
  const inputs = await page.$$('.sheet .detail-fields input');
  await inputs[0].type('Acme Corp');
  await page.keyboard.press('Enter'); // should move to Location, not finish
  await sleep(300);
  const stillOpen = await page.$('.sheet .detail-fields');
  check('Enter in Customer moves to Location (does not finish)', !!stillOpen);
  await page.keyboard.type('1420 Main St');
  await click('Save & Finish Job');
  await waitText('No job open');
  const toast = await bodyText();
  check('Finish message uses Customer – Location – date', /Finished Acme Corp – 1420 Main St – [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M/.test(toast));

  // ---- Job 2: end with both fields blank ----
  await click('Start New Job');
  await waitText('Saving to');
  await saveStop(1, false);
  await click('End Job');
  await click('Save & Finish Job');
  await waitText('No job open');

  // ---- My Jobs, job page, edit ----
  await openMyJobs();
  const jobsText = await cardsText();
  check('Job with details listed by Customer – Location – date', /Acme Corp – 1420 Main St – /.test(jobsText));
  check('Job with blank details keeps date-only name', /Job · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}/.test(jobsText));
  await shot('03-my-jobs');
  await page.locator('button.job-card::-p-text(Acme Corp)').click();
  await waitText('Edit customer & location');
  await shot('04-job-page');
  await click('Edit customer & location');
  const editInputs = await page.$$('.name-box .detail-fields input');
  await editInputs[1].click({ clickCount: 3 });
  await editInputs[1].type('West Wing, 1420 Main St');
  await shot('05-edit-details');
  await click('Save');
  await waitText('Location: West Wing, 1420 Main St');
  check('Location edited later from the job page', (await bodyText()).includes('Acme Corp – West Wing, 1420 Main St – '));

  // ---- Export PDF twice (Rev 1 then Rev 2) ----
  const pdfsBefore = () => fs.readdirSync(OUT).filter((f) => f.endsWith('.pdf'));
  await click('Export PDF');
  await waitText('Your initials');
  await shot('06-initials');
  await page.type('.sheet .detail-fields input', 'kg');
  await click('Continue');
  await waitText('PDF ready', 60000);
  await shot('07-pdf-ready');
  const readyText = await bodyText();
  const fileName = (readyText.match(/PicTalk_[\w-]+\.pdf/) || [''])[0];
  check('File name PicTalk_[Customer]_[date].pdf', /^PicTalk_Acme_Corp_\d{4}-\d{2}-\d{2}\.pdf$/.test(fileName), fileName);
  check('Browser offered Web Share (phones get "Share PDF")', await page.evaluate(() => window.__hadCanShare), 'desktop headless; forced download for the test');
  await click('Download PDF');
  await sleep(2500);
  const first = pdfsBefore();
  check('First PDF downloaded', first.length === 1, first.join(', '));
  if (first[0]) fs.renameSync(path.join(OUT, first[0]), path.join(OUT, 'export-1.pdf'));

  await click('Export PDF');
  await waitText('PDF ready', 60000); // initials remembered: no prompt
  check('Initials asked only once', true);
  await click('Download PDF');
  await sleep(2500);
  const second = pdfsBefore().filter((f) => f !== 'export-1.pdf');
  check('Second PDF downloaded', second.length === 1, second.join(', '));
  if (second[0]) fs.renameSync(path.join(OUT, second[0]), path.join(OUT, 'export-2.pdf'));

  // ---- Offline export: clear message, no PDF ----
  await page.setOfflineMode(true);
  await click('Export PDF');
  await waitText('PDF not made', 60000);
  const offlineText = await bodyText();
  check('Offline export shows a message instead of a broken PDF', /couldn't be loaded, so no PDF was made/.test(offlineText));
  await shot('08-offline-export');
  await click('Close');
  await page.setOfflineMode(false);
  await sleep(1500);

  // ---- 10-stop limit ----
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await page.locator('button.link-btn::-p-text(My Jobs)').click();
  await sleep(400);
  await page.locator('button.link-btn::-p-text(Camera)').click();
  await sleep(400);
  await click('Start New Job');
  await waitText('Saving to');
  for (let i = 0; i < 10; i++) await saveStop(i, false);
  await waitText('This demo allows 10 stops per job', 30000);
  const full = await bodyText();
  check('At 10 stops the capture area is replaced by the limit message', !full.includes('Take Photo') && full.includes('End this job to start a new one'));
  await shot('09-limit-reached');
  // Moving a stop from the Acme job into the full job is blocked
  await openMyJobs();
  await page.locator('button.job-card::-p-text(Acme Corp)').click();
  await waitText('Move or Delete');
  await page.locator('button.stop-more').click();
  await click('Move to a Different Job');
  await sleep(500);
  const fullCardDisabled = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet .job-card')].some((b) => b.disabled && b.innerText.includes('Full (10 stops)')));
  check('Full job shown as Full and not selectable in Move', fullCardDisabled);
  await shot('10-move-full');

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  if (PAGE) {
    await PAGE.screenshot({ path: path.join(OUT, 'zz-failure.png'), fullPage: true }).catch(() => {});
    console.error('SCREEN TEXT:', (await PAGE.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 600));
  }
  process.exit(2);
});
