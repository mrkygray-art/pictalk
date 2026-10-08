// PDF download name comes from the server: export a job on a browser without sharing,
// check the stored copy's Content-Disposition and the saved file's name.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, 'e2e-pdfname');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${d})` : ''}`); };

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(() => {
    localStorage.setItem('pictalk-initials', 'KG');
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); // like DuckDuckGo
  });
  const cdp = await p.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
  const storageHits = [];
  let disposition = null;
  cdp.on('Network.responseReceived', (e) => { if (e.response.url.includes('exports') && e.response.url.includes('alt=media')) disposition = e.response.headers['content-disposition'] || e.response.headers['Content-Disposition'] || 'missing'; });
  await cdp.send('Network.enable');
  p.on('request', (r) => r.url().includes('9199') && r.url().includes('exports') && storageHits.push(r.method() + ' ' + r.url().split('?')[0]));

  const photo = path.join(OUT, 'p.jpg');
  const b64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#468'; g.fillRect(0, 0, 800, 600); return c.toDataURL('image/jpeg').split(',')[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));
  const click = async (s) => { await p.locator(s).setTimeout(20000).click(); await sleep(400); };
  const waitText = (t, timeout = 30000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);

  await p.goto('http://localhost:5176/', { waitUntil: 'load' });
  await waitText('No job open');
  await click('button::-p-text(Start New Job)');
  for (let i = 0; i < 2; i++) {
    const [ch] = await Promise.all([p.waitForFileChooser(), click('button::-p-text(Take Photo)')]);
    await ch.accept([photo]);
    await click('button::-p-text(Save This Stop)');
    await sleep(500);
  }
  await sleep(3000);
  await click('button::-p-text(End Job)');
  const inputs = await p.$$('.sheet .detail-fields input');
  await inputs[0].type('Acme Company');
  await inputs[1].type('123 West Ave');
  await click('button::-p-text(Save & Finish Job)');
  await waitText('Export PDF');
  await click('button::-p-text(Export PDF)');
  await waitText('PDF ready', 60000);
  const shown = (await p.evaluate(() => document.body.innerText)).match(/PicTalk_[\w-]+\.pdf/)?.[0];
  check('Sheet shows the new name', /^PicTalk_Acme-Company_123-West-Ave_\d{4}-\d{2}-\d{2}_\d{1,2}-\d{2}[AP]M\.pdf$/.test(shown || ''), shown);
  check('PDF was uploaded to exports/{user}/{job}.pdf', storageHits.some((h) => h.startsWith('POST')), storageHits[0]);

  await click('button::-p-text(Download PDF)');
  let saved = null;
  for (let i = 0; i < 20 && !saved; i++) { await sleep(500); saved = fs.readdirSync(OUT).find((f) => f.endsWith('.pdf')); }
  check('Download came from the stored copy, which sends the name', !!disposition && disposition.includes(shown), disposition);
  check('Both names in the header agree (no job ID)', !!disposition && !/filename\*=[^;]*[0-9a-f]{8}-[0-9a-f]{4}/.test(disposition));
  check('Downloaded file has the right name', saved === shown, saved);

  // Rename the customer and export again: only the newest copy should remain
  await p.keyboard.press('Escape'); await sleep(500);
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  await click('button::-p-text(Edit customer & location)');
  const f = await p.$$('.name-box .detail-fields input');
  await f[0].click({ clickCount: 3 }); await f[0].type('Beta Builders');
  await click('.name-actions button::-p-text(Save)');
  await sleep(800);
  await click('button::-p-text(Export PDF)');
  await waitText('PDF ready', 60000);
  await sleep(2500); // cleanup runs after the upload
  const list = await (await fetch('http://127.0.0.1:9199/v0/b/demo-pictalk.appspot.com/o?prefix=' + encodeURIComponent('exports/'), { headers: { Authorization: 'Bearer owner' } })).json();
  const uid = await p.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.uid);
  const mine = (list.items || []).filter((i) => i.name.startsWith(`exports/${uid}/`)).map((i) => i.name.split('/').pop());
  check('Re-export leaves one stored copy per job (the newest)', mine.length === 1 && mine[0].includes('Beta-Builders'), mine.join(', '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(2); });
