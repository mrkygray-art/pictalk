// Full-loop demo, steps A-D on the phone (docs/FULL_LOOP_DEMO.md), at phone width against the emulators
// (PICTALK_FAKE_AI=1 classifier stand-in), /api/procore/* mocked in the browser with record options saying
// fullLoopDemo: true:
//   1. the spec's line "… drywall sub" -> Observation only (no type switch), Carlos Mendez (Clean Line Drywall)
//      picked from the company, Approve & Send / Edit / Discard -> the server gets the capture id and the card as
//      first proposed -> View in Procore; the classification log has the run.
//   2. vague words -> the one follow-up question -> answered -> the card.
//   3. "paint touch up" (a Punch Item to the AI) -> Create as Observation / Save as note -> Saved as a note.
//   4. nobody named or heard -> Approve & Send refuses until someone is picked (the 2-3 choices case is in
//      tests/full-loop-records.test.js: the stand-in can't tell two electrical companies apart).
// Needs: emulators (auth, firestore, storage, functions) and npx vite --port 5178. Screenshots: e2e/full-loop-shots/.
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
const OUT = path.join(__dirname, "full-loop-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const COMPANY = "4291776";
const PROJECT = String(373715);
const KEY = `${COMPANY}_${PROJECT}`;
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "Harbor Point Medical Office" }];
const person = (id, name, company, title) => ({ id, name, firstName: name.split(" ")[0], lastName: name.split(" ")[1], title, company, role: title, roleSource: "job_title", tag: null });
const PEOPLE = [
  person(481274, "Edward Gray", "Cornerstone Builders", "Project Manager"),
  person(1, "Carlos Mendez", "Clean Line Drywall", "Drywall Foreman"),
  person(2, "Alicia Nguyen", "Volt Line Electric", "Electrical Foreman"),
  person(3, "Maria Santos", "VoltLine Electric Inc.", "Electrical Foreman"),
  person(4, "Owen Fletcher", "Skyline Roofing & Waterproofing", "Roofing Foreman"),
];
const OPTIONS = { observationTypes: [{ id: 11036845, name: "Deficiency", category: "Quality" }], trades: [], locations: [], canObservations: true, tradesReadable: true, fullLoopDemo: true };

