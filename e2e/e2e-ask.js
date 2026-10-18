// Ask the SiteSnap Guide (docs/ask-guide-spec.md) against the emulators, /api/procore/* mocked in the browser and the
// guide itself replaced by a small stand-in page (GUIDE=real uses the live guide instead, to see whether it lets
// itself be framed). Sign-in screen and project home: the Ask button, the iframe's settings, no referrer, loading,
// close by X / backdrop / Escape, focus back to Ask, the conversation kept, phone sheet (85%, page locked, Tab kept
// inside), landscape (full height), desktop side panel (no backdrop, page usable), resizing across 768 px without
// reloading, offline and back, a guide that doesn't load (10 s), the guest demo, and not on other screens.
// Needs: npm run emulators, and VITE_FEATURE_ASK=1 npx vite --port 5179. Screenshots: e2e/ask-shots/.
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

const APP = process.env.APP_URL || "http://localhost:5179/";
const GUIDE = "https://sitesnap-guide.mrkygray.workers.dev/";
const REAL = process.env.GUIDE === "real";
const OUT = path.join(__dirname, "ask-shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const COMPANY = "4291776";
const PROJECT = String(700000 + (Date.now() % 100000));
const KEY = `${COMPANY}_${PROJECT}`;
const ME = "111";
const PROJECTS = [{ companyId: COMPANY, companyName: "Kyco", projectId: PROJECT, name: "Harbor Point Medical Office" }];
const STAND_IN = `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;background:#111;color:#eee;font:16px sans-serif;display:flex;flex-direction:column;height:100vh">
<p style="flex:1;padding:12px">Stand-in guide</p><input id="q" placeholder="Ask a question" style="font-size:16px;margin:8px;padding:10px"></body>`;

async function setup(browser, { mode = "plain", guide = "ok", phone = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(phone ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 800 });
  const errors = [];
  const guideRequests = [];
  const consoleLines = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGE ERROR:", e.message); });
  page.on("console", (m) => consoleLines.push(m.text()));
  let signedIn = false;
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (r.url().startsWith(GUIDE)) {
      guideRequests.push({ url: r.url(), referer: r.headers().referer ?? null });
      if (REAL) return r.continue();
      if (guide === "slow") return setTimeout(() => r.respond({ status: 200, contentType: "text/html", body: STAND_IN }).catch(() => {}), 12500);
      return r.respond({ status: 200, contentType: "text/html", body: STAND_IN });
    }
    if (!u.pathname.startsWith("/api/procore/")) return r.continue();
    const json = (status, body) => r.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/api/procore/login") { signedIn = true; return r.respond({ status: 302, headers: { location: "/?procore=connected" } }); }
    if (!signedIn) return json(401, { error: "not_connected" });
    if (u.pathname === "/api/procore/session") return json(200, { token: await getAuth().createCustomToken(`procore_${ME}`, { procoreUserId: ME, ...(mode === "demo" ? { demo: true } : {}) }), me: { procoreUserId: ME, name: mode === "demo" ? "Guest" : "Edward Morton" }, projects: PROJECTS, demo: mode === "demo" });
    if (u.pathname === "/api/procore/directory") return json(200, { people: [{ id: 111, name: "Edward Morton", company: "SiteSnap AI", title: "Developer" }], canTag: false, labels: [], compact: false, rolesAvailable: true });
    if (u.pathname === "/api/procore/capabilities") return json(200, { tools: {}, manifest: { status: 404 } });
    if (u.pathname === "/api/procore/inspections") return json(200, { access: true, myCompany: null, groups: { mine: [], company: [], open: [] } });
    if (u.pathname === "/api/procore/my-items") return json(200, { groups: { overdue: [], open: [], ready: [] }, counts: { open: 0, overdue: 0 }, today: "2026-10-18", tools: {} });
    return json(200, {});
  });
  const waitText = (t, timeout = 25000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const panelOpen = () => page.evaluate(() => { const l = document.querySelector(".ask-layer"); return !!l && !l.hidden; });
  const frame = () => page.frames().find((f) => f.url().startsWith(GUIDE));
  const focusIsAsk = () => page.evaluate(() => document.activeElement?.classList.contains("ask-btn"));
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await waitText("Sign in with Procore");
  const signIn = async () => {
    await page.click("button::-p-text(Sign in with Procore)");
    await page.waitForSelector(".home-tiles", { timeout: 25000 });
  };
  return { ctx, page, errors, guideRequests, consoleLines, waitText, shot, panelOpen, frame, focusIsAsk, signIn };
}

