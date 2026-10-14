// Embedded mode test: PicTalk inside a cross-origin iframe (a host page on another port).
// Checks the debug strip, unfilled {{procore...}} placeholders, the "Capture in a new tab"
// button (new tab carries the same companyId / projectId, voice works there), and that
// ordinary links outside an iframe are unchanged. Also the Procore panel in the top-level tab,
// with /api/procore/* mocked in the browser (the dev server has no /api).
// Needs only the dev server: npx vite --port 5176 (no emulators; sign-in may warn, that's fine).
const puppeteer = require('puppeteer-core');
const http = require('http');

const APP = 'http://localhost:5176/';
const HOST_PORT = 5199; // a different origin, like a partner's site
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// /host?src=<query for PicTalk> -> a page that embeds PicTalk with that query, as written
const host = http.createServer((req, res) => {
  const src = new URL(req.url, 'http://x').searchParams.get('src') ?? '';
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>Host</title><h1>Partner site</h1>
<iframe id="pt" src="${APP}${src.replace(/"/g, '&quot;')}" width="420" height="900"></iframe>`);
});

const stripOf = (text) => {
  const m = text.match(/Embedded: (yes|no)\s*Company: (.+?)\s*Project: (.+?)(\n|$)/);
  return m ? { embedded: m[1], company: m[2].trim(), project: m[3].trim() } : null;
};

