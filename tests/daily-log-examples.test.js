// Daily Log Examples (api/_dailyLogExamples.js + the sandbox page api/procore/daily-log-examples.js), against a
// mocked Procore and a fake Firestore. No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import page, { pace } from "../api/procore/daily-log-examples.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { setStore } from "../api/_firestore.js";
import { findForemen, guessStage, guessTrade, makeSamples, MARKER, seeded, STAGES, TRADES, workingDays } from "../api/_dailyLogExamples.js";

pace.gapMs = 0;
pace.spikeWaitMs = 0;
const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const C = "4291776";
const P = "373235";
const KEY = `${C}_${P}`;

const USERS = [
  { id: 1, name: "Jamal Whitfield", job_title: "Electrical General Foreman", vendor: { id: 20, name: "VoltLine Electric Inc." }, permission_template: { name: "Subcontractor - External" } },
  { id: 2, name: "Hannah Lindqvist", job_title: "Framing Superintendent", vendor: { id: 21, name: "Summit Framing & Drywall" } },
  { id: 3, name: "Rosa Mendez", job_title: "Project Manager", vendor: { id: 20, name: "VoltLine Electric Inc." } },
  { id: 4, name: "Kenji Tanaka", job_title: "Journeyman Electrician", vendor: { id: 20, name: "VoltLine Electric Inc." } },
  { id: 5, name: "Old Foreman", job_title: "Foreman", is_active: false },
];

let calls, rows, probe, refuse, users, nextId, leftovers;
const reply = (u, init) => {
  const m = init.method ?? "GET";
  if (/\/projects\/373235\?/.test(u)) return [200, { id: 373235, name: "Westgate Distribution Center", time_zone: "Pacific Time (US & Canada)" }];
  const listed = /\/projects\/373235\/(manpower|notes|delivery|delay)_logs\?/.exec(u);
  if (listed && m === "GET" && probe === 200) return [200, (leftovers[listed[1]] ?? []).filter((x) => u.includes(`log_date=${x.date}`))];
  if (/\/projects\/373235\/manpower_logs\?/.test(u) && m === "GET") return [probe, probe === 200 ? [] : { errors: "Forbidden" }];
  if (/\/projects\/373235\/users/.test(u)) return [200, users];
  if (/daily_logs\/delay_log_types/.test(u)) return [200, [{ id: 1, display_name: "Weather", visible: true }, { id: 2, display_name: "Material", visible: true }, { id: 3, display_name: "Inspection", visible: true }]];
  const s = /\/projects\/373235\/(manpower|notes|delivery|delay)_logs(?:\/(\d+))?$/.exec(u);
  if (s && m === "POST") {
    if (refuse?.[s[1]]) return refuse[s[1]](init);
    const sent = JSON.parse(init.body ?? "{}");
    return [201, { id: nextId++, ...(s[1] === "delay" ? { delay_type: sent.delay_log?.delay_type === "material" ? "material" : "" } : {}) }];
  }
  if (s && m === "DELETE") return s[2] === "404404" ? [404, { errors: "Not found" }] : [204, null];
  return [404, { errors: "Not found" }];
};

// Firestore stand-in: procoreProjects/{key}/dailyLogSamples/{id}, plus collectionGroup
const fakeDb = {
  collection: () => ({ doc: (key) => ({ collection: () => {
    const col = rows.get(key) ?? new Map();
    rows.set(key, col);
    return {
      doc: (id) => ({ get: async () => ({ exists: col.has(id), data: () => col.get(id) }), set: async (v) => { col.set(id, v); }, delete: async () => { col.delete(id); } }),
      get: async () => ({ docs: [...col.entries()].map(([id, v]) => ({ id, data: () => v })) }),
    };
  } }) }),
  collectionGroup: () => ({ get: async () => ({ docs: [...rows.values()].flatMap((col) => [...col.entries()].map(([id, v]) => ({ id, data: () => v }))) }) }),
};

let saved;
beforeEach(() => {
  calls = [];
  rows = new Map();
  probe = 200;
  refuse = null;
  users = USERS;
  nextId = 5000;
  leftovers = {};
  saved = { fetch: globalThis.fetch, env: { ...process.env } };
  Object.assign(process.env, ENV);
  setStore(fakeDb);
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body, headers: init.headers ?? {} });
    const [status, body] = reply(String(url), init);
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  setStore(null);
});