async function phoneSignInAndHome(browser) {
  const t = await setup(browser);
  const { page } = t;
  check("sign-in: Ask button shows", !!(await page.$(".signin-ask .ask-btn")));
  check("sign-in: no iframe before the first open", !(await page.$(".ask-body iframe")));
  await t.shot("1-signin");
  await page.click(".signin-ask .ask-btn");
  await page.waitForSelector(".ask-body iframe");
  const attrs = await page.$eval(".ask-body iframe", (f) => ({ src: f.getAttribute("src"), title: f.title, ref: f.getAttribute("referrerpolicy"), sandbox: f.getAttribute("sandbox"), allow: f.getAttribute("allow") }));
  check("iframe address is the guide's, nothing added", attrs.src === `${GUIDE}?embed=1`, attrs.src);
  check("iframe title / referrerpolicy / sandbox / no allow", attrs.title === "SiteSnap Guide" && attrs.ref === "no-referrer" && attrs.sandbox === "allow-scripts allow-same-origin allow-forms" && attrs.allow === null, JSON.stringify(attrs));
  check("header, close button and the saved-questions line", (await t.waitText("Ask the SiteSnap Guide").then(() => true)) && (await page.$eval(".ask-note", (p) => p.textContent)) === "Questions are saved to improve this guide.");
  check("focus moved to Close on open", await page.evaluate(() => document.activeElement?.classList.contains("ask-close")));
  check("phone: page behind is locked", await page.evaluate(() => document.documentElement.classList.contains("ask-locked")));
  await page.waitForFunction(() => !document.querySelector(".ask-state"), { timeout: 15000 }).catch(() => {});
  check("guide loaded (Loading message gone)", !(await page.$(".ask-state")));
  check("no referrer sent to the guide", t.guideRequests.length > 0 && t.guideRequests.every((g) => !g.referer), JSON.stringify(t.guideRequests));
  const box = await page.$eval(".ask-panel", (p) => { const r = p.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; });
  check("phone: bottom sheet about 85% of the screen", box.bottom >= 843 && Math.abs(box.h / 844 - 0.85) < 0.03, JSON.stringify(box));
  const close = await page.$eval(".ask-close", (b) => b.getBoundingClientRect().height);
  check("close button is 44 px", close >= 44, String(close));
  // Tab stays inside on phones
  let inside = true;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    inside = inside && (await page.evaluate(() => !!document.activeElement?.closest(".ask-panel")));
  }
  check("phone: Tab stays inside the panel", inside);
  if (!REAL) {
    const f = t.frame();
    await f.type("#q", "How do I send a daily log?");
    await t.shot("2-signin-sheet");
  }
  // Close with X, focus back
  await page.click(".ask-close");
  check("X closes", !(await t.panelOpen()));
  check("focus back on Ask", await t.focusIsAsk());
  check("page unlocked after close", await page.evaluate(() => !document.documentElement.classList.contains("ask-locked")));
  await page.click(".signin-ask .ask-btn");
  if (!REAL) check("reopen keeps the conversation", (await t.frame().$eval("#q", (i) => i.value)) === "How do I send a daily log?");
  check("only one guide load so far", t.guideRequests.length === 1, String(t.guideRequests.length));
  // Backdrop closes
  await page.mouse.click(195, 40);
  check("backdrop closes", !(await t.panelOpen()));
  // Escape closes
  await page.click(".signin-ask .ask-btn");
  await page.keyboard.press("Escape");
  check("Escape closes", !(await t.panelOpen()));
  check("focus back on Ask after Escape", await t.focusIsAsk());

  // Home
  await t.signIn();
  const row = await page.$eval(".msg-who-row", (r) => {
    const rr = r.getBoundingClientRect();
    const ask = r.querySelector(".ask-btn")?.getBoundingClientRect();
    const who = r.querySelector(".msg-who").getBoundingClientRect();
    const tile = document.querySelector(".home-tile").getBoundingClientRect();
    return { rowH: rr.height, whoH: who.height, askRight: ask?.right, rowRight: rr.right, askBottom: ask?.bottom, tileTop: tile.top };
  });
  check("home: Ask at the right end of the name row", row.askRight != null && Math.abs(row.askRight - row.rowRight) <= 8, JSON.stringify(row));
  check("home: Ask doesn't grow the row or reach the cards", row.rowH <= Math.max(row.whoH, 34) && row.askBottom <= row.tileTop, JSON.stringify(row));
  await t.shot("3-home");
  await page.click(".msg-who-row .ask-btn");
  await page.waitForSelector(".ask-body iframe");
  await page.waitForFunction(() => !document.querySelector(".ask-state"), { timeout: 15000 }).catch(() => {});
  if (!REAL) await t.frame().type("#q", "Where are my items?");
  await t.shot("4-home-sheet");
  // Rotate to landscape: full height, same frame
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await sleep(300);
  const land = await page.$eval(".ask-panel", (p) => p.getBoundingClientRect().height);
  check("landscape: sheet fills the height", Math.abs(land - 390) <= 2, String(land));
  check("landscape: still a sheet (not the side panel)", !(await page.$(".ask-layer.is-wide")));
  if (!REAL) check("landscape: conversation kept", (await t.frame().$eval("#q", (i) => i.value)) === "Where are my items?");
  await t.shot("5-landscape");
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(300);
  await page.click(".ask-close");
  // Not on other screens
  await page.click(".home-tile:nth-child(2)");
  await t.waitText("New Message");
  check("not on the Messages screen", !(await page.$(".ask-btn")));
  check("no page errors", t.errors.length === 0, t.errors.join(" | "));
  if (REAL) console.log("console:", t.consoleLines.filter((l) => /frame|refused/i.test(l)).join(" | ") || "(no framing messages)");
  await t.ctx.close();
}

