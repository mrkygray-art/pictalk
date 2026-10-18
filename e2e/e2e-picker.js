// Report something picker + home (sitesnap-report-picker-my-items-spec.md, build steps 1-2) at phone width, against
// the emulators, with /api/procore/* mocked in the browser:
// home 3x2 (Report something | Message, My items | Inspection, Daily log | Project photos), "2 assigned" on
// Inspection, no badge on My items yet, no tile moves while the counts load, New pill, picker -> Issue -> the
// existing Report an Issue screen, back to home; then a person Procore refuses Observations and Punch List
// (My items gone, picker explains); then the guest demo (picker still shows Issue).
// Needs: npm run emulators, and npx vite --port 5178. Screenshots: e2e/picker-shots/.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "..", "functions", "package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");
const { getAuth } = fnRequire("firebase-admin/auth");
initializeApp({ projectId: "demo-pictalk" });

const APP = process.env.APP_URL || "http://localhost:5178/";
const OUT = path.join(__dirname, "picker-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const COMPANY = "4291776";
const PROJECT = String(700000 + (Date.now() % 100000));
const KEY = `${COMPANY}_${PROJECT}`;
const ME = "111";
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "Westgate Distribution Center" }];
const TOOLS = ["observations", "punch_list", "rfis", "change_events", "daily_log", "incidents", "inspections", "directory", "photos"];
const caps = (denied = []) => ({ tools: Object.fromEntries(TOOLS.map((t) => [t, { state: denied.includes(t) ? "denied" : "available", canCreate: null, source: "probe" }])), manifest: { status: 404 } });
const insp = (id, closed = false) => ({ id, number: Number(id), title: `Inspection #${id}`, closed, inspectors: [{ id: ME, name: "Edward Morton" }], progress: { done: 0, total: 3 } });

async function run(browser, mode) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGE ERROR:", e.message); });
  let signedIn = false;
  const capCalls = [];
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/api/procore/login") { signedIn = true; return r.respond({ status: 302, headers: { location: "/?procore=connected" } }); }
    if (!signedIn) return json(401, { error: "not_connected" });
    if (u.pathname === "/api/procore/session") return json(200, { token: await getAuth().createCustomToken(`procore_${ME}`, { procoreUserId: ME, ...(mode === "demo" ? { demo: true } : {}) }), me: { procoreUserId: ME, name: mode === "demo" ? "Guest" : "Edward Morton" }, projects: PROJECTS, demo: mode === "demo" });
    if (u.pathname === "/api/procore/directory") return json(200, { people: [{ id: 111, name: "Edward Morton", company: "SiteSnap AI", title: "Developer" }], canTag: false, labels: [], compact: false, rolesAvailable: true });
    if (u.pathname === "/api/procore/capabilities") {
      capCalls.push(u.search);
      return json(200, mode === "nopunch" ? caps(["observations", "punch_list"]) : mode === "demo" ? caps(["change_events", "daily_log"]) : caps());
    }
    if (u.pathname === "/api/procore/inspections") {
      await sleep(1200); // counts arrive after the tiles are drawn
      return json(200, { access: true, myCompany: null, groups: { mine: [insp("1"), insp("2"), insp("3", true)], company: [], open: [] } });
    }
    if (u.pathname === "/api/procore/record-options") return json(200, { observationTypes: [{ id: 1, name: "Deficiency", category: "Quality" }], trades: [], locations: [] });
    if (u.pathname === "/api/procore/access") return json(200, { people: {}, levelsKnown: false });
    return json(404, { error: "not_found" });
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${mode}-${n}.png`), fullPage: true });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
  const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
  const tiles = () => page.$$eval(".home-tile", (b) => b.map((x) => { const r = x.getBoundingClientRect(); return { name: x.querySelector("strong").childNodes[0].textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; }));

  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await waitText("Sign in with Procore");
  await click("button::-p-text(Sign in with Procore)");
  await waitText("Report something");
  await sleep(200);
  const before = await tiles();

  if (mode === "full") {
    check("home: 3x2 in the spec's order", before.map((t) => t.name).join("|") === "Report something|Message|My items|Inspection|Daily log|Project photos", before.map((t) => t.name).join("|"));
    const [rep, msg, my, ins, log, ph] = before;
    check("home: two columns, three rows", rep.y === msg.y && my.y === ins.y && log.y === ph.y && rep.y < my.y && my.y < log.y && rep.x === my.x && my.x === log.x && msg.x > rep.x && msg.x === ins.x && ins.x === ph.x);
    check("home: tile words from the spec", (await text()).includes("Issue, safety, delay, RFI, extra work") && (await text()).includes("Assigned to you, close out by voice"));
    check("home: New pill on My items", await page.$eval(".home-tile.is-new", (e) => e.innerText.includes("New")).catch(() => false));
    await waitText("2 assigned");
    const after = await tiles();
    check("home: Inspection shows 2 assigned (open ones only)", (await page.$eval(".home-tile.is-inspect", (e) => e.innerText)).includes("2 assigned"));
    check("home: no tile moved or changed height when the counts arrived", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after.map((t) => t.h)));
    check("home: My items has no count yet (hidden, not 0)", !(await page.$eval(".home-tile.is-new", (e) => e.innerText)).match(/\d+ open/));
    check("home: Daily log keeps Not sent today", (await page.$eval(".home-tile.is-log", (e) => e.innerText)).includes("Not sent today"));
    await shot("0-home");

    await click(".home-tile.is-issue");
    await waitText("What are you reporting?");
    const rows = await page.$$eval(".rp-row strong", (b) => b.map((x) => x.childNodes[0].textContent.trim()));
    check("picker: only the built type (Issue) so far", rows.join("|") === "Issue", rows.join("|"));
    check("picker: footer line", (await text()).includes("Every type starts the same way: photo, then speak."));
    await shot("1-picker");
    await click(".msg-home-back");
    await waitText("Report something");
    check("picker: back arrow returns home", !(await text()).includes("What are you reporting?"));
    check("capabilities asked once per project, then kept", capCalls.length === 1, String(capCalls.length));
    await click(".home-tile.is-issue");
    await click(".rp-row");
    await waitText("Report an Issue");
    check("picker: Issue opens the existing Report an Issue screen", true);
    await shot("2-issue");
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await waitText("Report something");
    await click(".home-tile.is-new");
    await waitText("Coming next");
    check("My items: placeholder screen until Step 3", true);
  }

  if (mode === "nopunch") {
    check("no Observations and no Punch List: My items tile hidden", !before.some((t) => t.name === "My items"), before.map((t) => t.name).join("|"));
    await click(".home-tile.is-issue");
    await waitText("What are you reporting?");
    check("no usable type: plain ask-your-admin line, no greyed rows", (await page.$$(".rp-row")).length === 0 && (await text()).includes("Ask your project admin"));
    await shot("1-picker");
  }

  if (mode === "demo") {
    check("demo: My items still shows", before.some((t) => t.name === "My items"));
    await click(".home-tile.is-issue");
    await waitText("What are you reporting?");
    check("demo: Issue row shows even though the guest can't create", (await page.$$(".rp-row")).length === 1);
    await shot("1-picker");
  }
  check(`${mode}: no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

(async () => {
  await getFirestore().doc(`procoreProjects/${KEY}/members/${ME}`).set({ procoreUserId: ME, name: "Edward Morton", at: Date.now() });
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    for (const mode of ["full", "nopunch", "demo"]) await run(browser, mode);
  } catch (err) {
    console.log("FAIL  crashed:", err.message);
    results.push(false);
  } finally {
    await browser.close();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
