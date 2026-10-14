// Procore sign-in, end to end in Chrome: the real api/procore/* handlers run on a local server
// (standing in for Vercel) against a stand-in Procore (authorize, token, /me, project users) that
// checks every request. Run once with the code in the query and once with it after '#'.
// Everything else is passed to the dev server, so the real ProcorePanel UI is used.
// Needs only the dev server: npx vite --port 5176. Uses made-up credentials, never real ones.
const puppeteer = require('puppeteer-core');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 5198;
const SITE = `http://localhost:${PORT}`;
const VITE = { host: 'localhost', port: 5176 };
const CLIENT_ID = 'e2e-client-id';
const CLIENT_SECRET = 'e2e-client-secret-never-in-browser';
Object.assign(process.env, {
  PROCORE_CLIENT_ID: CLIENT_ID,
  PROCORE_CLIENT_SECRET: CLIENT_SECRET,
  PROCORE_LOGIN_URL: `${SITE}/fake-procore`,
  PROCORE_API_URL: `${SITE}/fake-procore-api`,
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef',
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const readAll = async (req) => { let s = ''; for await (const c of req) s += c; return s; };

(async () => {
  const api = {};
  for (const name of ['login', 'callback', 'me', 'directory', 'responsibility']) {
    api[name] = (await import(pathToFileURL(path.join(__dirname, '..', 'api', 'procore', `${name}.js`)))).default;
  }
  const { REDIRECT_URI } = await import(pathToFileURL(path.join(__dirname, '..', 'api', '_procore.js')));
  // SiteSnap's Firestore tag store, in memory (the real one needs FIREBASE_SERVICE_ACCOUNT_B64)
  const { setTagStore } = await import(pathToFileURL(path.join(__dirname, '..', 'api', '_responsibilities.js')));
  const tagDocs = new Map();
  setTagStore({
    async list(c, p) { return new Map(tagDocs.get(`${c}_${p}`) ?? []); },
    async set(c, p, u, v) { const m = tagDocs.get(`${c}_${p}`) ?? new Map(); m.set(u, v); tagDocs.set(`${c}_${p}`, m); },
    async remove(c, p, u) { tagDocs.get(`${c}_${p}`)?.delete(u); },
  });
  const PROJECT_USERS = [
    { id: 1, name: 'Jane Doe', job_title: 'Superintendent', vendor: { id: 7, name: 'Doe Plumbing' }, permission_template: { id: 2, name: 'Project Manager' } },
    { id: 2, first_name: 'Sam', last_name: 'Lee', name: 'Sam Lee', initials: 'SL', vendor: { id: 8, name: 'Lee Electric' } },
    { id: 3, name: 'Nobody Set', vendor: null, job_title: null },
    { id: 160586, name: 'Carl Contractor', vendor: { id: 9, name: 'GC Inc' } },
  ];

  // Stand-in Procore state
  let mode = 'query'; // where authorize puts the code: 'query' | 'hash'
  let issued = 0;
  const codes = new Map(); // code -> state, single use
  const seen = { authorize: [], token: [], api: [] };

  const fakeProcore = async (req, res, u) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/fake-procore/oauth/authorize') {
      const q = Object.fromEntries(u.searchParams);
      seen.authorize.push(q);
      if (q.client_id !== CLIENT_ID || q.response_type !== 'code' || q.redirect_uri !== REDIRECT_URI || !q.state) return json(400, { error: 'invalid_request' });
      const code = `code-${++issued}`;
      codes.set(code, q.state);
      // Real Procore would send the browser to the registered redirect_uri; here it's the local copy
      const back = new URLSearchParams({ code, state: q.state });
      res.writeHead(302, { location: mode === 'hash' ? `/api/procore/callback#${back}` : `/api/procore/callback?${back}` });
      return res.end();
    }
    if (u.pathname === '/fake-procore/oauth/token' && req.method === 'POST') {
      const f = Object.fromEntries(new URLSearchParams(await readAll(req)));
      seen.token.push(f);
      if (f.client_id !== CLIENT_ID || f.client_secret !== CLIENT_SECRET || f.redirect_uri !== REDIRECT_URI) return json(401, { error: 'invalid_client' });
      if (f.grant_type !== 'authorization_code' || !codes.delete(f.code)) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: `at-${f.code}`, token_type: 'bearer', expires_in: 5400, refresh_token: `rt-${f.code}`, created_at: Math.floor(Date.now() / 1000) });
    }
    if (u.pathname.startsWith('/fake-procore-api/')) {
      seen.api.push({ method: req.method, path: u.pathname + u.search, auth: req.headers.authorization, company: req.headers['procore-company-id'] });
      if (!/^Bearer at-code-\d+$/.test(req.headers.authorization ?? '')) return json(401, { error: 'Invalid Token' });
      if (u.pathname === '/fake-procore-api/rest/v1.0/me') {
        return json(200, u.searchParams.get('company_id') ? { id: 160586, login: 'carl.contractor@example.com', name: 'Carl Contractor' } : { id: 160586, login: 'carl.contractor@example.com' });
      }
      if (req.headers['procore-company-id'] !== '123' && u.pathname !== '/fake-procore-api/rest/v1.0/me') return json(400, { error: 'Procore-Company-Id required' });
      if (u.pathname === '/fake-procore-api/rest/v1.0/projects/456/users') return json(200, PROJECT_USERS);
      const one = u.pathname.match(/^\/fake-procore-api\/rest\/v1\.0\/projects\/456\/users\/(\d+)$/);
      if (one) {
        const found = PROJECT_USERS.find((p) => String(p.id) === one[1]);
        return found ? json(200, found) : json(404, { error: 'not found' });
      }
      if (u.pathname === '/fake-procore-api/rest/v1.0/project_roles' && u.searchParams.get('project_id') === '456') {
        return json(200, [{ id: 1, name: 'Carl Contractor', role: 'Project Manager', user_id: 160586, is_active: true }]);
      }
      return json(404, { error: 'not found' });
    }
    return json(404, { error: 'not found' });
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, SITE);
    // Handlers can't send a real Procore login here, so plain responses mean a broken test
    if (u.pathname.startsWith('/fake-procore')) return fakeProcore(req, res, u);
    const m = u.pathname.match(/^\/api\/procore\/(login|callback|me|directory|responsibility)$/);
    if (m) return api[m[1]](req, res);
    // Everything else: the app from the dev server
    const p = http.request({ ...VITE, path: req.url, method: req.method, headers: { ...req.headers, host: `${VITE.host}:${VITE.port}` } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    p.on('error', () => { res.writeHead(502); res.end('dev server not running'); });
    req.pipe(p);
  });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

  for (const m of ['query', 'hash']) {
    mode = m;
    tagDocs.clear(); // each run starts with no SiteSnap tags
    const ctx = await browser.createBrowserContext(); // fresh cookies each run
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
    const visited = [];
    page.on('request', (r) => r.isNavigationRequest() && r.frame() === page.mainFrame() && visited.push(r.url()));
    const before = { token: seen.token.length, api: seen.api.length };

    await page.goto(`${SITE}/?companyId=123&projectId=456`, { waitUntil: 'load' });
    const btn = await page.waitForSelector('::-p-text(Connect Procore)', { timeout: 30000 });
    check(`[${m}] not signed in: "Connect Procore" button`, !!btn);
    await btn.click();
    await page.waitForFunction(() => document.body.innerText.includes('Project people'), { timeout: 30000 });
    const text = await page.evaluate(() => document.body.innerText);

    check(`[${m}] back on the same project with procore=connected`, page.url() === `${SITE}/?companyId=123&projectId=456&procore=connected`, page.url());
    check(`[${m}] went through Procore's authorize and our callback`,
      visited.some((v) => v.includes('/api/procore/callback')), visited.map((v) => new URL(v).pathname).join(' > '));
    const tok = seen.token.slice(before.token);
    check(`[${m}] one code-for-token exchange, with the secret, server to server`, tok.length === 1 && tok[0].grant_type === 'authorization_code' && tok[0].client_secret === CLIENT_SECRET);
    check(`[${m}] shows "Connected to Procore as" the signed-in name`, text.includes('Connected to Procore as Carl Contractor'));
    check(`[${m}] lists the project's people: name, company, role`,
      text.includes('Project people (4)') && text.includes('Doe Plumbing · Superintendent') && text.includes('Sam Lee') && text.includes('Lee Electric'));
    check(`[${m}] Project Roles come first: Carl shows as Project Manager from the Procore project team`,
      text.includes('GC Inc · Project Manager') && text.includes('Procore project team'));
    check(`[${m}] missing data says "not set in Procore" instead of a dash`,
      text.includes('Lee Electric · Role not set in Procore') && text.includes('Company not set in Procore · Role not set in Procore') && !/\n—\n/.test(text));
    if (m === 'query') {
      // Carl is the PM, so he can tag Nobody Set (who has no role in Procore)
      check('[query] the PM sees the tagging note and a Responsibility picker', text.includes("You're this project's PM"));
      const pick = await page.evaluateHandle(() => [...document.querySelectorAll('.procore-people li')].find((li) => li.innerText.includes('Nobody Set'))?.querySelector('select'));
      const pickers = await page.evaluate(() => [...document.querySelectorAll('.procore-people li')].filter((li) => li.querySelector('select')).map((li) => li.querySelector('strong').innerText));
      check('[query] only people Procore has no role for get a picker (Sam Lee, Nobody Set)', pickers.join(',') === 'Sam Lee,Nobody Set', pickers.join(','));
      await pick.select('Purchasing');
      await page.waitForFunction(() => [...document.querySelectorAll('.procore-people li')].some((li) => li.innerText.includes('Nobody Set') && li.innerText.includes('Tagged in SiteSnap')), { timeout: 15000 });
      const saved = tagDocs.get('123_456')?.get('3');
      check('[query] the tag is saved server-side with who set it', saved?.label === 'Purchasing' && saved.setByProcoreUserId === '160586' && saved.setByName === 'Carl Contractor', JSON.stringify(saved));
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => document.body.innerText.includes('Project people'), { timeout: 30000 });
      const after = await page.evaluate(() => [...document.querySelectorAll('.procore-people li')].find((li) => li.innerText.includes('Nobody Set'))?.innerText ?? '');
      check('[query] after a reload, Nobody Set shows Purchasing (tagged in SiteSnap)', after.includes('Purchasing') && after.includes('Tagged in SiteSnap'), after.replace(/\n/g, ' | '));
    }
    const calls = seen.api.slice(before.api);
    check(`[${m}] Procore API calls are GET only, with the token and Procore-Company-Id 123`,
      calls.length >= 2 && calls.every((c) => c.method === 'GET' && c.company === '123' && /^Bearer at-/.test(c.auth)), JSON.stringify(calls.map((c) => c.path)));

    // Nothing secret where page scripts can see it
    const cookies = await ctx.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'pc_session');
    check(`[${m}] session cookie is httpOnly, Secure, SameSite=Lax, path /api/procore`,
      sessionCookie?.httpOnly && sessionCookie.secure && sessionCookie.sameSite === 'Lax' && sessionCookie.path === '/api/procore');
    check(`[${m}] the cookie holds no plain token`, sessionCookie && !sessionCookie.value.includes('at-code') && !sessionCookie.value.includes('rt-code'));
    check(`[${m}] state cookie is gone after the callback`, !cookies.some((c) => c.name === 'pc_state'));
    const exposed = await page.evaluate(() => JSON.stringify({ c: document.cookie, l: { ...localStorage }, s: { ...sessionStorage } }));
    check(`[${m}] no token or secret in document.cookie, localStorage or sessionStorage`,
      !/at-code|rt-code|e2e-client-secret|pc_session/.test(exposed), exposed.slice(0, 120));
    check(`[${m}] no code left in the address bar`, !page.url().includes('code='));
    if (m === 'hash') {
      // Back one step lands on the page before sign-in, not on a callback URL holding the code
      await page.goBack({ waitUntil: 'load' });
      check('[hash] the code is not in the browser history', page.url() === `${SITE}/?companyId=123&projectId=456`, page.url());
      await page.goForward({ waitUntil: 'load' });
    }

    // The same code can't be used twice: replaying the callback is refused
    const replay = await page.evaluate(async (code) => {
      const r = await fetch('/api/procore/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, state: 'x' }) });
      return { status: r.status, body: await r.json() };
    }, `code-${issued}`);
    check(`[${m}] replaying the callback without a matching state is refused`, replay.status === 400 && replay.body.error === 'bad_state', JSON.stringify(replay));
    await ctx.close();
  }

  // A forged callback (no sign-in started in this browser) never reaches Procore's token endpoint
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const n = seen.token.length;
    const r = await page.goto(`${SITE}/api/procore/callback?code=forged&state=forged`);
    check('forged callback: 400 bad_state, no token request', r.status() === 400 && seen.token.length === n);
    await ctx.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('RUN FAILED:', e.message);
  process.exit(1);
});