(async () => {
  await new Promise((r) => host.listen(HOST_PORT, r));
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  // Waits for the capture screen (Take Photo) in a page or frame, returns its text
  const ready = async (ctx) => {
    await ctx.waitForFunction(() => document.body.innerText.includes('Take Photo'), { timeout: 30000 });
    return ctx.evaluate(() => document.body.innerText);
  };
  const buttons = (ctx) => ctx.$$eval('button', (bs) => bs.map((b) => b.innerText.trim()));

  // Opens PicTalk inside the host page; returns { page, frame, text }
  const embed = async (src) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
    await page.goto(`http://localhost:${HOST_PORT}/host?src=${encodeURIComponent(src)}`, { waitUntil: 'load' });
    const handle = await page.waitForSelector('#pt');
    const frame = await handle.contentFrame();
    return { page, frame, text: await ready(frame) };
  };

  // Clicks "Capture in a new tab" inside the frame and returns the new tab
  const openNewTab = async (page, frame) => {
    const before = new Set(browser.targets());
    const btn = await frame.waitForSelector('::-p-text(Capture in a new tab)');
    await btn.click();
    const target = await browser.waitForTarget((t) => t.type() === 'page' && !before.has(t), { timeout: 15000 });
    const tab = await target.page();
    await tab.waitForFunction(() => location.href !== 'about:blank', { timeout: 15000 });
    return tab;
  };

  // ---------- 1. in an iframe with real ids ----------
  {
    const { page, frame, text } = await embed('?companyId=123&projectId=456');
    const s = stripOf(text);
    check('iframe + ids: strip shows Embedded yes, Company 123, Project 456',
      s?.embedded === 'yes' && s.company === '123' && s.project === '456', JSON.stringify(s));
    const b = await buttons(frame);
    check('iframe: "Capture in a new tab" replaces Tap to Talk',
      b.includes('Capture in a new tab') && !b.some((t) => /Tap to Talk|Talk Again/.test(t)), b.join(' | '));
    check('iframe: Take Photo is still there', b.includes('Take Photo'));
    check('iframe: no microphone picker', !text.includes('Microphone:'));

    const tab = await openNewTab(page, frame);
    const url = new URL(tab.url());
    check('new tab opens this same app URL with the same ids',
      url.origin + '/' === APP && url.searchParams.get('companyId') === '123' && url.searchParams.get('projectId') === '456', tab.url());
    const tabText = await ready(tab);
    const ts = stripOf(tabText);
    check('new tab: Embedded no, same Company / Project',
      ts?.embedded === 'no' && ts.company === '123' && ts.project === '456', JSON.stringify(ts));
    const tb = await buttons(tab);
    check('new tab: Tap to Talk is back, no "Capture in a new tab"',
      tb.includes('Tap to Talk') && !tb.includes('Capture in a new tab'), tb.join(' | '));
    check('iframe: no Procore panel (its login page can\'t load in an iframe)', !text.includes('Procore'));
    await tab.close();
    await page.close();
  }

  // ---------- 1b. Procore panel in the top-level tab (the /api/procore functions mocked) ----------
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
    let signedIn = false;
    const asked = [];
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith('/api/procore/')) return r.continue();
      asked.push(u.pathname + u.search);
      const json = (status, body) => r.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/procore/login') { // pretend Procore signed in and sent us back
        signedIn = true;
        return r.respond({ status: 302, headers: { location: `/?${u.searchParams}&procore=connected` } });
      }
      if (!signedIn) return json(401, { error: 'not_connected' });
      if (u.pathname === '/api/procore/me') return json(200, { name: 'Carl Contractor', email: 'carl.contractor@example.com' });
      if (u.pathname === '/api/procore/directory') return json(200, { people: [
        { id: 1, name: 'Jane Doe', company: 'Doe Plumbing', role: 'Superintendent' },
        { id: 2, name: 'Sam Lee', company: null, role: null },
      ] });
      return json(404, {});
    });
    await page.goto(`${APP}?companyId=123&projectId=456`, { waitUntil: 'load' });
    const btn = await page.waitForSelector('::-p-text(Connect Procore)', { timeout: 30000 });
    check('top-level tab, not signed in: "Connect Procore" button', !!btn);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), btn.click()]);
    check('Connect Procore starts sign-in with the same ids',
      asked.includes('/api/procore/login?companyId=123&projectId=456'), asked.join(' , '));
    await page.waitForFunction(() => document.body.innerText.includes('Project people'), { timeout: 30000 });
    const t = await page.evaluate(() => document.body.innerText);
    check('after sign-in: back on the same project, "Connected to Procore."', page.url().includes('companyId=123&projectId=456') && t.includes('Connected to Procore.'), page.url());
    check('shows the signed-in name and email', t.includes('Carl Contractor') && t.includes('carl.contractor@example.com'));
    check('lists the project people with company and role', t.includes('Project people (2)') && t.includes('Jane Doe') && t.includes('Doe Plumbing · Superintendent') && t.includes('Sam Lee'));
    const meIdx = asked.findIndex((a) => a.startsWith('/api/procore/me?companyId=123'));
    const dirIdx = asked.findIndex((a) => a === '/api/procore/directory?companyId=123&projectId=456');
    check('asks /me (with companyId), then the directory', meIdx >= 0 && dirIdx > meIdx, asked.join(' , '));
    await page.close();
  }

  // ---------- 2. unfilled {{procore...}} placeholders (raw braces, and percent-encoded) ----------
  for (const [label, src] of [
    ['raw', '?companyId={{procore.company.id}}&projectId={{procore.project.id}}'],
    ['encoded', '?companyId=%7B%7Bprocore.company.id%7D%7D&projectId=%7B%7Bprocore.project.id%7D%7D'],
  ]) {
    const { page, frame, text } = await embed(src);
    const s = stripOf(text);
    check(`iframe + {{procore...}} (${label}): Company and Project "not received"`,
      s?.embedded === 'yes' && s.company === 'not received' && s.project === 'not received', JSON.stringify(s));
    check(`iframe + {{procore...}} (${label}): the placeholder text never shows`, !text.includes('{{'));
    const b = await buttons(frame);
    check(`iframe + {{procore...}} (${label}): Capture in a new tab, Take Photo`,
      b.includes('Capture in a new tab') && b.includes('Take Photo') && !b.includes('Tap to Talk'));

    const tab = await openNewTab(page, frame);
    const url = new URL(tab.url());
    check(`new tab (${label}): carries the same companyId / projectId values`,
      url.searchParams.get('companyId') === '{{procore.company.id}}' && url.searchParams.get('projectId') === '{{procore.project.id}}', tab.url());
    const ts = stripOf(await ready(tab));
    check(`new tab (${label}): Embedded no, still "not received"`,
      ts?.embedded === 'no' && ts.company === 'not received' && ts.project === 'not received', JSON.stringify(ts));
    await tab.close();
    await page.close();
  }

  // ---------- 3. one id filled, the other a placeholder ----------
  {
    const { page, text } = await embed('?companyId=77&projectId={{procore.project.id}}');
    const s = stripOf(text);
    check('iframe + one placeholder: Company 77, Project not received',
      s?.embedded === 'yes' && s.company === '77' && s.project === 'not received', JSON.stringify(s));
    await page.close();
  }

  // ---------- 4. iframe without any ids ----------
  {
    const { page, frame, text } = await embed('');
    const s = stripOf(text);
    check('iframe, no ids: Embedded yes, both not received',
      s?.embedded === 'yes' && s.company === 'not received' && s.project === 'not received', JSON.stringify(s));
    check('iframe, no ids: still Capture in a new tab', (await buttons(frame)).includes('Capture in a new tab'));
    await page.close();
  }

  // ---------- 5. outside an iframe, ordinary link: nothing changes ----------
  {
    const page = await browser.newPage();
    await page.goto(APP, { waitUntil: 'load' });
    const text = await ready(page);
    const b = await buttons(page);
    check('top level, ordinary link: no debug strip', !text.includes('Embedded:'));
    check('top level, ordinary link: Tap to Talk, no Capture in a new tab',
      b.includes('Tap to Talk') && !b.includes('Capture in a new tab'));
    check('top level, ordinary link: no Procore panel', !text.includes('Procore'));
    await page.close();
  }

  await browser.close();
  host.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('RUN FAILED:', e.message);
  process.exit(1);
});
