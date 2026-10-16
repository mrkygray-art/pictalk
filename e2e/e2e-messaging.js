// SiteSnap messaging end to end at phone width, against the emulators (PICTALK_FAKE_AI=1, PICTALK_FAKE_STT=1),
// with /api/procore/* mocked in the browser (the dev server has no /api). Four people, each in their own browser:
//   Sam (sender), Tia (tagged, ABC Drywall), Uma (on the project, CC'd, not tagged), Vic (not on the project).
// Needs: npm run emulators, and npx vite --port 5176. Screenshots: e2e/messaging-shots/.
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
const OUT = path.join(__dirname, "messaging-shots");
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
const PROJECT = String(400000 + run);
const KEY = `${COMPANY}_${PROJECT}`;
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco Builders", projectId: PROJECT, name: "001 - SiteSnap Test Project" }];
const PEOPLE = [
  { id: 201, name: "Sam Sender", firstName: "Sam", lastName: "Sender", title: "Superintendent", company: "Kyco Builders", role: "Superintendent", roleSource: "job_title", tag: null },
  { id: 202, name: "Tia Tagged", firstName: "Tia", lastName: "Tagged", title: "Drywall Foreman", company: "ABC Drywall", role: "Drywall Foreman", roleSource: "job_title", tag: null },
  { id: 203, name: "Uma Untagged", firstName: "Uma", lastName: "Untagged", title: "Project Engineer", company: "Kyco Builders", role: "Project Engineer", roleSource: "job_title", tag: null },
];
const USERS = { sam: ["201", "Sam Sender"], tia: ["202", "Tia Tagged"], uma: ["203", "Uma Untagged"], vic: ["299", "Vic Visitor"] };

