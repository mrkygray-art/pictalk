// Daily log by voice end to end at phone width, against the emulators (PICTALK_FAKE_AI=1 for the organizer,
// PICTALK_FAKE_STT=1 for the words), with /api/procore/* mocked in the browser: the Daily log tile -> talk ->
// type the spec's sentence -> a photo -> Organize My Log -> the four cards (Check this on the 10 o'clock delivery)
// -> fix it -> Send (asks about the manpower already logged today) -> one entry at a time, Procore busy once ->
// all in -> the tile says Sent today. Then a person without Daily Log access sees the plain message.
// Needs: npm run emulators, and npx vite --port 5176. Screenshots: e2e/dailylog-shots/.
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
const OUT = path.join(__dirname, "dailylog-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const COMPANY = "4291776";
const PROJECT = String(500000 + (Date.now() % 100000));
const KEY = `${COMPANY}_${PROJECT}`;
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "1234 - Sandbox Test Project" }];
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const OPTIONS = {
  access: true, timeZone: "America/Los_Angeles", today: TODAY, date: TODAY,
  myCompany: { id: 10, name: "Ironbridge Construction" },
  companies: [{ id: 10, name: "Ironbridge Construction" }, { id: 11, name: "Summit Framing" }, { id: 13, name: "ABC Ready Mix" }],
  locations: [{ id: 50, name: "Level 2" }],
  delayTypes: [{ id: 1, name: "Weather" }, { id: 2, name: "Material" }],
  existing: { manpower: [{ id: 7, companyId: 10, companyName: "Ironbridge Construction", workers: 4, status: "pending" }] },
};