async function desktop(browser) {
  const t = await setup(browser, { phone: false });
  const { page } = t;
  await t.signIn();
  // Keyboard only: Tab to Ask, Enter opens
  await page.focus(".msg-who-row .ask-btn");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ask-layer.is-wide:not([hidden])");
  const side = await page.$eval(".ask-panel", (p) => { const r = p.getBoundingClientRect(); return { w: r.width, right: r.right, h: r.height }; });
  check("desktop: right-side panel about 420 px, full height", Math.abs(side.w - 420) <= 2 && side.right >= 1279 && side.h >= 799, JSON.stringify(side));
  check("desktop: no backdrop, page not locked", await page.evaluate(() => getComputedStyle(document.querySelector(".ask-shade")).display === "none" && !document.documentElement.classList.contains("ask-locked")));
  await page.waitForFunction(() => !document.querySelector(".ask-state"), { timeout: 15000 }).catch(() => {});
  if (!REAL) await t.frame().type("#q", "desktop question");
  await t.shot("6-desktop");
  // Page behind still usable: a card is clickable at a point the panel doesn't cover
  const tile = await page.$eval(".home-tile", (b) => { const r = b.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 }; });
  check("desktop: the cards stay uncovered on the left", tile.x < 1280 - 420);
  // Narrow the window across 768 px: becomes the sheet, same conversation
  await page.setViewport({ width: 700, height: 800 });
  await sleep(300);
  check("narrow window: bottom sheet", !(await page.$(".ask-layer.is-wide")) && (await page.evaluate(() => document.documentElement.classList.contains("ask-locked"))));
  if (!REAL) check("narrow window: conversation kept", (await t.frame().$eval("#q", (i) => i.value)) === "desktop question");
  await page.setViewport({ width: 1280, height: 800 });
  await sleep(300);
  check("wide again: side panel", !!(await page.$(".ask-layer.is-wide")));
  check("one guide load through all of it", t.guideRequests.length === 1, String(t.guideRequests.length));
  await page.focus(".ask-close");
  await page.keyboard.press("Escape");
  check("desktop: Escape closes, focus back on Ask", !(await t.panelOpen()) && (await t.focusIsAsk()));
  check("no page errors", t.errors.length === 0, t.errors.join(" | "));
  await t.ctx.close();
}

async function offline(browser) {
  const t = await setup(browser);
  const { page } = t;
  await page.setOfflineMode(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.click(".signin-ask .ask-btn");
  await t.waitText("The guide needs a connection. Your other SiteSnap features still work.");
  check("offline: message, no iframe", !(await page.$(".ask-body iframe")));
  await t.shot("7-offline");
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForSelector(".ask-body iframe", { timeout: 5000 }).catch(() => {});
  check("back online: the guide loads", !!(await page.$(".ask-body iframe")));
  await t.ctx.close();
}

async function slow(browser) {
  const t = await setup(browser, { guide: "slow" });
  const { page } = t;
  await page.click(".signin-ask .ask-btn");
  await t.waitText("Loading the guide...");
  await t.waitText("The guide could not load.", 13000);
  const link = await page.$eval(".ask-state a", (a) => ({ href: a.href, target: a.target, rel: a.rel }));
  check("slow: could-not-load after 10 s with Try again and Open in a new tab", !!(await page.$(".ask-retry")) && link.href === GUIDE && link.target === "_blank", JSON.stringify(link));
  await t.shot("8-failed");
  await t.ctx.close();
}

async function demo(browser) {
  const t = await setup(browser, { mode: "demo" });
  const { page } = t;
  await t.signIn().catch(() => {});
  if (!(await page.$(".home-tiles"))) { // the guest demo may show the picker first
    await page.click(".dir-project-btn").catch(() => {});
    await page.waitForSelector(".home-tiles", { timeout: 15000 });
  }
  check("guest demo: Ask on the home screen", !!(await page.$(".msg-who-row .ask-btn")));
  await page.click(".msg-who-row .ask-btn");
  check("guest demo: panel opens", await t.panelOpen());
  await t.shot("9-demo");
  await t.ctx.close();
}

(async () => {
  await getFirestore().doc(`procoreProjects/${KEY}/members/${ME}`).set({ procoreUserId: ME, name: "Edward Morton", at: Date.now() });
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    await phoneSignInAndHome(browser);
    if (!REAL) {
      await desktop(browser);
      await offline(browser);
      await slow(browser);
      await demo(browser);
    }
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