(async () => {
  for (const p of PEOPLE) await getFirestore().doc(`procoreProjects/${KEY}/members/${p.id}`).set({ procoreUserId: String(p.id), name: p.name, at: Date.now() });
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  page.on("dialog", (d) => d.accept());
  let signedIn = false;
  const sent = [];
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
    if (u.pathname === "/api/procore/access") return json(200, { levelsKnown: true, levelsAt: Date.now(), observationList: true, people: {} });
    if (u.pathname === "/api/procore/photo-upload") return json(200, { imageId: 3001, albumId: 7, albumName: "Field photos", duplicate: false });
    if (u.pathname === "/api/procore/records") {
      const b = JSON.parse(r.postData());
      sent.push(b);
      return json(201, { recordType: "observation", id: 371010 + sent.length, number: String(sent.length), url: `https://sandbox.procore.com/${PROJECT}/project/observations/items/${371010 + sent.length}`, warnings: [], reporterName: "Edward Gray" });
    }
    if (u.pathname === "/api/procore/record-status") return json(200, { status: { value: "initiated", label: "Open", closed: false }, threadStatus: "open" });
    return json(404, { error: "not_found" });
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
  const waitText = (t, timeout = 30000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
  const typeWords = async (words) => {
    await page.$eval("textarea", (e) => { e.focus(); e.select(); });
    await page.keyboard.press("Backspace");
    await page.type("textarea", words);
  };
  const startReport = async () => {
    await click(".home-tile:nth-child(1)");
    await click(".rp-row::-p-text(Issue)");
    await waitText("Take a photo and say what you see");
  };
  const home = async () => { await page.goto(APP, { waitUntil: "domcontentloaded" }); await waitText("Report something"); };

  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await waitText("Sign in with Procore");
  await click("button::-p-text(Sign in with Procore)");
  await waitText("Report something");

  // 1. The spec's line
  await startReport();
  const photo = path.join(OUT, "photo.jpg");
  const b64 = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 600; const g = c.getContext("2d"); g.fillStyle = "#bba"; g.fillRect(0, 0, 800, 600); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, "base64"));
  const [chooser] = await Promise.all([page.waitForFileChooser(), click("button::-p-text(Take Photo)")]);
  await chooser.accept([photo]);
  await sleep(400);
  await typeWords("Cracked drywall at the east stairwell, needs fixing before paint Thursday, drywall sub.");
  await click("button::-p-text(Fill It In)");
  await waitText("Approve & Send");
  const t1 = await text();
  check("demo: no Observation / Punch Item switch", !(await page.$(".report-type")));
  check("demo: goes to Procore's Observations", t1.includes("Goes to Procore's Observations"));
  check("demo: 'drywall sub' -> Carlos Mendez picked from Clean Line Drywall", t1.includes("Carlos Mendez"));
  check("the card: Approve & Send, Edit, Discard", t1.includes("Approve & Send") && t1.includes("Edit") && t1.includes("Discard"));
  check("no technical words on the card", !/record_type|json|confidence|undefined|null/i.test(t1));
  await shot("1-card");
  await click("button::-p-text(Approve & Send)");
  await waitText("Sent to Procore");
  const s1 = sent[0] ?? {};
  check("server: an Observation for Carlos, with the capture id (one capture = one record)", s1.card?.recordType === "observation" && JSON.stringify(s1.card?.assigneeIds) === "[1]" && /^[A-Za-z0-9_-]+$/.test(s1.card?.captureId ?? ""), JSON.stringify({ t: s1.card?.recordType, a: s1.card?.assigneeIds, c: s1.card?.captureId }));
  check("server: the card as first proposed goes along (for the edit count)", s1.proposed?.title && JSON.stringify(s1.proposed.assigneeIds) === "[1]");
  check("server: the photo is attached", (s1.files ?? []).some((f) => f.type.startsWith("image/")));
  check("done: View in Procore", (await text()).includes("View in Procore"));
  await shot("2-sent");
  const log = (await getFirestore().doc(`procoreProjects/${KEY}/classifications/${s1.card?.captureId}`).get()).data();
  check("classification log: the AI's run is saved for the Evaluation Lab", log?.runs?.length === 1 && log.runs[0].output?.suggested_assignee?.company === "Clean Line Drywall", JSON.stringify(log?.runs?.[0]?.output?.suggested_assignee ?? null));

  // 2. Vague words -> one question
  await home();
  await startReport();
  await typeWords("Something's off back there.");
  await click("button::-p-text(Fill It In)");
  await waitText("One question");
  check("not sure: asks its one question instead of guessing", (await text()).includes("What needs fixing, and where is it?"));
  await shot("3-question");
  await page.type(".report textarea", "the drywall by the east stairwell is cracked, drywall sub should fix it");
  await click("button::-p-text(Fill It In)");
  await waitText("Approve & Send");
  check("the answer fills the card in (Carlos again)", (await text()).includes("Carlos Mendez"));
  await shot("4-after-answer");

  // 3. Something else -> Create as Observation / Save as note
  await home();
  await startReport();
  await typeWords("Paint touch up needed on the wall by the stairwell, drywall sub.");
  await click("button::-p-text(Fill It In)");
  await waitText("Approve & Send");
  const t3 = await text();
  check("another type heard: offers Create as Observation or Save as note", t3.includes("This sounds like a Punch Item") && t3.includes("Create as Observation") && t3.includes("Save as note"));
  await shot("5-other-type");
  await click("button::-p-text(Save as note)");
  await waitText("Saved as a note");
  check("Save as note: a SiteSnap note, nothing in Procore", (await text()).includes("Nothing was created in Procore") && sent.length === 1);
  await shot("6-noted");

  // 4. Two electrical companies -> choose; Approve needs someone
  await home();
  await startReport();
  await typeWords("Exposed electrical wiring at the east stairwell junction box.");
  await click("button::-p-text(Fill It In)");
  await waitText("Approve & Send");
  await click("button::-p-text(Approve & Send)");
  check("demo: no assignee, no send (Pick who it's for)", (await text()).includes("Pick who it's for.") && sent.length === 1);
  await shot("7-pick");

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
