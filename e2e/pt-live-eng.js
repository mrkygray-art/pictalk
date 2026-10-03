const puppeteer = require('puppeteer-core'); const path = require('path');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.goto('https://pictalk-6cbff.web.app/?v=' + Date.now(), { waitUntil: 'load' }); await p.waitForSelector('button.eng-toggle', { timeout: 20000 });
  console.log('toggle:', await p.$eval('button.eng-toggle', (n) => n.textContent).catch(() => 'MISSING'));
  console.log('panel before:', !!(await p.$('.eng-panel')));
  await p.click('button.eng-toggle'); await new Promise((r) => setTimeout(r, 3000));
  const t = await p.$eval('.eng-panel', (n) => n.innerText).catch(() => 'MISSING');
  console.log(t.split('\n').filter(Boolean).slice(0, 30).join(' | '));
  await p.screenshot({ path: path.join(__dirname, 'pt-live-eng.png'), fullPage: true });
  console.log('errors', errors); await b.close();
})();