(async () => {
  // Project memberships, as api/procore/session would record them (Vic isn't on the project)
  for (const id of ["201", "202", "203"]) await getFirestore().doc(`procoreProjects/${KEY}/members/${id}`).set({ procoreUserId: id, name: USERS[Object.keys(USERS).find((k) => USERS[k][0] === id)][1], at: Date.now() });

  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });

  const filedPhotos = []; // photos also filed in the day's album (spec section 4)
  async function open(who) {
    const [pid, name] = USERS[who];
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.log(`[${who}] PAGE ERROR:`, e.message));
    let signedIn = false;
    await page.setRequestInterception(true);
    page.on("request", async (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith("/api/procore/")) return r.continue();
      const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (u.pathname === "/api/procore/login") { signedIn = true; return r.respond({ status: 302, headers: { location: "/?procore=connected" } }); }
      if (!signedIn) return json(401, { error: "not_connected" });
      if (u.pathname === "/api/procore/session") {
        const token = await getAuth().createCustomToken(`procore_${pid}`, { procoreUserId: pid });
        return json(200, { token, me: { procoreUserId: pid, name }, projects: PROJECTS });
      }
      if (u.pathname === "/api/procore/directory") return json(200, { people: PEOPLE, canTag: false, labels: [], compact: false, rolesAvailable: true });
      if (u.pathname === "/api/procore/photo-upload") {
        const b = JSON.parse(r.postData() || "{}");
        filedPhotos.push({ who, captureId: b.captureId, albumId: b.albumId, description: b.description });
        return json(200, { imageId: 4000 + filedPhotos.length, albumId: 7, albumName: "Field photos", duplicate: false });
      }
      return json(404, { error: "not_found" });
    });
    const shot = (n, full = false) => page.screenshot({ path: path.join(OUT, `${who}-${n}.png`), fullPage: full });
    const text = () => page.evaluate(() => document.body.innerText);
    const click = async (sel) => { await page.locator(sel).setTimeout(15000).click(); await sleep(400); };
    const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await waitText("Sign in with Procore");
    await click("button::-p-text(Sign in with Procore)");
    await waitText("Project photos"); // the project home's three tiles
    await click(".home-tile:nth-child(2)"); // Message
    await waitText("New Message");
    return { page, shot, text, click, waitText, ctx };
  }

  // ---- Sam: sign in, the feed, New Message ----
  const sam = await open("sam");
  let t = await sam.text();
  check("sign-in leads to the project home, then Message opens the feed (one project, chosen for you)", t.includes("001 - SiteSnap Test Project") && t.includes("Messages"));
  check("header shows who's signed in: name · company · title", t.includes("Sam Sender · Kyco Builders · Superintendent"));
  check("no job / stop language on the home screen", !/My Jobs|Start New Job|Save This Stop|End Job|stops? per job|No job open/i.test(t), t.match(/My Jobs|Start New Job|Save This Stop|End Job|No job open/i)?.[0] ?? "");
  const tabs = await sam.page.$$eval(".feed-tabs button", (b) => b.map((x) => x.textContent.trim()));
  check("For Me | CC | All Project | Sent tabs, in that order", tabs.join("|") === "For Me|CC|All Project|Sent", tabs.join("|"));
  await sam.shot("1-feed");

  await sam.click("button::-p-text(New Message)");
  await sam.waitText("Who is this for?");
  await sam.click(".dir-filters button::-p-text(Company)");
  await sam.page.type(".dir-input", "abc");
  await sleep(300);
  await sam.shot("2-search-company");
  await sam.click("button::-p-text(Tag everyone at ABC Drywall)");
  t = await sam.text();
  check("Tag everyone at a company tags its people, with a count", t.includes("1 person tagged"), (t.match(/\d+ (person|people) tagged/) ?? [""])[0]);
  // CC Uma: pick her, then switch her row to CC
  await sam.click(".dir-filters button::-p-text(Name)");
  await sam.page.focus(".dir-input");
  await sam.page.keyboard.down("Control"); await sam.page.keyboard.press("a"); await sam.page.keyboard.up("Control");
  await sam.page.keyboard.press("Backspace");
  await sam.page.type(".dir-input", "uma");
  await sleep(300);
  await sam.click(".dir-person::-p-text(Uma Untagged)");
  await sam.click(".dir-picked-row:nth-child(2) .to-cc button::-p-text(CC)");
  t = await sam.text();
  check("the To / CC switch: Uma becomes CC, the count says so", t.includes("1 To, 1 CC"), (t.match(/\d+ To[^\n]*/) ?? [""])[0]);
  await sam.shot("2b-to-cc");
  await sam.click(".dir-done");
  t = await sam.text();
  check("To: shows who's tagged, and CC: who's CC'd", t.includes("To: Tia Tagged") && t.includes("CC: Uma Untagged"));

  // Photo + voice + words
  const photo = path.join(OUT, "photo.jpg");
  const b64 = await sam.page.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 600; const g = c.getContext("2d"); g.fillStyle = "#b85"; g.fillRect(0, 0, 800, 600); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; });
  fs.writeFileSync(photo, Buffer.from(b64, "base64"));
  const [chooser] = await Promise.all([sam.page.waitForFileChooser(), sam.click("button::-p-text(Take Photo)")]);
  await chooser.accept([photo]);
  await sleep(500);
  check("the photo shows in the composer", (await sam.page.$$(".msg-photos img")).length === 1);
  await sam.click("button::-p-text(Tap to Talk)");
  await sleep(1500);
  await sam.click("button.talk-btn.is-recording");
  await sam.waitText("What you said (you can fix it)", 30000);
  const said = await sam.page.$eval(".msg-field textarea", (e) => e.value);
  check("Tap to Talk: the words come back before sending and can be edited", /Test transcript/.test(said), said);
  await sam.page.type(".msg-field:nth-of-type(2) textarea, label.msg-field:last-of-type textarea", "Please send the revised drawings for level 2");
  await sam.shot("3-composer", true);
  await sam.click("button::-p-text(Send)");
  await sam.waitText("From Sam Sender", 30000);
  await sam.page.waitForFunction(() => document.querySelector(".msg .msg-photo-grid img"), { timeout: 30000 });
  await sam.page.waitForFunction(() => document.body.innerText.includes("To do:"), { timeout: 30000 });
  t = await sam.text();
  check("sent: the conversation shows the photo, the words and the note", t.includes("Please send the revised drawings") && /Test transcript/.test(t));
  for (let i = 0; i < 40 && !filedPhotos.length; i++) await sleep(500);
  check("auto-file: the message's photo also went to the day's album, with its words", filedPhotos.length === 1 && filedPhotos[0].who === "sam" && filedPhotos[0].captureId.startsWith("m-") && filedPhotos[0].albumId === null && /Please send the revised drawings/.test(filedPhotos[0].description) && /SiteSnap message/.test(filedPhotos[0].description), JSON.stringify(filedPhotos));
  check("after sending, the thread shows one Reply button, not the whole composer", !!(await sam.page.$(".msg-reply-btn")) && !(await sam.page.$(".composer")));
  check("no AI photo description or describe button on screen", !/Photo description|Describe photo/.test(t));
  check("the sender doesn't get quick replies on their own message", !(await sam.page.$(".qr-btn")));
  check("AI flags the request as a to-do for Tia", /To do:.*\n?.*For Tia Tagged/s.test(t), (t.match(/To do:[^\n]*/) ?? [""])[0]);
  await sam.shot("4-sent", true);

  // ---- Tia (tagged): highlighted and unread in For Me, task badge, mark done, reply ----
  const tia = await open("tia");
  await tia.page.waitForFunction(() => document.querySelector(".conv-card"), { timeout: 30000 });
  const tiaCard = await tia.page.$eval(".conv-card", (e) => ({ cls: e.className, text: e.innerText }));
  check("tagged person: it's in For Me, highlighted and unread", tiaCard.cls.includes("is-for-me") && tiaCard.cls.includes("is-unread"), tiaCard.cls);
  check("tagged person: the card says there's something for them to do", tiaCard.text.includes("1 to do for you"));
  check("For Me tab shows an unread count", !!(await tia.page.$(".tab-badge")));
  await tia.shot("1-for-me");
  await tia.click(".conv-card");
  await tia.page.waitForFunction(() => document.querySelector(".msg-task button"), { timeout: 20000 });
  await tia.click(".msg-task button");
  await tia.waitText("Done:", 20000);
  check("the tagged person marks the to-do done (Done / Reopen kept)", (await tia.text()).includes("Done:"));
  check("quick replies: four buttons and More", (await tia.page.$$(".qr-btn")).length === 4 && !!(await tia.page.$(".qr-more")));
  await tia.click(".qr-btn::-p-text(On it)");
  await tia.page.waitForFunction(() => [...document.querySelectorAll(".msg-status-line")].some((e) => e.textContent === "On it"), { timeout: 20000 });
  check("one tap answers: On it shows as a status line", true);
  await tia.click(".qr-btn::-p-text(Delayed)");
  await tia.waitText("Why? (optional)");
  await tia.click(".sheet .place-chip::-p-text(Weather)");
  await tia.click("button::-p-text(Send Delayed)");
  await tia.page.waitForFunction(() => [...document.querySelectorAll(".msg-status-line")].some((e) => e.textContent.startsWith("Delayed · Weather")), { timeout: 20000 });
  check("Delayed asks why (optional) and shows the reason", true);
  await tia.shot("1b-quick-replies", true);
  await tia.click(".msg-reply-btn");
  await tia.page.type("label.msg-field:last-of-type textarea", "On it, sending by noon");
  await tia.click("button::-p-text(Send Reply)");
  await tia.waitText("On it, sending by noon", 30000);
  await tia.page.waitForFunction(() => document.querySelectorAll(".msg:not(.is-pending)").length >= 2, { timeout: 30000 });
  check("Reply opens the composer and sends; then it's back to one Reply button", (await tia.page.$$(".msg")).length >= 2 && !!(await tia.page.$(".msg-reply-btn")));
  await tia.shot("2-replied", true);
  await tia.click("button::-p-text(Messages)");
  await sleep(1500);
  const tiaAfter = await tia.page.$eval(".conv-card", (e) => e.className);
  check("after reading (and replying), it's no longer unread for her", !tiaAfter.includes("is-unread"), tiaAfter);

  // ---- Uma (CC'd, not tagged): not in For Me, no count; calm in CC and All Project; no to-do, no quick replies ----
  const uma = await open("uma");
  await uma.waitText("Nothing for you right now", 30000);
  check("CC'd member: nothing in For Me, no unread count", !(await uma.page.$(".conv-card")) && !(await uma.page.$(".tab-badge")));
  await uma.click(".feed-tabs button::-p-text(CC)");
  await uma.page.waitForFunction(() => document.querySelector(".conv-card"), { timeout: 30000 });
  const umaCc = await uma.page.$eval(".conv-card", (e) => ({ cls: e.className, dot: !!e.querySelector(".unread-dot"), text: e.innerText }));
  check("CC tab: the message is there, calm (no unread dot, no to-do), and says who's CC'd", umaCc.cls.includes("is-muted") && !umaCc.dot && !umaCc.text.includes("to do for you") && umaCc.text.includes("CC Uma Untagged"), umaCc.text.replace(/\n/g, " | "));
  await uma.shot("0-cc-tab");
  await uma.click(".conv-card");
  await uma.waitText("CC: Uma Untagged", 20000);
  check("CC'd person opens it: CC line shown, no quick replies, can still Reply", !(await uma.page.$(".qr-btn")) && !!(await uma.page.$(".msg-reply-btn")));
  await uma.click("button::-p-text(Messages)");
  await uma.click(".feed-tabs button::-p-text(All Project)");
  await uma.page.waitForFunction(() => document.querySelector(".conv-card"), { timeout: 30000 });
  const umaCard = await uma.page.$eval(".conv-card", (e) => ({ cls: e.className, dot: !!e.querySelector(".unread-dot") }));
  check("untagged member: it's in All Project, muted, with no unread dot", umaCard.cls.includes("is-muted") && !umaCard.dot, umaCard.cls);
  await uma.shot("1-all-project");

  // ---- Vic (not on the project): can't see the feed ----
  const vic = await open("vic");
  await vic.click(".feed-tabs button::-p-text(All Project)");
  await vic.waitText("Couldn't load messages", 30000);
  check("someone not on the Procore project can't read its conversations", !(await vic.page.$(".conv-card")));
  await vic.shot("1-no-access");

  // ---- Sam: send is blocked without anyone tagged; close drops it from For Me ----
  await sam.page.waitForFunction(() => /Seen [0-9]/.test(document.body.innerText) && document.body.innerText.includes("Delayed"), { timeout: 20000 });
  check("the sender sees when Tia saw it and her latest answer", /Tia Tagged\s*Seen [0-9].*Delayed/.test(await sam.text()));
  await sam.shot("5-tracking", true);
  await sam.click("button::-p-text(Messages)");
  await sam.click("button::-p-text(New Message)");
  await sam.click(".dir-done");
  await sam.page.type("label.msg-field:last-of-type textarea", "Test with no one tagged");
  await sam.click("button::-p-text(Send)");
  check("Send is blocked with a clear message when no one is tagged", (await sam.text()).includes("Tag at least one person first"));
  await sam.click("button::-p-text(Cancel)");
  await sam.click(".feed-tabs button::-p-text(Sent)");
  await sam.page.waitForFunction(() => document.querySelector(".conv-card"), { timeout: 20000 });
  check("Sent shows the conversations I started", (await sam.page.$$(".conv-card")).length === 1);
  await sam.click(".conv-card");
  await sam.click(".conv-header button::-p-text(Close)");
  await sam.waitText("This message is closed");
  t = await sam.text();
  check("closed: no composer, no Reply, no quick replies; only Reopen", !(await sam.page.$(".msg-reply-btn")) && !(await sam.page.$(".composer")) && !(await sam.page.$(".qr-btn")) && t.includes("Reopen"));
  check("the close shows as a line in the thread", /Closed by Sam Sender/.test(t));
  await sam.shot("6-closed", true);
  await tia.click(".feed-tabs button::-p-text(All Project)");
  await tia.click(".feed-tabs button::-p-text(For Me)");
  await tia.waitText("Nothing for you right now", 20000);
  check("closed conversations drop out of For Me", !(await tia.page.$(".conv-card")));

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
