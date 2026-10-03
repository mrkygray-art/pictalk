const puppeteer = require('puppeteer-core');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.goto('http://localhost:5175/', { waitUntil: 'load' });
  await p.waitForFunction(() => document.body.innerText.includes('No job open'));
  await p.locator('button::-p-text(Start New Job)').click();
  await sleep(600);
  await p.locator('button::-p-text(Tap to Talk)').click(); await sleep(1200);
  await p.locator('button.talk-btn').click(); await sleep(600);
  await p.locator('button::-p-text(Save This Stop)').click(); await sleep(3200);
  await p.locator('button::-p-text(End Job)').click(); await sleep(600);
  const inputs = await p.$$('.sheet .detail-fields input');
  await inputs[0].type('Acme Corp');
  await sleep(300);
  await p.screenshot({ path: path.join(__dirname, 'e2e', 'end-sheet-viewport.png') });
  await b.close();
})();
