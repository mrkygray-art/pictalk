// SiteSnap guest demo (docs/guest-demo.md) at phone width, against the emulators, with /api/procore/* mocked in
// the browser (the dev server has no /api). The visitor arrives at /?demo=1 (where /demo redirects) already
// signed in as the guest: picker first, the banner on every screen, the view-only note instead of writes, and
// Exit demo back to the sign-in screen with "Explore as a guest".
// Needs: npm run emulators, and npx vite --port 5178. Screenshots: e2e/demo-shots/.
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

const APP = "http://localhost:5178/";
const OUT = path.join(__dirname, "demo-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const run = Date.now() % 1000000;
const COMPANY = "4291776";
const PROJECTS = ["Harbor Point Medical Office", "Westgate Retail Center", "Lakeview Apartments"].map((name, i) => ({ companyId: COMPANY, companyName: "Sandbox Co", projectId: String(500000 + run * 3 + i), name }));
const KEY = `${COMPANY}_${PROJECTS[0].projectId}`;
const GUEST = "777";
const PEOPLE = [
  { id: 12, name: "Tyler Brandt", firstName: "Tyler", lastName: "Brandt", title: "Foreman", company: "VoltLine Electric", role: "Foreman", roleSource: "job_title", tag: null },
  { id: 13, name: "Dana Whitfield", firstName: "Dana", lastName: "Whitfield", title: "Project Manager", company: "Ironbridge Builders", role: "Project Manager", roleSource: "job_title", tag: null },
];

(async () => {
  // The guest is a member of the demo projects (as api/procore/session records it) and one thread exists
  for (const p of PROJECTS) await getFirestore().doc(`procoreProjects/${COMPANY}_${p.projectId}/members/${GUEST}`).set({ procoreUserId: GUEST, name: "Guest", at: Date.now() });
  const conv = getFirestore().doc(`procoreProjects/${KEY}/conversations/demo-t1`);
  const who = { procoreUserId: "13", name: "Dana Whitfield", company: "Ironbridge Builders", title: "Project Manager" };
  await conv.set({ createdBy: who, tagged: [{ procoreUserId: "12", name: "Tyler Brandt", company: "VoltLine Electric", title: "Foreman" }], taggedIds: ["12"], status: "open", createdAt: Date.now() - 3600e3, lastActivityAt: Date.now() - 3600e3, messageCount: 1, lastMessage: { text: "Panel L2 cover is off in Room 204." } });
  await conv.collection("messages").doc("m1").set({ authorId: "13", authorName: "Dana Whitfield", text: "Panel L2 cover is off in Room 204. Please put it back before the inspection.", transcript: "", transcriptStatus: "none", photos: [], voicePath: null, voiceType: null, aiDescription: null, clientCreatedAt: Date.now() - 3600e3, createdAt: Date.now() - 3600e3 });

  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  let demo = true;
  const posts = [];
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (r.method() === "POST") posts.push(u.pathname);
    if (u.pathname === "/api/procore/logout") { demo = false; return json(200, { ok: true }); }
    if (!demo) return json(401, { error: "not_connected" });
    if (u.pathname === "/api/procore/session") {
      const token = await getAuth().createCustomToken(`procore_${GUEST}`, { procoreUserId: GUEST, demo: true });
      return json(200, { token, me: { procoreUserId: GUEST, name: "Guest", demo: true }, projects: PROJECTS, demo: true });
    }
    if (u.pathname === "/api/procore/directory") return json(200, { people: PEOPLE, canTag: false, labels: [], compact: false, rolesAvailable: true });
    if (u.pathname === "/api/procore/photos") return json(200, { albums: [], photos: [], nextPage: null, timeZone: "America/Los_Angeles" });
    return json(404, { error: "not_found" });
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
  const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
  const sheetSays = async () => { await waitText("This is a view-only demo"); const t = await text(); await click("::-p-text(Got It)"); return t; };

  await page.goto(`${APP}?demo=1`, { waitUntil: "networkidle2" });
  await waitText("Pick a project");
  let t = await text();
  check("arrives signed in at the picker, no login screen", t.includes("Pick a project") && !t.includes("Sign in with Procore"));
  check("banner: Demo mode: view only + Exit demo", t.includes("Demo mode:") && t.includes("view only") && t.includes("Exit demo"));
  check("picker shows exactly the three demo projects", PROJECTS.every((p) => t.includes(p.name)));
  check("address bar drops ?demo=1", !(await page.evaluate(() => location.search)).includes("demo"));
  await shot("1-picker");

  await click(`::-p-text(${PROJECTS[0].name})`);
  await waitText("Report an issue");
  t = await text();
  check("home: signed in as Guest, banner still there", t.includes("Guest") && t.includes("Demo mode:"));
  check("home: no phone-alert switch in the demo", !/alert/i.test(t.split("Project photos")[1] ?? ""));
  await shot("2-home");

  await click("::-p-text(Report an issue)");
  t = await sheetSays();
  check("Report an issue shows the view-only note", t.includes("Reporting an issue") && t.includes("nothing is sent to Procore"));
  await shot("3-report-note").catch(() => {});

  await click("::-p-text(Message)");
  await waitText("Panel L2 cover");
  check("feed: the demo thread is readable", (await text()).includes("Panel L2 cover"));
  await click("::-p-text(New Message)");
  check("New Message shows the view-only note", (await sheetSays()).includes("Sending a new message"));
  await click("::-p-text(Panel L2 cover)");
  await waitText("Please put it back");
  await shot("4-thread");
  await click(".msg-reply-btn");
  await waitText("This is a view-only demo");
  await shot("5-reply-note");
  check("Reply shows the view-only note", (await sheetSays()).includes("Replying"));
  const reads = await getFirestore().collection(`procoreProjects/${KEY}/members/${GUEST}/reads`).get();
  check("no read marks written for the guest", reads.empty);

  check("no POSTs except SiteSnap sign-in", posts.every((p) => p === "/api/procore/session"), posts.join(", "));
  await click("::-p-text(Exit demo)");
  await waitText("Sign in with Procore");
  t = await text();
  check("Exit demo: back to the normal sign-in screen", t.includes("Sign in with Procore") && !t.includes("Demo mode:"));
  const link = await page.$eval("a.demo-guest-link", (a) => a.getAttribute("href")).catch(() => null);
  check("sign-in screen offers Explore as a guest -> /demo", t.includes("Explore as a guest") && link === "/demo");
  await shot("6-signin");

  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