const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const headers = { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json" };
function res() {
  const h = {};
  return { statusCode: 200, headers: h, setHeader(k, v) { h[k.toLowerCase()] = v; }, getHeader(k) { return h[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const post = async (body) => {
  const out = res();
  await page({ method: "POST", url: "/api/procore/daily-log-examples", body, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  return out;
};
const foremen = findForemen(USERS).candidates;
const sentences = (s) => s.notes.text.replace(/^Reported by:[^.]*\.(?:[^.]*\.)?\s/, "").replace(MARKER, "").split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);

// ---------- the content side ----------

test("foremen: job titles first; inactive people and office titles left out", () => {
  const { candidates, directory } = findForemen(USERS);
  assert.deepEqual(candidates.map((c) => c.name), ["Hannah Lindqvist", "Jamal Whitfield"]);
  assert.ok(candidates.every((c) => c.match === "title"));
  assert.deepEqual(candidates.map((c) => c.trade), ["framing", "electrical"]);
  assert.equal(directory.length, 4, "inactive people aren't in the directory list");
});

test("foremen: no title match -> hints from the template and company, marked guess; nothing -> none (never invented)", () => {
  const { candidates } = findForemen([
    { id: 7, name: "Pat Lee", job_title: "", permission_template: { name: "Foreman / Superintendent - Internal" }, vendor: { name: "Ironbridge Construction Group" } },
    { id: 8, name: "Sam Ortiz", job_title: "Crew", vendor: { name: "ClearFlow Plumbing & Mechanical" } },
    { id: 9, name: "Rosa Mendez", job_title: "Project Manager", vendor: { name: "VoltLine Electric Inc." } },
  ]);
  assert.deepEqual(candidates.map((c) => [c.name, c.match, c.trade]), [["Pat Lee", "guess", "gc"], ["Sam Ortiz", "guess", "plumbing"]]);
  assert.match(candidates[0].why, /Permission template/);
  assert.deepEqual(findForemen([{ id: 1, name: "Owner Rep", job_title: "Owner's Representative" }]).candidates, []);
});

test("trades: from the title first, then the company", () => {
  const t = (title, company) => guessTrade(title, company);
  assert.equal(t("Security Systems Foreman", "Sentry Low-Voltage Systems"), "lowvoltage");
  assert.equal(t("Plumbing / Sprinkler Foreman", "Summit Mechanical"), "plumbing");
  assert.equal(t("Mechanical Superintendent", "ClearFlow Plumbing & Mechanical"), "hvac");
  assert.equal(t("Lead Framer", "Summit Framing & Drywall"), "framing");
  assert.equal(t("Superintendent", "Cornerstone Builders"), "gc");
  assert.equal(t("Foreman", "Bayline Concrete"), "concrete");
  assert.equal(t("Painting Foreman", "Finish Pro Painting"), "painting");
});

test("stage: demo staging plan, then the project's name, else a marked guess", () => {
  assert.equal(guessStage({ name: "Harbor Point Medical Office" }).stage, "site");
  assert.equal(guessStage({ name: "Westgate Distribution Center" }).stage, "roughin");
  assert.equal(guessStage({ name: "Lakeview Elementary Modernization" }).stage, "finishes");
  const g = guessStage({ name: "SiteSnap AI · Photos check" });
  assert.equal(g.stage, "roughin");
  assert.match(g.source, /Guessed/);
});

test("dates: the last 5 working days, today included, weekends skipped, nothing in the future", () => {
  assert.deepEqual(workingDays("2026-10-18"), ["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"]);
  assert.deepEqual(workingDays("2026-10-13").slice(0, 3), ["2026-10-13", "2026-10-12", "2026-10-09"]);
});

test("bank: every trade has at least 3 work lines per stage, and every stage tag is real", () => {
  for (const [k, t] of Object.entries(TRADES)) {
    for (const st of Object.keys(STAGES)) assert.ok((t.work[st] ?? []).length >= 3, `${k} ${st}`);
    for (const x of [...t.issues, ...t.tomorrow, ...t.deliveries]) {
      for (const st of (x.stages ?? "").split(" ").filter(Boolean)) assert.ok(STAGES[st], `${k}: ${st}`);
    }
  }
});

test("samples: 3, different dates, different foremen, Manpower + Notes with author and marker, no repeated sentence", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const samples = makeSamples({ foremen, dates: workingDays("2026-10-16"), stage: "roughin", rand: seeded(seed), delayTypes: ["Weather", "Material"] });
    assert.equal(samples.length, 3);
    assert.equal(new Set(samples.map((s) => s.date)).size, 3);
    assert.ok(new Set(samples.map((s) => s.foreman.id)).size >= 2, "both foremen used");
    for (const s of samples) {
      assert.ok(s.manpower.workers >= 1 && s.manpower.hours >= 4 && s.manpower.hours <= 10);
      assert.equal(s.manpower.company, s.foreman.companyId === null ? null : s.foreman.companyId);
      assert.match(s.notes.text, new RegExp(`^Reported by: ${s.foreman.name}, `));
      assert.ok(s.notes.text.endsWith(MARKER));
      assert.match(s.script, /^Daily log for \w+day\. This is /);
      if (s.delay) assert.match(s.delay.start, /^\d{2}:\d{2}$/);
    }
    const all = samples.flatMap(sentences);
    assert.equal(new Set(all).size, all.length, `seed ${seed}: ${all.join(" | ")}`);
  }
});

test("samples: one foreman -> all three from them, still no repeats; about 1 in 3 deliveries and 1 in 4 delays", () => {
  let deliveries = 0;
  let delays = 0;
  const n = 300;
  for (let seed = 1; seed <= n / 3; seed++) {
    const samples = makeSamples({ foremen: [foremen[1]], dates: workingDays("2026-10-16"), stage: "roughin", rand: seeded(seed) });
    assert.ok(samples.every((s) => s.foreman.name === "Jamal Whitfield"));
    const all = samples.flatMap(sentences);
    assert.equal(new Set(all).size, all.length);
    deliveries += samples.filter((s) => s.delivery).length;
    delays += samples.filter((s) => s.delay).length;
  }
  assert.ok(deliveries > n * 0.2 && deliveries < n * 0.45, `deliveries ${deliveries}/${n}`);
  assert.ok(delays > n * 0.12 && delays < n * 0.35, `delays ${delays}/${n}`);
});

test("samples fit the stage: no finish work during site work", () => {
  const drywall = { id: "9", name: "Carlos Mendez", title: "Drywall Foreman", company: "Clean Line Drywall", companyId: "30", trade: "drywall" };
  for (let seed = 1; seed <= 40; seed++) {
    for (const s of makeSamples({ foremen: [drywall], dates: workingDays("2026-10-16"), stage: "site", rand: seeded(seed) })) {
      assert.doesNotMatch(s.notes.text, /Level 4|sanding|coat|taped/i);
      assert.ok(s.manpower.workers <= 4, "a small crew before its phase");
    }
    const painter = { ...drywall, name: "Nikki Tran", trade: "painting" };
    for (const s of makeSamples({ foremen: [painter], dates: workingDays("2026-10-16"), stage: "site", rand: seeded(seed) })) assert.doesNotMatch(s.notes.text, /second coat|eggshell|semi-gloss/i);
  }
});

// ---------- the page ----------

test("page: GET serves it (noindex); only against the sandbox", async () => {
  const out = res();
  await page({ method: "GET", url: "/api/procore/daily-log-examples", headers }, out);
  assert.equal(out.statusCode, 200);
  assert.match(out.body, /Daily Log Examples/);
  assert.match(out.body, /noindex/);
  process.env.PROCORE_API_URL = "https://api.procore.test";
  const prod = res();
  await page({ method: "GET", url: "/api/procore/daily-log-examples", headers }, prod);
  assert.equal(prod.statusCode, 403);
});

test("crew: dates, stage, foremen and delay types; 403 / 404 on the Daily Log skip the project", async () => {
  const out = await post({ action: "crew", companyId: C, projectId: P, name: "Westgate Distribution Center" });
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.equal(b.access, "ok");
  assert.equal(b.dates.length, 5);
  assert.equal(b.stage, "roughin");
  assert.deepEqual(b.candidates.map((c) => c.name), ["Hannah Lindqvist", "Jamal Whitfield"]);
  assert.deepEqual(b.delayTypes, ["Weather", "Material", "Inspection"]);
  assert.ok(calls.every((c) => c.headers["Procore-Company-Id"] === C));
  assert.ok(calls.every((c) => c.method === "GET"), "finding foremen changes nothing");

  probe = 403;
  const no = (await post({ action: "crew", companyId: C, projectId: P })).json();
  assert.equal(no.access, "no_access");
  assert.match(no.accessMessage, /No Daily Log access on this project/);
  probe = 404;
  assert.equal((await post({ action: "crew", companyId: C, projectId: P })).json().access, "tool_off");
});

test("generate: previews only, no Procore calls; no one picked -> a plain error", async () => {
  const out = await post({ action: "generate", foremen, dates: workingDays("2026-10-16"), stage: "site", delayTypes: ["Weather"] });
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(out.json().samples.length, 3);
  assert.equal(calls.length, 0);
  const none = await post({ action: "generate", foremen: [], dates: workingDays("2026-10-16") });
  assert.equal(none.statusCode, 400);
  assert.match(none.json().message, /Pick at least one person/);
});

const oneSample = () => {
  const [s] = makeSamples({ foremen: [foremen[1]], dates: ["2026-10-14"], stage: "roughin", count: 1, rand: seeded(3) });
  return {
    ...s, notes: { text: "Reported by: Jamal Whitfield. Pulled wire." }, // edited on the page: marker gone
    delivery: { what: "3 spools of MC", from: "Electrical supply house", time: "09:30", comment: "Good. Signed by Jamal Whitfield." },
    delay: { type: "Material", start: "07:00", end: "08:00", company: "20", comment: "Short MC." },
  };
};

test("send: one sample -> Manpower, Notes, Delivery, Delay in Procore, each in the ledger; a resend skips them", async () => {
  const s = oneSample();
  const out = await post({ action: "send", companyId: C, projectId: P, projectName: "Westgate", sample: s });
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(out.json().rows.map((r) => [r.label, r.status]), [["Manpower", "created"], ["Notes", "created"], ["Deliveries", "created"], ["Delays", "created"]]);
  const sent = (kind) => JSON.parse(calls.find((c) => c.method === "POST" && c.url.includes(`/${kind}_logs`)).body);
  assert.equal(sent("manpower").manpower_log.contact_id, 20, "the foreman's company");
  assert.equal(sent("manpower").manpower_log.date, "2026-10-14");
  assert.ok(sent("notes").notes_log.comment.endsWith(MARKER), "the marker comes back if an edit took it out");
  assert.equal(sent("delivery").delivery_log.time_hour, 9);
  assert.equal(rows.get(KEY).size, 4);
  assert.deepEqual([...rows.get(KEY).values()].map((v) => v.section).sort(), ["delays", "deliveries", "manpower", "notes"]);

  const again = (await post({ action: "send", companyId: C, projectId: P, sample: s })).json();
  assert.ok(again.rows.every((r) => r.status === "skipped"));
  assert.equal(calls.filter((c) => c.method === "POST").length, 4, "nothing made twice");
});

test("send: Procore's refusal comes back word for word; a refused company is retried blank; bad dates are refused", async () => {
  refuse = {
    notes: () => [403, { errors: "You do not have sufficient access to complete that action." }],
    manpower: (init) => (JSON.parse(init.body).manpower_log.contact_id ? [422, { errors: { contact: ["is invalid"] } }] : [201, { id: 7777 }]),
  };
  const b = (await post({ action: "send", companyId: C, projectId: P, sample: { ...oneSample(), delivery: null, delay: null } })).json();
  assert.equal(b.rows[0].status, "created");
  assert.match(b.rows[0].error, /Company left blank \(first try: Procore answered 422: contact is invalid\)/);
  assert.equal(b.rows[1].status, "failed");
  assert.match(b.rows[1].error, /Procore answered 403: You do not have sufficient access to complete that action\./);
  assert.equal(rows.get(KEY).size, 1, "only what was made is in the ledger");

  for (const date of ["2099-01-05", "2026-10-17", "bad"]) {
    const out = await post({ action: "send", companyId: C, projectId: P, sample: { ...oneSample(), date } });
    assert.equal(out.statusCode, 400, date);
  }
});

test("ledger and delete: counts per project; delete removes only ledger entries (404 = already gone)", async () => {
  await post({ action: "send", companyId: C, projectId: P, projectName: "Westgate", sample: { ...oneSample(), delivery: null, delay: null } });
  rows.get(KEY).set("gone_notes", { key: KEY, section: "notes", procoreId: "404404", date: "2026-10-13" });
  assert.deepEqual((await post({ action: "ledger" })).json().byKey[KEY], { count: 3, projectName: "Westgate" });

  const out = (await post({ action: "delete", companyId: C, projectId: P })).json();
  assert.deepEqual(out.rows.map((r) => r.status).sort(), ["deleted", "deleted", "skipped"]);
  const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url.replace(/^.*\/projects\/373235\//, ""));
  assert.deepEqual(deletes.sort(), ["manpower_logs/5000", "notes_logs/404404", "notes_logs/5001"]);
  assert.equal(rows.get(KEY).size, 0);
  assert.deepEqual((await post({ action: "ledger" })).json().byKey, {});
});

test("send: the delay type goes as Procore's key; a type Procore drops is reported", async () => {
  const b = (await post({ action: "send", companyId: C, projectId: P, sample: oneSample() })).json();
  const delay = JSON.parse(calls.find((c) => c.method === "POST" && c.url.includes("/delay_logs")).body).delay_log;
  assert.equal(delay.delay_type, "material");
  assert.equal(b.rows.find((r) => r.label === "Delays").error, null);
  const again = (await post({ action: "send", companyId: C, projectId: P, sample: { ...oneSample(), id: "othersample1", delay: { ...oneSample().delay, type: "Existing Conditions" } } })).json();
  assert.match(again.rows.find((r) => r.label === "Delays").error, /Procore didn't keep the delay type \(sent "existing_conditions"\)/);
});

test("check entries: finds only the check page's 'SiteSnap test' entries, deletes them only when asked", async () => {
  const d = workingDays(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()))[0];
  leftovers = {
    manpower: [{ id: 11, date: d, notes: "SiteSnap test" }, { id: 12, date: d, notes: "Electrical · Panel gear" }],
    notes: [{ id: 21, date: d, comment: "SiteSnap test note" }, { id: 22, date: d, comment: `Reported by: Jamal. Pulled wire. ${MARKER}` }],
    delivery: [{ id: 31, date: d, contents: "SiteSnap test delivery" }],
    delay: [{ id: 41, date: d, comments: "SiteSnap test: delay_type = the key" }],
  };
  const found = (await post({ action: "checkentries", companyId: C, projectId: P, dryRun: true })).json().found;
  assert.deepEqual(found.map((f) => f.id).sort(), ["11", "21", "31", "41"]);
  assert.ok(!calls.some((c) => c.method === "DELETE"));
  const out = (await post({ action: "checkentries", companyId: C, projectId: P, dryRun: false })).json();
  assert.ok(out.rows.every((r) => r.status === "deleted"));
  assert.deepEqual(calls.filter((c) => c.method === "DELETE").map((c) => c.url.replace(/^.*\/projects\/373235\//, "")).sort(), ["delay_logs/41", "delivery_logs/31", "manpower_logs/11", "notes_logs/21"]);
});

test("extra foremen: in existing test companies, and the test-people cleanup always keeps them", async () => {
  const { EXTRA_FOREMEN, SEED, cleanupPlan } = await import("../api/_seedDirectory.js");
  assert.deepEqual(EXTRA_FOREMEN.map((f) => [f.user.job_title, SEED[f.company].vendor.name]), [["Plumbing Foreman", "ClearFlow Plumbing & Mechanical"], ["Electrical Foreman", "VoltLine Electric Inc."]]);
  const users = EXTRA_FOREMEN.map((f, i) => ({ id: 90 + i, name: `${f.user.first_name} ${f.user.last_name}`, email_address: f.user.email_address, is_active: true }));
  assert.ok(cleanupPlan({ users, vendors: [], meId: 1 }).users.every((r) => r.action === "keep" && !r.checked));
  assert.deepEqual(findForemen(users.map((u, i) => ({ ...u, job_title: EXTRA_FOREMEN[i].user.job_title }))).candidates.map((c) => c.trade), ["plumbing", "electrical"]);
});
