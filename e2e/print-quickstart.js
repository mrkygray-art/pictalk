// Prints docs/quick-start/quick-start.html to public/SiteSnap-AI-Quick-Start.pdf (Letter).
const puppeteer = require('puppeteer-core');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'docs', 'quick-start', 'quick-start.html')).href, { waitUntil: 'networkidle0' });
  await page.pdf({ path: path.join(__dirname, '..', 'public', 'SiteSnap-AI-Quick-Start.pdf'), format: 'Letter', printBackground: true });
  await page.screenshot({ path: path.join(process.env.TEMP, 'qs.png'), fullPage: true });
  await browser.close();
  console.log('pdf written');
})();
