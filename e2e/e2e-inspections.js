// Inspections end to end at phone width (sitesnap-inspections-spec.md section 11), against the emulators
// (PICTALK_FAKE_STT=1 for the words, PICTALK_FAKE_AI=1 for the Observation draft), with /api/procore/* mocked in the
// browser like Westgate's Site Safety Inspection #1 (three inspectors, no responsible contractor) and #2 (VoltLine):
// home layout -> Inspection tile -> list (numbers, tabs) -> sections (Set N/A with a confirm) -> one question at a
// time (item numbers, Pass / Fail / N/A at least 56 px, Speak, Photo) -> "Already answered by Dana" -> a 409 while
// sending -> Use Mine -> Speak becomes a note -> Fail -> Choose who -> Create Observation -> next item -> no signal
// keeps answers ("Not synced yet") and sends them when it's back -> reload resumes at the first unanswered item ->
// summary -> Submit. Then the empty and no-permission messages.
// Needs: npm run emulators, and npx vite --port 5177. Screenshots: e2e/inspections-shots/.
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

const APP = process.env.APP_URL || "http://localhost:5177/";
const OUT = path.join(__dirname, "inspections-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const COMPANY = "4291776";
const PROJECT = String(600000 + (Date.now() % 100000));
const KEY = `${COMPANY}_${PROJECT}`;
const ME = "111";
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "Westgate Distribution Center" }];
const DANA = { id: "222", name: "Dana Whitfield" };

const it = (id, sectionId, number, text, extra = {}) => ({ id, sectionId, number, text, details: "", kind: "passfail", options: [], answer: null, required: false, photoRequired: false, noteRequired: false, photos: 0, notes: [], observations: [], ...extra });
function inspection1() {
  return {
    id: "9001", number: 1, name: "[Procore] Site Safety Inspection", title: "[Procore] Site Safety Inspection #1", status: "In progress", closed: false,
    location: null, due: null, progress: { done: 1, total: 6 }, inspectors: [{ id: ME, name: "Edward Gray" }, DANA, { id: "333", name: "Marcus Ortega" }],
    responsibleContractor: null, trade: null, locationId: null, description: "Procore makes no representations… (a long disclaimer)", phrasing: null,
    sections: [
      { id: "50", number: 1, name: "Fall Protection and Perimeter Protection", position: 1, na: false, items: [it("601", "50", "1.1", "Guardrails are installed at open edges"), it("602", "50", "1.2", "Guardrails are installed at open edges")] },
      { id: "51", number: 2, name: "Housekeeping", position: 2, na: false, items: [it("701", "51", "2.1", "Walkways are clear", { answer: { counts: "pass", optionId: null, value: null, by: DANA, at: "2026-10-16T15:00:00Z" } }), it("702", "51", "2.2", "Trash removed daily"), it("703", "51", "2.3", "Materials stacked safely")] },
      { id: "52", number: 3, name: "Cranes and Rigging", position: 3, na: false, items: [it("801", "52", "3.1", "Crane inspection posted")] },
    ],
  };
}
const row = (insp, extra = {}) => ({ id: insp.id, number: insp.number, name: insp.name, title: insp.title, status: insp.status, closed: false, location: insp.location, due: insp.due, progress: insp.progress, inspectors: insp.inspectors, responsibleContractor: insp.responsibleContractor, description: insp.description, ...extra });

