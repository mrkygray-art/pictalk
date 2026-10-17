// Project photos with 100 photos at phone width, against the emulators, with /api/procore/* mocked in the browser:
// By day groups by the day each photo was taken, a day shows 9 photos with "See all N", the tabs + Snap bar and
// the day header stay pinned while scrolling, more photos load as you scroll, Go to a day opens a day's photos.
// Needs: npm run emulators, and npx vite --port 5176. Screenshots: e2e/photos-shots/.
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

const APP = "http://localhost:5176/";
const OUT = path.join(__dirname, "photos-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const COMPANY = "4291776";
const PROJECT = String(600000 + (Date.now() % 100000));
const KEY = `${COMPANY}_${PROJECT}`;
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "Lakeview Elementary Modernization" }];
const TZ = "America/Los_Angeles";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const dayIso = (n, hour) => { const d = new Date(`${TODAY}T${String(hour).padStart(2, "0")}:00:00-07:00`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString(); };
// 100 photos: 40 today, 25 two days ago, 20 five days ago, 15 nine days ago. Two of today's uploads were taken 9 days ago.
const PHOTOS = [];
const plan = [[0, 40], [2, 25], [5, 20], [9, 15]];
let id = 1000;
for (const [n, count] of plan) for (let i = 0; i < count; i++) {
  const created = dayIso(n, 8 + (i % 9));
  PHOTOS.push({ id: id++, albumId: 7, albumName: "Field photos", albumPrivate: false, description: `Photo ${id}`, by: "Derek Lawson", createdAt: created, takenAt: created, location: null, trades: [], thumb: `/api/procore/photo-file?i=${id}`, full: `/api/procore/photo-file?i=${id}`, linked: null });
}
PHOTOS[0].takenAt = dayIso(9, 7); PHOTOS[1].takenAt = dayIso(9, 7);
PHOTOS.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const PER = 48;

(async () => {
  await getFirestore().doc(`procoreProjects/${KEY}/members/481274`).set({ procoreUserId: "481274", name: "Derek Lawson", at: Date.now() });
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGE ERROR:", e.message); });
  const jpeg = await (async () => {
    const p = await browser.newPage();
    const b64 = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 120; c.height = 120; const g = c.getContext("2d"); g.fillStyle = "#7a8a6a"; g.fillRect(0, 0, 120, 120); g.fillStyle = "#c9a227"; g.fillRect(20, 20, 80, 50); return c.toDataURL("image/jpeg", 0.7).split(",")[1]; });
    await p.close();
    return Buffer.from(b64, "base64");
  })();
  let signedIn = false;
  const reads = [];
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/api/procore/login") { signedIn = true; return r.respond({ status: 302, headers: { location: "/?procore=connected" } }); }
    if (!signedIn) return json(401, { error: "not_connected" });
    if (u.pathname === "/api/procore/session") return json(200, { token: await getAuth().createCustomToken("procore_481274", { procoreUserId: "481274" }), me: { procoreUserId: "481274", name: "Derek Lawson" }, projects: PROJECTS });
    if (u.pathname === "/api/procore/directory") return json(200, { people: [{ id: 481274, name: "Derek Lawson", company: "ClearFlow Plumbing & Mechanical", title: "Plumbing Foreman" }], canTag: false, labels: [], compact: false, rolesAvailable: true });
    if (u.pathname === "/api/procore/photo-file") return r.respond({ status: 200, contentType: "image/jpeg", body: jpeg });
    if (u.pathname === "/api/procore/photos") {
      const view = u.searchParams.get("view");
      if (view === "albums") return json(200, { albums: [{ id: 7, name: "Field photos", count: 100, private: false, updatedAt: PHOTOS[0].createdAt, cover: PHOTOS[0].thumb }] });
      const pg = Number(u.searchParams.get("page") || 1);
      const day = u.searchParams.get("day");
      reads.push({ page: pg, day });
      let list = PHOTOS;
      if (day) { // like the server: added that day or the next
        const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        const nd = next.toISOString().slice(0, 10);
        list = PHOTOS.filter((p) => { const d = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(p.createdAt)); return d === day || d === nd; });
      }
      const slice = list.slice((pg - 1) * PER, pg * PER);
      return json(200, { photos: slice, page: pg, nextPage: pg * PER < list.length ? pg + 1 : null, total: list.length, timeZone: TZ });
    }
    return json(404, { error: "not_found" });
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
  const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);

  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await waitText("Sign in with Procore");
  await click("button::-p-text(Sign in with Procore)");
  await waitText("Project photos");
  await click(".home-tile::-p-text(Project photos)");
  await page.waitForFunction(() => document.querySelectorAll(".ph-group").length > 0, { timeout: 20000 });
  await sleep(500);
  await shot("1-top");
  const heads = await page.$$eval(".ph-group h3", (l) => l.map((h) => h.innerText.replace(/\s+/g, " ").trim()));
  check("By day: first page groups by day, newest first", heads[0].startsWith("Today") && heads.length >= 2, heads.join(" | "));
  check("days that may get more on the next page say N+", /^Today 38 photos$/.test(heads[0]) && heads.slice(1).every((h) => /\d\+ photos/.test(h)), heads.join(" | "));
  const firstGrid = await page.$$eval(".ph-group", (g) => g[0].querySelectorAll(".ph-grid img").length);
  check("a day shows at most 9 photos", firstGrid === 9, String(firstGrid));
  check("See all on a big day", /See all 38 photos ›/.test(await text()), "today: 40 added, 2 taken 9 days ago");
  check("Go to a day box on By day", !!(await page.$('.ph-jump input[type="date"]')));

  // Scroll down: the bar and the current day header stay pinned
  await page.evaluate(() => window.scrollTo(0, 900));
  await sleep(500);
  const pinned = await page.evaluate(() => {
    const bar = document.querySelector(".ph-bar").getBoundingClientRect();
    const hs = [...document.querySelectorAll(".ph-group h3")].map((h) => h.getBoundingClientRect().top);
    return { bar: Math.round(bar.top), snapVisible: document.querySelector(".ph-bar .ph-snap").getBoundingClientRect().top < 80, headerUnderBar: hs.some((t) => Math.abs(t - 64) < 6) };
  });
  check("scrolling: the tabs + Snap bar stays at the top", pinned.bar === 0 && pinned.snapVisible, JSON.stringify(pinned));
  check("scrolling: the day header pins under the bar", pinned.headerUnderBar, JSON.stringify(pinned));
  await shot("2-scrolled");

  // Keep scrolling: page 2 loads by itself, and the old camera-roll photos land on their taken day
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => !document.body.innerText.includes("Loading photos"), { timeout: 15000 }).catch(() => {});
  await sleep(1200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1200);
  check("scrolling to the end loads more by itself", reads.filter((x) => !x.day).length >= 2, JSON.stringify(reads));
  const all = await page.$$eval(".ph-group h3", (l) => l.map((h) => h.innerText.replace(/\s+/g, " ")));
  check("all 100 photos grouped into 4 days", all.length === 4 && /17 photos/.test(all[3]), all.join(" | "));
  await shot("3-end");

  // See all
  await page.evaluate(() => window.scrollTo(0, 0));
  await click(".ph-all");
  await waitText("Photos");
  await page.waitForFunction(() => document.querySelectorAll(".ph-grid img").length >= 38, { timeout: 15000 });
  check("See all: the whole day, 38 photos", (await page.$$(".ph-grid img")).length === 38 && (await page.$eval(".page-title", (e) => e.textContent)) === "Today");
  check("See all: Snap is still there", !!(await page.$(".ph-snap")));
  await shot("4-see-all");
  await click("button::-p-text(Photos)");
  await page.waitForFunction(() => document.querySelectorAll(".ph-group").length > 0, { timeout: 15000 });

  // Go to a day: 9 days ago (15 + the 2 taken that day but added today)
  const d9 = (() => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 9); return d.toISOString().slice(0, 10); })();
  await page.click('.ph-jump input[type="date"]');
  await page.keyboard.type(`${d9.slice(5, 7)}${d9.slice(8, 10)}${d9.slice(0, 4)}`);
  await page.waitForFunction(() => /\d+ photos?/.test(document.querySelector(".ph-muted")?.textContent ?? "") && document.querySelectorAll(".ph-grid img").length > 0, { timeout: 15000 });
  await sleep(500);
  const n9 = await page.$$(".ph-grid img");
  check("Go to a day: that day's photos, including ones added later", n9.length === 17, String(n9.length));
  check("Go to a day: read by that day", reads.some((x) => x.day === d9));
  await shot("5-go-to-day");

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
