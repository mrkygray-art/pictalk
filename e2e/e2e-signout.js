// Sign in, Sign out (it sticks across a reload), then "Use a different Procore account": the header must always
// say who's signed in. The mock plays Procore: a plain sign-in reuses Procore's own login (Edward); a fresh one
// (prompt=login) lets you log in as someone else (Tyler).
// Needs: npm run emulators, and npx vite --port 5176. /api/procore/* mocked in the browser.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const puppeteer = require("puppeteer-core");
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "..", "functions", "package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getAuth } = fnRequire("firebase-admin/auth");
initializeApp({ projectId: "demo-pictalk" });

const APP = "http://localhost:5176/";
const COMPANY = "4291776";
const PROJECT = String(600000 + (Date.now() % 100000));
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "Sandbox Test Project" }];
const USERS = { edward: { procoreUserId: "481274", name: "Edward Gray" }, tyler: { procoreUserId: "900", name: "Tyler Brandt" } };
const PEOPLE = [
  { id: 481274, name: "Edward Gray", firstName: "Edward", lastName: "Gray", title: "Foreman", company: "Son Electric", role: "Foreman", roleSource: "job_title", tag: null },
  { id: 900, name: "Tyler Brandt", firstName: "Tyler", lastName: "Brandt", title: "Site Laborer", company: "Ironbridge Construction Group", role: "Site Laborer", roleSource: "job_title", tag: null },
];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 1200, height: 800 });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  let who = null; // which Procore user the (mocked) Procore cookie belongs to
  let logouts = 0;
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/api/procore/login") { who = u.searchParams.get("fresh") === "1" ? "tyler" : "edward"; return r.respond({ status: 302, headers: { location: `/?companyId=${COMPANY}&projectId=${PROJECT}` } }); }
    if (u.pathname === "/api/procore/logout") { logouts++; who = null; return json(200, { ok: true }); }
    if (!who) return json(401, { error: "not_connected" });
    const me = USERS[who];
    if (u.pathname === "/api/procore/session") return json(200, { token: await getAuth().createCustomToken(`procore_${me.procoreUserId}`, { procoreUserId: me.procoreUserId }), me, projects: PROJECTS });
    if (u.pathname === "/api/procore/directory") return json(200, { people: PEOPLE, canTag: false, labels: [], compact: false, rolesAvailable: true });
    return json(404, { error: "not_found" });
  });
  const header = () => page.$eval(".msg-who", (e) => e.innerText).catch(() => "(no header)");
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(600); };

  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await click("button::-p-text(Sign in with Procore)");
  await page.waitForFunction(() => document.querySelector(".msg-who"), { timeout: 20000 });
  await sleep(1500);
  check("first sign-in: header names Edward", (await header()).includes("Edward Gray"), await header());
  await click("button::-p-text(Sign out)");
  check("Sign out clears SiteSnap's Procore session on the server", logouts === 1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Sign in with Procore"), { timeout: 20000 });
  check("after a reload it's still signed out", !(await page.$(".msg-who")));
  check("the sign-in screen offers another account and says how", (await page.evaluate(() => document.body.innerText)).includes("Use a different Procore account"));
  const popups = [];
  browser.on("targetcreated", (t) => { if (t.type() === "page") popups.push(t.url()); });
  await click("button::-p-text(Use a different Procore account)");
  await page.waitForFunction(() => document.body.innerText.includes("Signing you out of Procore"), { timeout: 5000 }).catch(() => {});
  check("it opens Procore's sign-out page in a small window", popups.some((u) => u.includes("/api/procore/logout")), popups.join(", "));
  await page.waitForFunction(() => document.querySelector(".msg-who"), { timeout: 20000 });
  await sleep(1500);
  check("after Sign out and sign in as Tyler: header names Tyler", (await header()).includes("Tyler Brandt"), await header());
  await page.screenshot({ path: path.join(__dirname, "signout-after.png") });
  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
