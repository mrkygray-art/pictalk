// Report an Issue (voice + photo -> Procore record) end to end at phone width, against the emulators
// (PICTALK_FAKE_AI=1 for the classifier, PICTALK_FAKE_STT=1 for the words), with /api/procore/* mocked in the
// browser: photo + voice + words -> Fill It In -> the card (Punch Item for Lisa Hubbard, due Friday) ->
// Send to Procore (checks what the server is sent) -> Sent screen -> the thread with its Procore link.
// Needs: npm run emulators, and npx vite --port 5176. Screenshots: e2e/report-shots/.
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
const OUT = path.join(__dirname, "report-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const COMPANY = "4291776";
const PROJECT = String(500000 + (Date.now() % 100000));
const KEY = `${COMPANY}_${PROJECT}`;
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "1234 - Sandbox Test Project" }];
const PEOPLE = [
  { id: 481274, name: "Edward Gray", firstName: "Edward", lastName: "Gray", title: "Foreman", company: "Son Electric", role: "Foreman", roleSource: "job_title", tag: null },
  { id: 900, name: "Lisa Hubbard", firstName: "Lisa", lastName: "Hubbard", title: "Drywall Foreman", company: "ABC Drywall", role: "Drywall Foreman", roleSource: "job_title", tag: null },
  { id: 902, name: "Jim Henson", firstName: "Jim", lastName: "Henson", title: "Superintendent", company: "Kyco", role: "Superintendent", roleSource: "job_title", tag: null },
];
const OPTIONS = {
  observationTypes: [{ id: 11036845, name: "Deficiency", category: "Quality" }, { id: 11036851, name: "Safety Hazard", category: "Safety" }],
  trades: [{ id: 2, name: "Drywall" }, { id: 6, name: "Painting" }],
  locations: [],
  canObservations: true,
};
// The coming Friday (the classifier's rule: said on a Friday, it's next week's)
const friday = (() => { const d = new Date(); const add = (5 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + add); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

(async () => {
  for (const id of ["481274", "900", "902"]) await getFirestore().doc(`procoreProjects/${KEY}/members/${id}`).set({ procoreUserId: id, name: PEOPLE.find((p) => String(p.id) === id).name, at: Date.now() });
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  let signedIn = false;
  let sentToServer = null;
  const statusCalls = [];
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/api/procore/login") { signedIn = true; return r.respond({ status: 302, headers: { location: "/?procore=connected" } }); }
    if (!signedIn) return json(401, { error: "not_connected" });
    if (u.pathname === "/api/procore/session") return json(200, { token: await getAuth().createCustomToken("procore_481274", { procoreUserId: "481274" }), me: { procoreUserId: "481274", name: "Edward Gray" }, projects: PROJECTS });
    if (u.pathname === "/api/procore/directory") return json(200, { people: PEOPLE, canTag: false, labels: [], compact: false, rolesAvailable: true });
    if (u.pathname === "/api/procore/record-options") return json(200, OPTIONS);
    // Jim Henson's template has no Punch List access (what an admin's visit saved)
    if (u.pathname === "/api/procore/access") return json(200, { levelsKnown: true, levelsAt: Date.now(), observationList: true, people: {
      481274: { template: "Project Manager - Internal", punch_item: { ok: true, why: "" }, observation: { ok: true, why: "" } },
      900: { template: "Subcontractor - External", punch_item: { ok: true, why: "" }, observation: { ok: true, why: "" } },
      902: { template: "Owner/Client - External", punch_item: { ok: false, why: '"Owner/Client - External" has no access to Punch List' }, observation: { ok: false, why: '"Owner/Client - External" has no access to Observations' } },
    } });
    if (u.pathname === "/api/procore/records") {
      sentToServer = JSON.parse(r.postData());
      return json(201, { recordType: sentToServer.card.recordType, id: 196900, number: 2, url: `https://sandbox.procore.com/${PROJECT}/project/punch_list/196900`, warnings: [], reporterName: "Edward Gray" });
    }
    // Step 4: the server reads / changes the record in Procore and writes the thread (stood in for here)
    if (u.pathname === "/api/procore/record-status") {
      const input = r.method() === "POST" ? JSON.parse(r.postData()) : Object.fromEntries(u.searchParams);
      statusCalls.push({ method: r.method(), action: input.action ?? null });
      const ref = getFirestore().doc(`procoreProjects/${KEY}/conversations/${input.cid}`);
      if (input.action === "close") {
        await ref.collection("messages").add({ authorId: "481274", authorName: "Edward Gray", text: "", transcript: "", transcriptStatus: "none", photos: [], voicePath: null, voiceType: null, aiDescription: null, event: "closed", via: "procore", clientCreatedAt: Date.now(), createdAt: Date.now() });
        await ref.set({ status: "closed", statusBy: "481274", statusAt: Date.now(), procoreStatus: { value: "closed", label: "Closed", closed: true, at: Date.now() } }, { merge: true });
        return json(200, { status: { value: "closed", label: "Closed", closed: true }, threadStatus: "closed" });
      }
      await ref.set({ procoreStatus: { value: "open", label: "Open", closed: false, at: Date.now() } }, { merge: true });
      return json(200, { status: { value: "open", label: "Open", closed: false }, threadStatus: "open" });
    }
    return json(404, { error: "not_found" });
  });
  const shot = (n, full = true) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
  const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);

  // Without the beta switch: no Report an Issue
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await waitText("Sign in with Procore");
  await click("button::-p-text(Sign in with Procore)");
  await waitText("New Message");
  check("hidden unless turned on: no Report an Issue for everyone else", !(await text()).includes("Report an Issue"));
  // Turn it on for this phone
  await page.goto(`${APP}?beta=report`, { waitUntil: "domcontentloaded" });
  await waitText("Report an Issue");
  check("?beta=report shows Report an Issue on this phone", true);
  check("the two buttons say what they do", (await text()).includes("Creates a Procore Observation or Punch Item") && (await text()).includes("Stays in SiteSnap. Nothing goes to Procore."));
  await click("button::-p-text(Report an Issue)");
  await waitText("Take a photo and say what you see");

  const photo = path.join(OUT, "photo.jpg");
  const b64 = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 900; const g = c.getContext("2d"); g.fillStyle = "#9a8"; g.fillRect(0, 0, 1200, 900); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, "base64"));
  const [chooser] = await Promise.all([page.waitForFileChooser(), click("button::-p-text(Take Photo)")]);
  await chooser.accept([photo]);
  await sleep(500);
  await click("button::-p-text(Tap to Talk)");
  await sleep(1500);
  await click("button.talk-btn.is-recording");
  await page.waitForFunction(() => /Test transcript/.test(document.querySelector("textarea")?.value ?? ""), { timeout: 30000 });
  check("Tap to Talk: the words appear and can be edited", true);
  // What the foreman "said" (the stand-in speech-to-text can't hear the fake mic, so type it)
  await page.$eval("textarea", (e) => { e.focus(); e.select(); });
  await page.keyboard.press("Backspace");
  await page.type("textarea", "Tell Lisa the drywall in room 204 needs to be redone by Friday");
  await shot("1-capture");
  await click("button::-p-text(Fill It In)");
  await waitText("Send to Procore", 30000);
  const t = await text();
  const typeOn = await page.$eval(".report-type button.is-on", (e) => e.textContent);
  check("the card: Punch Item picked by the AI", typeOn === "Punch Item", typeOn);
  check("the card: Lisa Hubbard suggested from the project directory", t.includes("Lisa Hubbard"));
  const due = await page.$eval('input[type="date"]', (e) => e.value);
  check("the card: due the coming Friday", due === friday, `${due} vs ${friday}`);
  const trade = await page.$eval("select.dir-input", (e) => e.options[e.selectedIndex]?.textContent);
  check("the card: trade Drywall from the project's list", trade === "Drywall", trade);
  check("the card: where it is, as said", await page.$eval(".report-card input.dir-input:not([type])", () => true) && (await page.evaluate(() => [...document.querySelectorAll(".report-card input")].some((i) => i.value === "room 204"))));
  check("the card says where it goes", t.includes("Goes to Procore's Punch List"));
  check("no technical words on the card", !/record_type|json|confidence|undefined|null/i.test(t));
  await shot("2-card");
  // Step 2 (permissions): the picker marks who Procore won't take; picking them warns on the card
  await click("button::-p-text(Change)");
  await page.waitForFunction(() => document.querySelector(".dir-note"), { timeout: 15000 });
  const note = await page.$eval(".dir-person.is-limited", (e) => e.innerText);
  check("permissions: the picker marks Jim Henson (no Punch List access)", note.includes("Jim Henson") && note.includes("Can't get Punch Items in Procore"), note.replace(/\s+/g, " "));
  check("permissions: people Procore takes aren't marked", (await page.$$(".dir-person.is-limited")).length === 1);
  await click(".dir-person.is-limited");
  await shot("2b-picker");
  await click("button.dir-done");
  await waitText("It will go in unassigned");
  check("permissions: the card warns before sending", (await text()).includes("Jim Henson can't get Punch Items in Procore"));
  await click("button::-p-text(Change)");
  await click(".dir-person.is-limited");
  await click("button.dir-done");
  check("permissions: the warning goes when he's taken off", !(await text()).includes("It will go in unassigned"));

  await click("button::-p-text(Send to Procore)");
  await waitText("Sent to Procore", 30000);
  const done = await text();
  check("Sent screen: Punch Item #2 with Open in Procore", done.includes("Punch Item #2") && done.includes("Open in Procore"));
  check("Sent screen: says plainly where it went (Punch List, not Observations)", done.includes("Created in Procore") && done.includes("Find it in Procore's Punch List tool, not Observations"));
  check("Sent screen: says Lisa gets Procore's email", done.includes("Lisa Hubbard will get Procore's email"));
  const sc = sentToServer?.card ?? {};
  check("server was sent the confirmed card", sc.recordType === "punch_item" && sc.assigneeIds?.[0] === 900 && sc.dueDate === friday && sc.tradeId === 2, JSON.stringify({ t: sc.recordType, a: sc.assigneeIds, d: sc.dueDate, tr: sc.tradeId }));
  check("server was sent the photo and the voice note", (sentToServer?.files ?? []).map((f) => f.type.split("/")[0]).join(",") === "image,audio", (sentToServer?.files ?? []).map((f) => f.type).join(","));
  check("server was sent the words as said", sentToServer?.card?.transcript === "Tell Lisa the drywall in room 204 needs to be redone by Friday");
  await shot("3-sent");

  await click("button::-p-text(Open the Thread)");
  await page.waitForFunction(() => document.body.innerText.includes("Procore Punch List #2"), { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector(".msg .msg-photo-grid img"), { timeout: 30000 });
  const th = await text();
  check("the thread follows the record: Procore Punch List #2 link, To Lisa Hubbard", th.includes("Open in Procore") && th.includes("To: Lisa Hubbard"));
  check("the thread's first message is the capture (photo + words)", th.includes("needs to be redone"));
  await page.waitForFunction(() => document.querySelector(".msg-task"), { timeout: 30000 });
  const task = await page.$eval(".msg-task", (e) => e.innerText);
  check("Step 4: the record became Lisa's to-do with its due date", task.includes("Lisa Hubbard") && /Fri/.test(task), task.replace(/\s+/g, " "));
  await waitText("· Open", 20000);
  check("Step 4: opening the thread checks Procore and shows its status", statusCalls.some((c) => c.method === "GET"));
  check("Step 4: the thread's Close button says Close in Procore", (await text()).includes("Close in Procore"));
  await shot("4-thread");
  await click("button::-p-text(Close in Procore)");
  await waitText("Reopen", 20000);
  check("Step 4: Close in Procore closes it there (server asked to close) and the thread shows closed", statusCalls.some((c) => c.action === "close"));
  await shot("5-closed");
  await click("button::-p-text(Messages)");
  await page.waitForFunction(() => document.body.innerText.includes("Punch Item #2"), { timeout: 20000 }).catch(() => {});
  await click("button::-p-text(Who can't get Punch Items or Observations?)");
  await waitText("Who can't get records");
  await waitText("Jim Henson");
  const list = await text();
  check("permissions: the list shows who can't get what, by company", list.includes("Kyco") && list.includes("Can't get Punch Items") && list.includes("Can't get Observations") && !list.includes("Lisa Hubbard"));
  await shot("6-access");
  await click("button::-p-text(Back to Messages)");
  await click(".feed-tabs button::-p-text(Mine)");
  await page.waitForFunction(() => document.querySelector(".conv-card .pill.is-procore"), { timeout: 20000 });
  check("the feed card shows the Procore record", (await page.$eval(".conv-card .pill.is-procore", (e) => e.textContent)) === "Punch Item #2");

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
