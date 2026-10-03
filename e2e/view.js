// Renders pages of a PDF to PNG screenshots using PDF.js in headless Chrome.
// Usage: node view.js <file.pdf> <firstPage> <lastPage>
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const [file, first = '1', last = '4'] = process.argv.slice(2);
const root = __dirname;
const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.pdf': 'application/pdf' };

const page = `<!doctype html><body style="margin:0;background:#888">
<div id="pages" style="display:flex;flex-wrap:wrap;gap:12px;padding:12px"></div>
<script type="module">
import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
const doc = await pdfjs.getDocument('/${path.basename(file)}').promise;
window.__pages = doc.numPages;
for (let p = ${first}; p <= Math.min(${last}, doc.numPages); p++) {
  const pg = await doc.getPage(p);
  const vp = pg.getViewport({ scale: 0.85 });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  c.style.background = '#fff';
  document.getElementById('pages').appendChild(c);
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
}
window.__done = true;
</script>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') return res.end(page);
  const p = path.join(root, url);
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(5190, async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1600, height: 1100 });
  tab.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await tab.goto('http://localhost:5190/');
  await tab.waitForFunction('window.__done === true', { timeout: 120000 });
  console.log('total pages:', await tab.evaluate(() => window.__pages));
  const out = path.join(root, `pages-${first}-${last}.png`);
  await tab.screenshot({ path: out, fullPage: true });
  console.log('saved', out);
  await browser.close();
  server.close();
});