(async () => {
  await getFirestore().doc(`procoreProjects/${KEY}/members/${ME}`).set({ procoreUserId: ME, name: "Edward Gray", at: Date.now() });
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGE ERROR:", e.message); });
  let signedIn = false;
  let listMode = "normal"; // normal | empty | denied
  let conflictOnce = true;
  const insp1 = inspection1();
  const posts = [];
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/api/procore/login") { signedIn = true; return r.respond({ status: 302, headers: { location: "/?procore=connected" } }); }
    if (!signedIn) return json(401, { error: "not_connected" });
    if (u.pathname === "/api/procore/session") return json(200, { token: await getAuth().createCustomToken(`procore_${ME}`, { procoreUserId: ME }), me: { procoreUserId: ME, name: "Edward Gray" }, projects: PROJECTS });
    if (u.pathname === "/api/procore/directory") return json(200, { people: [{ id: 111, name: "Edward Gray", company: "Kyco", title: "Project Manager" }, { id: 444, name: "Lena Kowalski", company: "VoltLine Electric", title: "Foreman" }, { id: 222, name: "Dana Whitfield", company: "Kyco", title: "Superintendent" }], canTag: false, labels: [], compact: false, rolesAvailable: true });
    if (u.pathname === "/api/procore/record-options") return json(200, { observationTypes: [{ id: 11036845, name: "Deficiency", category: "Quality" }, { id: 2, name: "Fall Protection", category: "Safety" }], trades: [], locations: [] });
    if (u.pathname === "/api/procore/access") return json(200, { people: {}, levelsKnown: false });
    if (u.pathname === "/api/procore/photo-upload") return json(201, { imageId: 1, albumName: "Field photos" });
    if (u.pathname === "/api/procore/inspections" && r.method() === "GET") {
      if (listMode === "denied") return json(200, { access: false, reason: "Your Procore role can't see Inspections on this project. Ask your project manager for access." });
      if (u.searchParams.get("id") === "9001") return json(200, { access: true, myId: ME, inspection: insp1 });
      if (listMode === "empty") return json(200, { access: true, myCompany: null, groups: { mine: [], company: [], open: [] } });
      const two = row({ ...insp1, id: "9002", number: 2, title: "[Procore] Site Safety Inspection #2", inspectors: [{ id: ME, name: "Edward Gray" }], responsibleContractor: { id: "30", name: "VoltLine Electric" }, location: "Level 2", due: "2026-10-20", progress: { done: 0, total: 87 }, status: "Open" });
      return json(200, { access: true, myCompany: { id: "30", name: "VoltLine Electric" }, groups: { mine: [two, row(insp1)], company: [two], open: [row(insp1, { id: "9003", number: 1, name: "OAC Pre-Drywall Checklist", title: "OAC Pre-Drywall Checklist #1", progress: { done: 0, total: 22 }, status: "Open" })] } });
    }
    if (u.pathname === "/api/procore/inspections" && r.method() === "POST") {
      const b = JSON.parse(r.postData() || "{}");
      posts.push(b);
      const item = insp1.sections.flatMap((s) => s.items).find((x) => x.id === b.itemId);
      if (b.action === "answer") {
        if (b.itemId === "602" && conflictOnce && !b.force) { conflictOnce = false; return json(409, { error: "already_answered", message: "Already answered by Marcus Ortega.", by: { id: "333", name: "Marcus Ortega" }, answer: { counts: "na", by: { id: "333", name: "Marcus Ortega" }, at: "2026-10-16T16:00:00Z" } }); }
        item.answer = { counts: b.answer.counts, optionId: null, value: null, by: { id: ME, name: "Edward Gray" }, at: new Date().toISOString() };
        return json(200, { ok: true, way: "item_response", item });
      }
      if (b.action === "section_na") { insp1.sections.find((s) => s.id === b.sectionId).na = b.na; return json(200, { ok: true, na: b.na, changed: true }); }
      if (b.action === "note") { item.notes = [b.text]; return json(200, { ok: true, saved: true }); }
      if (b.action === "photo") { item.photos += 1; return json(200, { ok: true, photos: item.photos }); }
      if (b.action === "fail") {
        item.answer = { counts: "fail", by: { id: ME, name: "Edward Gray" }, at: new Date().toISOString() };
        item.observations = [{ id: "4001", number: 12, title: b.card.title }];
        return json(201, { recordType: "observation", id: 4001, number: 12, url: "https://sandbox.procore.com/4001", warnings: [], linked: true, itemFailed: true });
      }
      if (b.action === "close") return json(200, { closed: true });
    }
    return json(404, { error: "not_found" });
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
  const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
  const waitPosts = (n) => page.waitForFunction(() => true, { timeout: 100 }).then(async () => { for (let i = 0; i < 60 && posts.length < n; i++) await sleep(250); });

  // 1. Home layout
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await waitText("Sign in with Procore");
  await click("button::-p-text(Sign in with Procore)");
  await waitText("Walk a checklist");
  const tiles = await page.$$eval(".home-tile", (b) => b.map((x) => { const r = x.getBoundingClientRect(); return { name: x.querySelector("strong").textContent.trim(), x: Math.round(r.x), y: Math.round(r.y) }; }));
  check("home: Report an issue | Message, Inspection | Daily log, Project photos alone on the left", tiles.map((t) => t.name).join("|") === "Report an issue|Message|Inspection|Daily log|Project photos", tiles.map((t) => t.name).join("|"));
  const [report, message, inspect, daily, photos] = tiles;
  check("home: two columns, three rows, photos under Inspection", report.y === message.y && inspect.y === daily.y && inspect.y > report.y && photos.y > inspect.y && photos.x === report.x && inspect.x === report.x && message.x > report.x);
  check("home: Inspection tile says Walk a checklist with a checklist icon", (await page.$eval(".home-tile.is-inspect", (e) => e.innerText)).includes("Walk a checklist") && !!(await page.$(".home-tile.is-inspect svg")));
  await shot("0-home");

  // 2. List
  await click(".home-tile.is-inspect");
  await waitText("Site Safety Inspection #1");
  let t = await text();
  check("list: Inspections, the project name, both numbered inspections", t.includes("Inspections") && t.includes("Westgate Distribution Center") && t.includes("Site Safety Inspection #1") && t.includes("Site Safety Inspection #2"));
  check("list: location, due date and progress on the row", t.includes("Level 2") && t.includes("Due Oct 20") && t.includes("0 of 87") && t.includes("1 of 6"));
  check("list: the disclaimer is behind Details, not on the row", !t.includes("Procore makes no representations") && t.includes("Details"));
  check("list: Open on this project shown under Assigned to me", t.includes("Open on this project") && t.includes("OAC Pre-Drywall Checklist #1"));
  await shot("1-list");
  await click("button::-p-text(My company's work)");
  t = await text();
  check("list: My company's work = VoltLine's inspection", t.includes("Site Safety Inspection #2") && !t.includes("Site Safety Inspection #1"));
  await click("button::-p-text(Assigned to me)");

  // 3. Sections
  await click(".insp-row::-p-text(Site Safety Inspection #1)");
  await waitText("Fall Protection and Perimeter Protection");
  t = await text();
  check("sections: one row per section with answered of total", t.includes("1. Fall Protection and Perimeter Protection") && t.includes("0 of 2") && t.includes("1 of 3"));
  check("sections: Pass / Fail / N/A counts per section", (await page.$eval(".insp-section:nth-child(2) .insp-counts", (e) => e.innerText)).includes("1 pass"));
  await shot("2-sections");
  await click(".insp-section:nth-child(3) .insp-na-btn");
  await waitText("Yes, Set Section N/A");
  check("sections: Set N/A asks first", true);
  await shot("3-section-na-confirm");
  await click("button::-p-text(Yes, Set Section N/A)");
  await waitPosts(1);
  check("sections: Set N/A sent to Procore", posts.some((p) => p.action === "section_na" && p.sectionId === "52" && p.na === true));
  await waitText("Not applicable");

  // 4. One question at a time
  check("sections: Continue (someone already answered) resumes at the first unanswered item", (await page.$eval(".insp > .save-btn", (e) => e.textContent)).includes("at 1.1"));
  await click(".insp > .save-btn");
  await waitText("Guardrails are installed at open edges");
  t = await text();
  check("item: section and position, item number, Item 1 of 6, passed count", t.includes("Fall Protection and Perimeter Protection, 1 of 2") && (await page.$eval(".insp-num", (e) => e.textContent)) === "1.1" && t.includes("Item 1 of 6") && t.includes("1 passed"));
  const heights = await page.$$eval(".insp-ans", (b) => b.map((x) => Math.round(x.getBoundingClientRect().height)));
  check("item: Pass / Fail / N/A in one row, at least 56 px tall", heights.length === 3 && heights.every((h) => h >= 56), heights.join(","));
  check("item: Speak, Photo and the helper line", t.includes("Speak") && t.includes("Photo") && t.includes("Say pass, fail, or add a note"));
  await shot("4-item");
  await click(".insp-ans.is-pass");
  await waitText("Item 2 of 6");
  check("item: Pass saved and on to 1.2 (same text, told apart by number)", (await page.$eval(".insp-num", (e) => e.textContent)) === "1.2");
  await click(".insp-ans.is-na");
  await page.waitForSelector(".insp-conflict", { timeout: 25000 });
  t = await text();
  check("conflict: Procore says someone else answered first -> Keep theirs / Use mine", t.includes("Marcus Ortega") && t.includes("Keep Theirs") && t.includes("Use Mine"));
  await shot("5-conflict");
  await click("button::-p-text(Use Mine)");
  await sleep(1500);
  check("conflict: Use Mine sends it anyway", posts.some((p) => p.action === "answer" && p.itemId === "602" && p.force === true));
  check("Pass / N/A skip items someone already answered (2.1 is Dana's): on to 2.2", (await page.$eval(".insp-num", (e) => e.textContent)) === "2.2");
  await click(".insp-top .link-btn"); // back to 2.1
  await page.waitForFunction(() => document.querySelector(".insp-num")?.textContent === "2.1", { timeout: 15000 });
  check("item 2.1 shows Already answered by Dana, with the buttons to keep or change it", (await text()).includes("Already answered by Dana Whitfield: Pass"));
  await shot("6-already-answered");
  await click(".insp-ans.is-pass");

  // 5. Speak: words that aren't a command become a note
  await page.waitForFunction(() => document.querySelector(".insp-num")?.textContent === "2.2", { timeout: 15000 });
  await click("button.insp-tool::-p-text(Speak)");
  await sleep(1500);
  await click("button.insp-tool.is-recording");
  await page.waitForFunction(() => /Test transcript/.test(document.querySelector(".insp-item textarea")?.value ?? ""), { timeout: 40000 }).then(() => check("Speak: the words become a note on the item (shown, editable)", true), () => check("Speak: the words become a note on the item", false, "no transcript (functions emulator?)"));
  await shot("7-note");

  // 6. Fail -> Observation
  await click(".insp-ans.is-fail");
  await page.waitForFunction(() => document.querySelector(".insp-failed-label")?.textContent === "Failed item 2.2", { timeout: 25000 });
  t = await text();
  check("fail: Failed item, the item text, Add photo, transcript box", t.includes("Trash removed daily") && t.includes("Add Photo") && !!(await page.$(".insp-fail textarea")));
  check("fail: Becomes Observation; blank responsible contractor falls back to Choose who", t.includes("Observation") && t.includes("Choose who") && t.includes("No responsible contractor"));
  await shot("8-fail");
  await click("button::-p-text(Choose who)");
  await page.type(".composer input", "Lena");
  await sleep(500);
  await click(".composer button::-p-text(Lena Kowalski)");
  await click(".composer button::-p-text(Done)");
  check("fail: Choose who picks from the project directory", (await text()).includes("Lena Kowalski"));
  await click("button::-p-text(Create Observation)");
  await page.waitForFunction(() => document.querySelector(".insp-num")?.textContent === "2.3", { timeout: 40000 });
  check("fail: after Create Observation the foreman is on the next item", true);
  for (let i = 0; i < 40 && !posts.some((p) => p.action === "fail"); i++) await sleep(250);
  const f = posts.find((p) => p.action === "fail");
  check("fail: the Observation goes with the item, the card and who", !!f && f.itemId === "702" && f.card.recordType === "observation" && f.card.assigneeIds.includes(444) && !!f.card.observationTypeId, f ? JSON.stringify({ title: f.card.title, type: f.card.observationTypeId }) : "none");

  // 7. No signal: answers stay on the phone and go when it's back
  await page.setOfflineMode(true);
  const before = posts.length;
  await click(".insp-ans.is-pass"); // the last open item: on to the summary
  await waitText("Not synced yet");
  check("offline: the answer is kept and shown as Not synced yet", posts.length === before);
  await shot("9-offline");
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => document.querySelector(".insp-saved")?.textContent === "Saved", { timeout: 30000 }).then(() => check("offline: sent when signal returns, then Saved", posts.length > before), () => check("offline: sent when signal returns", false));

  // 8. Reload: resume at the first unanswered item
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText("Walk a checklist");
  await click(".home-tile.is-inspect");
  await click(".insp-row::-p-text(Site Safety Inspection #1)");
  await waitText("Review and Submit").then(() => check("resume: everything answered -> Review and Submit", true), async () => {
    await click("button::-p-text(Continue)");
    check("resume: Continue opens the first unanswered item", (await text()).includes("Item"));
  });

  // 9. Summary and submit
  await click("button::-p-text(Review and Submit)");
  await waitText("Submit Inspection");
  t = await text();
  check("summary: Passed / Failed / N/A counts and the failed item with its Observation", t.includes("Passed") && t.includes("Failed items") && t.includes("Observation #12"));
  await shot("10-summary");
  await click("button::-p-text(Submit Inspection)");
  await waitText("Submitted");
  check("submit: closed in Procore", posts.some((p) => p.action === "close"));
  await click("button::-p-text(Back to Home)");

  // 10. Empty and no-permission states
  listMode = "empty";
  await click(".home-tile.is-inspect");
  await waitText("No inspections assigned to you on this project.");
  check("empty: plain message with Back", (await text()).includes("Back"));
  await shot("11-empty");
  await click(".msg-home-back");
  listMode = "denied";
  await click(".home-tile.is-inspect");
  await waitText("Your Procore role can't see Inspections on this project. Ask your project manager for access.");
  check("no permission: plain message", true);
  await shot("12-denied");

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