(async () => {
  await getFirestore().doc(`procoreProjects/${KEY}/members/481274`).set({ procoreUserId: "481274", name: "Chloe Abara", at: Date.now() });
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGE ERROR:", e.message); });
  let signedIn = false;
  let access = true;
  const posts = [];
  let busyOnce = true;
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/api/procore/login") { signedIn = true; return r.respond({ status: 302, headers: { location: "/?procore=connected" } }); }
    if (!signedIn) return json(401, { error: "not_connected" });
    if (u.pathname === "/api/procore/session") return json(200, { token: await getAuth().createCustomToken("procore_481274", { procoreUserId: "481274" }), me: { procoreUserId: "481274", name: "Chloe Abara" }, projects: PROJECTS });
    if (u.pathname === "/api/procore/directory") return json(200, { people: [{ id: 481274, name: "Chloe Abara", company: "Ironbridge Construction", title: "Foreman" }], canTag: false, labels: [], compact: false, rolesAvailable: true });
    if (u.pathname === "/api/procore/daily-log" && r.method() === "GET") {
      return json(200, access ? OPTIONS : { access: false, reason: "You don't have permission to use the Daily Log on this project.", timeZone: "America/Los_Angeles", today: TODAY, date: TODAY });
    }
    if (u.pathname === "/api/procore/daily-log" && r.method() === "POST") {
      const b = JSON.parse(r.postData() || "{}");
      if (b.section === "delays" && busyOnce) { busyOnce = false; return json(429, { error: "busy", message: "Procore is busy, trying again in a moment.", retryAfter: 2 }); }
      posts.push({ section: b.section, entry: b.entry, date: b.date, photos: (b.photos ?? []).length, entryId: b.entryId });
      return json(201, { id: 900 + posts.length, section: b.section, status: "pending", duplicate: false });
    }
    return json(404, { error: "not_found" });
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
  const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);

  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await waitText("Sign in with Procore");
  await click("button::-p-text(Sign in with Procore)");
  await waitText("Daily log");
  const tiles = await page.$$eval(".home-tile strong", (b) => b.map((x) => x.textContent.trim()));
  check("home: Report an issue | Message | Project photos | Daily log", tiles.join("|") === "Report an issue|Message|Project photos|Daily log", tiles.join("|"));
  check("the Daily log tile says nothing was sent today", (await text()).includes("Not sent today"));
  await shot("0-home");

  await click(".home-tile.is-log");
  await waitText("Say who was on site");
  check("capture: the date chip says Today", (await page.$eval(".dl-date", (e) => e.textContent)).startsWith("Today"));
  check("capture: Organize waits for words", await page.$eval("button.save-btn", (e) => e.disabled));
  await click("button::-p-text(Tap to Talk)");
  await sleep(1500);
  await click("button.talk-btn.is-recording");
  await page.waitForFunction(() => /Test transcript/.test(document.querySelector("textarea")?.value ?? ""), { timeout: 30000 });
  check("Tap to Talk: the words appear", true);
  await page.$eval("textarea", (e) => { e.focus(); e.select(); });
  await page.keyboard.press("Backspace");
  await page.type("textarea", "Six guys on site, drywall delayed waiting on materials, forklift delivery at 10.");
  const photo = path.join(OUT, "photo.jpg");
  const b64 = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 600; const g = c.getContext("2d"); g.fillStyle = "#9a8"; g.fillRect(0, 0, 800, 600); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, "base64"));
  const [chooser] = await Promise.all([page.waitForFileChooser(), click("button::-p-text(Add Photos)")]);
  await chooser.accept([photo]);
  await page.waitForFunction(() => document.querySelectorAll(".msg-photos img").length === 1, { timeout: 10000 });
  check("capture: draft saved on this phone", (await text()).includes("Draft saved on this phone"));
  await shot("1-capture");

  // Leaving and coming back keeps the draft (B8)
  await click("button::-p-text(Home)");
  await waitText("Draft in progress");
  check("home: the tile says Draft in progress", true);
  await click(".home-tile.is-log");
  await page.waitForFunction(() => /forklift delivery at 10/.test(document.querySelector("textarea")?.value ?? "") && document.querySelectorAll(".msg-photos img").length === 1, { timeout: 15000 });
  check("the draft (words and photo) is still there after leaving", true);

  await click("button::-p-text(Organize My Log)");
  await waitText("Check your log", 30000);
  const t = await text();
  check("review: four sections", ["Manpower", "Delays", "Deliveries", "Notes"].every((s) => t.includes(s)));
  check("review: 6 workers for my own company", t.includes("6 workers") && await page.$eval(".dl-sec select", (e) => e.options[e.selectedIndex].textContent === "Ironbridge Construction (yours)"));
  check("review: shows where each entry came from", t.includes("You said “six guys"));
  check("review: the delay type is from the project's list", await page.evaluate(() => [...document.querySelectorAll(".dl-sec select")].some((s) => s.value === "Material")));
  check("review: the 10 o'clock delivery says Check this (AM or PM)", t.includes("1 thing to check") && t.includes("10:00 AM") && t.includes("10:00 PM"));
  check("review: no technical words", !/undefined|null|json|needs_confirmation/i.test(t));
  await shot("2-review");

  await click("button::-p-text(Send 3 entries to Procore)");
  check("Send with an open Check this asks first", (await text()).includes("1 thing still says Check this. Send anyway?"));
  await click(".dl-ask button::-p-text(Fix them)");
  await click(".dl-chips button::-p-text(10:00 AM)");
  check("one tap fixes it", !(await text()).includes("thing to check") && await page.evaluate(() => [...document.querySelectorAll('input[type="time"]')].some((i) => i.value === "10:00")));
  // Move the photo onto the delay
  await click(".dl-photos button");
  await click(".dl-sheet-list button::-p-text(Delays)");
  check("the photo now goes with the delay", (await text()).includes("With Delay:"));

  await click("button::-p-text(Send 3 entries to Procore)");
  check("asks about the manpower already logged today (B6)", (await text()).includes("You already logged 4 workers for Ironbridge Construction"));
  await shot("3-dup");
  await click("button::-p-text(Add anyway)");
  await waitText("Procore is busy, trying again in a moment.", 15000);
  check("a 429 shows the busy message and tries again by itself", true);
  await waitText("All 3 entries are in Procore", 30000);
  await shot("4-sent");
  const order = posts.map((p) => p.section).join(",");
  check("entries go one at a time, in order", order === "manpower,delays,deliveries", order);
  const m = posts.find((p) => p.section === "manpower")?.entry ?? {};
  check("manpower sent: 6 workers, my company, the day", m.workers === 6 && m.company === 10 && posts[0].date === TODAY, JSON.stringify(m));
  const dv = posts.find((p) => p.section === "deliveries")?.entry ?? {};
  check("delivery sent at 10:00 (the fixed time)", dv.time === "10:00" && /forklift/i.test(dv.what), JSON.stringify(dv));
  check("the photo went with the delay", posts.find((p) => p.section === "delays")?.photos === 1 && posts.find((p) => p.section === "deliveries")?.photos === 0);
  check("each entry shows Waiting on approval", (await page.$$eval(".dl-res.is-sent", (l) => l.length)) === 3 && (await text()).includes("waiting on approval"));
  await click("button::-p-text(Back to the project)");
  await waitText("Sent today · 3 entries");
  check("home: Sent today · 3 entries; the draft is gone", !(await text()).includes("Draft in progress"));

  // A person without Daily Log access (B7)
  access = false;
  await click(".home-tile.is-log");
  await waitText("You don't have permission to use the Daily Log on this project.");
  check("no access: a plain message, no capture screen", !(await text()).includes("Tap to Talk"));
  await shot("5-locked");

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
