// Screenshots of the iOS look (light and dark) at iPhone width, against the emulators.
// Needs: npm run emulators, and npx vite --port 5176. Saves PNGs to e2e/shots-ios/.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5176/';
const OUT = path.join(__dirname, 'shots-ios');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIDTH = Number(process.env.SHOT_WIDTH || 390);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: WIDTH, height: 844, isMobile: WIDTH < 600, hasTouch: WIDTH < 600, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
    const shot = (name, fullPage = true) => page.screenshot({ path: path.join(OUT, `${WIDTH}-${scheme}-${name}.png`), fullPage });
    const click = async (text) => {
      await page.locator(`button::-p-text(${text})`).setTimeout(15000).click();
      await sleep(500);
    };

    const photo = path.join(OUT, 'photo.jpg');
    if (!fs.existsSync(photo)) {
      const b64 = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 900;
        const g = c.getContext('2d');
        const grd = g.createLinearGradient(0, 0, 1200, 900);
        grd.addColorStop(0, '#8aa'); grd.addColorStop(1, '#345');
        g.fillStyle = grd; g.fillRect(0, 0, 1200, 900);
        return c.toDataURL('image/jpeg', 0.85).split(',')[1];
      });
      fs.writeFileSync(photo, Buffer.from(b64, 'base64'));
    }

    await page.goto(APP, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Start New Job') || document.body.innerText.includes('Take Photo'), { timeout: 30000 });
    await sleep(800);
    await shot('1-home');

    if (await page.$('::-p-text(Start New Job)')) {
      await click('Start New Job');
      if (await page.$('.sheet')) {
        await shot('2-start-sheet', false);
        await page.locator('.sheet .photo-btn').click();
      }
      await sleep(800);
    }
    await page.waitForFunction(() => document.body.innerText.includes('Take Photo'));
    const [chooser] = await Promise.all([page.waitForFileChooser(), click('Take Photo')]);
    await chooser.accept([photo]);
    await sleep(800);
    await click('Tap to Talk');
    await sleep(1500);
    await shot('3-recording', false);
    await page.locator('button.talk-btn.is-recording').click();
    await sleep(800);
    await shot('4-ready-to-save');
    await click('Save This Stop');
    await sleep(1500);
    // a second stop so the grouped list shows a hairline
    const [chooser2] = await Promise.all([page.waitForFileChooser(), click('Take Photo')]);
    await chooser2.accept([photo]);
    await sleep(600);
    await click('Save This Stop');
    await sleep(2000);
    await shot('5-saved-stops');
    await click('End Job');
    await sleep(600);
    await shot('6-end-sheet', false);
    await ctx.close();
  }
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
