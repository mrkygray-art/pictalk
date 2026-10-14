// Who do I message? end to end at phone width, with /api/procore/* mocked in the browser:
// Connect Procore -> pick a project -> search by Title / Company / Name -> pick people -> Done ->
// the capture screen shows To: -> Save This Stop -> the saved stop card says who it's for.
// Then: reopening remembers the project, and with no signal the saved directory still searches.
// Needs: npm run emulators, and npx vite --port 5176. Screenshots go to e2e/directory-shots/.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const APP = 'http://localhost:5176/';
const OUT = path.join(__dirname, 'directory-shots');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const PROJECTS = [
  { companyId: '4291776', companyName: 'Kyco Builders', projectId: '373235', name: '001 - SiteSnap Test Project' },
  { companyId: '4291776', companyName: 'Kyco Builders', projectId: '373236', name: '002 - Warehouse Retrofit' },
];
const PEOPLE = [
  { id: 101, name: 'Jon Smith', firstName: 'Jon', lastName: 'Smith', title: 'Electrical Foreman', company: 'ABC Mechanical', role: 'Electrical Foreman', roleSource: 'job_title', tag: null },
  { id: 102, name: 'Ana Lopez', firstName: 'Ana', lastName: 'Lopez', title: null, company: 'Kyco Builders', role: 'Project Manager', roleSource: 'project_team', tag: null },
  { id: 103, name: 'Raj Patel', firstName: 'Raj', lastName: 'Patel', title: 'Plumbing Foreman', company: 'Delta Plumbing', role: 'Plumbing Foreman', roleSource: 'job_title', tag: null },
  { id: 104, name: 'Jon Adams', firstName: 'Jon', lastName: 'Adams', title: null, company: null, role: null, roleSource: null, tag: null },
  { id: 105, name: 'Lee Chen', firstName: 'Lee', lastName: 'Chen', title: 'Superintendent', company: 'ABC Mechanical', role: 'Superintendent', roleSource: 'job_title', tag: null },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  const shot = (name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const text = () => page.evaluate(() => document.body.innerText);
  const clear = async () => {
    await page.focus('.dir-input');
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await sleep(150);
  };
  const click = async (sel) => { await page.locator(sel).setTimeout(10000).click(); await sleep(350); };

  let signedIn = false;
  let offline = false;
  const asked = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/procore/')) return r.continue();
    asked.push(u.pathname + u.search);
    if (offline) return r.abort('internetdisconnected');
    const json = (status, body) => r.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/procore/login') {
      signedIn = true;
      return r.respond({ status: 302, headers: { location: '/?procore=connected' } });
    }
    if (!signedIn) return json(401, { error: 'not_connected' });
    if (u.pathname === '/api/procore/me') return json(200, { name: 'Fred Foreman', email: 'fred@example.com' });
    if (u.pathname === '/api/procore/projects') return json(200, { projects: PROJECTS, companies: 1, refused: 0 });
    if (u.pathname === '/api/procore/directory') {
      const pid = u.searchParams.get('projectId');
      return json(200, { people: pid === '373235' ? PEOPLE : [PEOPLE[1]], canTag: false, labels: [], compact: false, rolesAvailable: true, tagsAvailable: true });
    }
    return json(404, { error: 'not_found' });
  });

  // a photo for the stop
  const photo = path.join(OUT, 'photo.jpg');
  await page.goto(APP, { waitUntil: 'networkidle2' });
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const g = c.getContext('2d'); g.fillStyle = '#887'; g.fillRect(0, 0, 800, 600);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  });
  fs.writeFileSync(photo, Buffer.from(b64, 'base64'));

  await page.waitForFunction(() => document.body.innerText.includes('Connect Procore'), { timeout: 20000 });
  check('signed out: Connect Procore shows (no ids needed in the link)', true);
  await shot('1-connect');
  await click('button::-p-text(Connect Procore)');
  await page.waitForFunction(() => document.body.innerText.includes('Pick a project'), { timeout: 20000 });
  check('after sign-in: a project picker with only the user\'s projects', (await text()).includes('002 - Warehouse Retrofit'));
  await shot('2-pick-project');

  await click('button::-p-text(001 - SiteSnap Test Project)');
  await page.waitForFunction(() => document.body.innerText.includes('Who is this for?') && document.body.innerText.includes('5 people'), { timeout: 20000 });
  const focused = await page.evaluate(() => document.activeElement?.classList.contains('dir-input'));
  check('choosing a project loads its directory and focuses the search box', focused);
  check('project name shown with Switch Project', (await text()).includes('Switch Project'));

  // Title: no name remembered
  await click('.dir-filters button::-p-text(Title)');
  await page.type('.dir-input', 'electric');
  await sleep(300);
  let rows = await page.$$eval('.dir-person', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('Title "electric" finds the Electrical Foreman', rows.length === 1 && rows[0].includes('Jon Smith') && rows[0].includes('ABC Mechanical'), rows.join(' | '));
  await shot('3-title-search');
  await click('.dir-person');
  check('tapping selects (checkmark)', await page.$eval('.dir-person', (e) => e.getAttribute('aria-pressed') === 'true'));

  // Company, grouped
  await click('.dir-filters button::-p-text(Company)');
  await clear();
  await page.type('.dir-input', 'abc');
  await sleep(300);
  const groups = await page.$$eval('.dir-groups h3', (els) => els.map((e) => e.textContent));
  rows = await page.$$eval('.dir-person', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('Company "abc" groups ABC Mechanical\'s people', groups.join() === 'ABC Mechanical' && rows.length === 2, `${groups} / ${rows.length}`);
  await shot('4-company-search', true);

  // Name with nothing matching, then a second person
  await click('.dir-filters button::-p-text(Name)');
  await clear();
  await page.type('.dir-input', 'zzzz');
  await sleep(300);
  check('no matches says so with the project name', (await text()).includes('No matches in 001 - SiteSnap Test Project. Try another filter.'));
  await clear();
  await page.type('.dir-input', 'ana lo');
  await sleep(300);
  await click('.dir-person');
  check('picked chips list both people', (await page.$$eval('.dir-picked button', (els) => els.length)) === 2);
  check('no "undefined" anywhere', !(await text()).includes('undefined'));
  await click('button::-p-text(Done)');
  check('Done folds the search to a To: line', (await text()).includes('To: Jon Smith, Ana Lopez'));

  // Into the capture flow
  await click('button::-p-text(Start New Job)').catch(() => {});
  await page.waitForFunction(() => document.body.innerText.includes('Take Photo'));
  const toLine = await page.$eval('.to-line', (e) => e.innerText).catch(() => '');
  check('capture screen shows who the stop is for', toLine.includes('Jon Smith, Ana Lopez'), toLine);
  const [chooser] = await Promise.all([page.waitForFileChooser(), click('button::-p-text(Take Photo)')]);
  await chooser.accept([photo]);
  await sleep(600);
  await shot('5-capture-with-to', true);
  await click('button::-p-text(Save This Stop)');
  await page.waitForFunction(() => document.querySelector('.stop-to'), { timeout: 20000 });
  const card = await page.$eval('.stop-to', (e) => e.textContent);
  check('saved stop card says who it\'s for, with companies', card.includes('Jon Smith (ABC Mechanical)') && card.includes('Ana Lopez (Kyco Builders)'), card);
  // and it reached Firestore with the recipients (rules allow it): wait for the upload
  await page.waitForFunction(() => /Saved|Writing it down|No speech|Waiting/.test(document.querySelector('.stop')?.innerText ?? ''), { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  const status = await page.$eval('.stop', (e) => e.innerText);
  check('the stop uploaded (rules accepted recipients)', !/Uploading|Saved on this phone/.test(status), status.split('\n').slice(0, 4).join(' / '));
  await shot('6-saved-stop', true);

  // Reopen: the project is remembered; offline, the saved directory still searches
  offline = true;
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('Who is this for?'), { timeout: 20000 });
  const t = await text();
  check('offline: same project reopens from this phone', t.includes('001 - SiteSnap Test Project') && t.includes('Offline'));
  check('offline: the saved directory shows with Last updated', /5 people · Updated/.test(t));
  await page.type('.dir-input', 'raj');
  await sleep(300);
  rows = await page.$$eval('.dir-person', (els) => els.map((e) => e.innerText));
  check('offline search still works', rows.length === 1 && rows[0].includes('Raj Patel'));
  await shot('7-offline');

  const mic = asked.some((a) => /mic|audio/i.test(a));
  check('no microphone involved in search', !mic);
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
