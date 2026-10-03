// Drives headless Chrome through the temporary PDF harness and saves the PDF it builds.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const n = process.argv[2] || '20';
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE:', m.text()));
  await page.goto(`http://localhost:5174/__pdf-harness.html?n=${n}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__done === true', { timeout: 240000 });
  console.log(await page.$eval('#log', (el) => el.textContent));
  const b64 = await page.evaluate(() => window.__pdfBase64);
  const out = path.join(__dirname, `test-${n}.pdf`);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('saved', out, fs.statSync(out).size, 'bytes');
  await browser.close();
})().catch((e) => {
  console.error('RUN FAILED:', e.message);
  process.exit(1);
});
