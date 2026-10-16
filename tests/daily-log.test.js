// Daily log by voice, the Procore side: api/procore/daily-log.js (options + one entry at a time) and the sandbox
// check page api/procore/test-dailylog.js, against a mocked Procore. No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import dailyLog from "../api/procore/daily-log.js";
import check, { pace } from "../api/procore/test-dailylog.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { setStore } from "../api/_firestore.js";
import { friendlyError, procoreFields, projectDay } from "../api/_dailyLog.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const C = "4291776";
const P = "373235";
let calls, saved, log, refuse, created;
const RL = { "x-rate-limit-limit": "25", "x-rate-limit-remaining": "20", "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 7) };
const SECTION = /\/projects\/373235\/(manpower|delay|delivery|notes)_logs(\/(\d+))?\?|\/projects\/373235\/(manpower|delay|delivery|notes)_logs(\/(\d+))?$/;
const reply = (u, init) => {
  const m = init.method ?? "GET";
  if (/\/me\?/.test(u)) return [200, { id: 481274, name: "Chloe Abara" }];
  if (/\/projects\/373235\?/.test(u)) return [200, { id: 373235, time_zone: "Pacific Time (US & Canada)" }];
  if (/\/companies\?/.test(u)) return [200, [{ id: 4291776, name: "Kyco", is_active: true }]];
  if (/\/v1\.1\/projects\?/.test(u)) return [200, [{ id: 373235, name: "Sandbox Test Project" }]];
  if (/\/projects\/373235\/users/.test(u)) return [200, [{ id: 481274, name: "Chloe Abara", vendor: { id: 10, name: "Ironbridge Construction" }, permission_template: { name: "Foreman / Superintendent - Internal" } }]];
  if (/\/projects\/373235\/vendors/.test(u)) return [200, [{ id: 11, name: "Summit Framing", is_active: true }, { id: 10, name: "Ironbridge Construction", is_active: true }, { id: 99, name: "Old Co", is_active: false }]];
  if (/\/projects\/373235\/locations/.test(u)) return [200, [{ id: 50, node_name: "Level 2" }]];
  if (/daily_logs\/delay_log_types/.test(u)) return [404, { errors: "Not found" }];
  // Shaped like the sandbox's answer (2026-10-16): display_name, no name
  if (/\/projects\/373235\/delay_log_types/.test(u)) return [200, [{ id: 1, display_name: "Weather", translation_key: "weather", visible: true }, { id: 2, english_or_display_name: "Material", translation_key: "material", visible: true }, { id: 3, display_name: "Hidden", visible: false }]];
  if (/\/projects\/373235\/uploads/.test(u)) return [201, { uuid: "UP1", url: "https://storage.test/upload", fields: { key: "k" } }];
  if (/storage\.test\/upload/.test(u)) return [204, null];
  const s = SECTION.exec(u);
  if (s) {
    const kind = s[1] ?? s[4];
    if (refuse === "probe" && m === "GET") return [403, { errors: "Forbidden" }];
    if (m === "GET") return [200, kind === "manpower" ? [{ id: 7, num_workers: 4, contact: { id: 10, name: "Ironbridge Construction" }, status: "pending" }, ...created.filter((x) => x.kind === kind)] : created.filter((x) => x.kind === kind), RL];
    if (m === "DELETE") return [204, null];
    if (refuse === "write") return [403, { errors: "You do not have sufficient access to complete that action." }];
    if (refuse === "busy") return [429, { errors: "Too many requests" }, RL];
    if (refuse === "invalid") return [422, { errors: { num_workers: ["must be greater than 0"] } }];
    const sentType = init.body instanceof FormData ? init.body.get("delay_log[delay_type]") : JSON.parse(init.body ?? "{}").delay_log?.delay_type;
    const row = { id: 900 + created.length, kind, status: "pending", delay_type: kind === "delay" ? sentType ?? "" : undefined, attachments: init.body instanceof FormData ? init.body.getAll(`${kind === "notes" ? "notes" : kind}_log[attachments][]`).map(() => ({ id: 1 })) : [] };
    created.push(row);
    return [201, row, RL];
  }
  return [404, { errors: "Not found" }];
};
const fakeDb = {
  collection: () => ({ doc: (key) => ({ collection: (name) => ({ doc: (id) => ({
    get: async () => ({ exists: log.has(`${key}/${name}/${id}`), data: () => log.get(`${key}/${name}/${id}`) }),
    set: async (v) => { log.set(`${key}/${name}/${id}`, v); },
  }) }) }) }),
};
beforeEach(() => {
  calls = [];
  log = new Map();
  refuse = null;
  created = [];
  pace.gapMs = 0;
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log };
  Object.assign(process.env, ENV);
  console.log = () => {};
  setStore(fakeDb);
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body, headers: init.headers ?? {} });
    const [status, body, headers = {}] = reply(String(url), init);
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.log = saved.log;
  setStore(null);
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const headers = { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json" };
function res() {
  const h = {};
  return { statusCode: 200, headers: h, setHeader(k, v) { h[k.toLowerCase()] = v; }, getHeader(k) { return h[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const get = async (q = "") => { const out = res(); await dailyLog({ method: "GET", url: `/api/procore/daily-log?companyId=${C}&projectId=${P}${q}`, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out); return out; };
const post = async (body) => { const out = res(); await dailyLog({ method: "POST", url: "/api/procore/daily-log", body: { companyId: C, projectId: P, date: "2026-10-16", ...body }, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out); return out; };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");

test("options: access, the project's date in its own time zone, my company, active companies, delay types, today's manpower", async () => {
  const out = await get();
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.equal(b.access, true);
  assert.equal(b.timeZone, "America/Los_Angeles");
  assert.equal(b.date, projectDay("Pacific Time (US & Canada)"));
  assert.deepEqual(b.myCompany, { id: 10, name: "Ironbridge Construction" });
  assert.deepEqual(b.companies.map((c) => c.name), ["Ironbridge Construction", "Summit Framing"], "inactive companies left out, sorted");
  assert.deepEqual(b.delayTypes.map((t) => t.name), ["Weather", "Material"], "from the first path that answers; inactive left out");
  assert.deepEqual(b.locations, [{ id: 50, name: "Level 2" }]);
  assert.deepEqual(b.existing.manpower[0], { id: 7, companyId: 10, companyName: "Ironbridge Construction", workers: 4, status: "pending" });
  const probe = calls.find((c) => /manpower_logs/.test(c.url));
  assert.match(probe.url, /log_date=\d{4}-\d{2}-\d{2}/);
  assert.equal(probe.headers["Procore-Company-Id"], C);
  assert.ok(!/access-1|secret-never-leak/.test(out.body));
});

test("options: a future date is never used; an earlier day is", async () => {
  assert.equal((await get("&date=2099-01-01")).json().date, projectDay("Pacific Time (US & Canada)"));
  assert.equal((await get("&date=2026-10-01")).json().date, "2026-10-01");
});

test("options: a 403 on the day's manpower means no Daily Log for this person (B7)", async () => {
  refuse = "probe";
  const b = (await get()).json();
  assert.equal(b.access, false);
  assert.equal(b.reason, "You don't have permission to use the Daily Log on this project.");
  assert.equal(b.companies, undefined);
});

test("manpower entry: JSON with date, workers, company as contact_id; a retry with the same entry id never makes a second one", async () => {
  const out = await post({ section: "manpower", entryId: "entry-0001", entry: { workers: 6, hours: null, company: 10, comment: "", trade: "Framing" } });
  assert.equal(out.statusCode, 201, out.body);
  const sent = calls.find((c) => c.method === "POST");
  assert.match(sent.url, /\/rest\/v1\.0\/projects\/373235\/manpower_logs$/);
  assert.deepEqual(JSON.parse(sent.body), { manpower_log: { date: "2026-10-16", num_workers: 6, contact_id: 10, notes: "Framing" } });
  assert.equal(sent.headers["Procore-Company-Id"], C);
  assert.equal(out.json().status, "pending");
  calls = [];
  const again = await post({ section: "manpower", entryId: "entry-0001", entry: { workers: 6, company: 10 } });
  assert.equal(again.json().duplicate, true);
  assert.equal(again.json().id, 900);
  assert.ok(!calls.some((c) => c.method === "POST"));
});

test("notes entry with a photo goes as multipart with the photo attached", async () => {
  const out = await post({ section: "notes", entryId: "entry-0002", entry: { text: "Quiet day" }, photos: [{ type: "image/jpeg", data: JPEG }] });
  assert.equal(out.statusCode, 201, out.body);
  const form = calls.find((c) => c.method === "POST").body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("notes_log[comment]"), "Quiet day");
  assert.equal(form.get("notes_log[date]"), "2026-10-16");
  assert.equal(form.getAll("notes_log[attachments][]").length, 1);
});

test("delay and delivery fields", () => {
  assert.deepEqual(procoreFields("delays", { type: "Weather", start: "13:00", end: "15:00", company: 10, location: null, comment: "Rain" }, { date: "2026-10-16" }),
    { date: "2026-10-16", delay_type: "weather", start_time: "13:00", end_time: "15:00", vendor_id: 10, comments: "Rain" });
  assert.deepEqual(procoreFields("deliveries", { what: "Concrete", time: "07:30", from: "ABC Ready Mix", comment: "" }, { date: "2026-10-16" }),
    { date: "2026-10-16", time_hour: 7, time_minute: 30, delivery_from: "ABC Ready Mix", contents: "Concrete" });
});

test("refusals come back in plain words; nothing is remembered as sent", async () => {
  refuse = "write";
  let out = await post({ section: "delays", entryId: "entry-0003", entry: { type: "Weather", comment: "Rain" } });
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().message, "You don't have permission to add delays to the Daily Log on this project.");
  assert.equal(log.size, 0);
  refuse = "busy";
  out = await post({ section: "delays", entryId: "entry-0003", entry: { type: "Weather", comment: "Rain" } });
  assert.equal(out.statusCode, 429);
  assert.equal(out.json().message, "Procore is busy, trying again in a moment.");
  assert.ok(out.json().retryAfter >= 2 && out.json().retryAfter <= 60);
  refuse = "invalid";
  out = await post({ section: "manpower", entryId: "entry-0004", entry: { workers: 0 } });
  assert.equal(out.statusCode, 422);
  assert.match(out.json().message, /Procore said: num workers must be greater than 0/);
  assert.equal(friendlyError("notes", { status: 404 }).message, "The Daily Log isn't turned on for this project in Procore.");
});

test("bad input is stopped before Procore", async () => {
  assert.equal((await post({ section: "manpower", entryId: "entry-0005", entry: { workers: "" } })).statusCode, 400);
  assert.equal((await post({ section: "weather", entryId: "entry-0005", entry: {} })).statusCode, 400);
  assert.equal((await post({ section: "notes", entryId: "x", entry: { text: "hi" } })).statusCode, 400);
  assert.equal((await post({ section: "notes", entryId: "entry-0005", entry: { text: "hi" }, photos: [{ type: "image/tiff", data: JPEG }] })).statusCode, 400);
  assert.ok(!calls.some((c) => c.method === "POST"));
});

test("check page: reads every section, finds the delay types, adds one test entry each (photos on Delays and Notes), reads them back", async () => {
  const out = res();
  await check({ method: "POST", url: "/api/procore/test-dailylog", body: { companyId: C, projectId: P }, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.match(b.who, /Chloe Abara \(template here: Foreman \/ Superintendent - Internal; company: Ironbridge Construction\)/);
  const named = (s) => b.steps.find((x) => x.name.startsWith(s));
  for (const s of ["Manpower", "Delays", "Deliveries", "Notes"]) {
    assert.ok(named(`Read today's ${s}`).ok, s);
    assert.ok(named(`Add a test ${s}`).ok, s);
    assert.ok(named(`Read back the ${s}`).ok, s);
  }
  assert.match(named("Add a test Manpower entry").detail, /sent Ironbridge Construction as contact_id/);
  assert.match(named("Read the project's delay types").detail, /2 type\(s\) at .*: Weather, Material/);
  assert.match(named("Add a test Delays entry").detail, /type "weather"/);
  assert.equal(named("Delay type: delay_type = the name").ok, true);
  assert.equal(named("Delay type: delay_type_id = the id").ok, false, "only a type that comes back counts");
  assert.ok(named("Photo stuck? Delays (as the app sends it)").ok);
  assert.ok(b.steps.some((x) => x.name === "Photo stuck? Note photo: upload_ids"));
  assert.match(named("Rate-limit headers").detail, /limit 25/);
  assert.ok(!b.steps.some((s) => s.name.startsWith("Delete")), "nothing deleted unless asked");
  assert.equal(created.find((x) => x.kind === "delay").attachments.length, 1);
});

test("check page: deletes the test entries when asked, and only runs against the sandbox", async () => {
  let out = res();
  await check({ method: "POST", url: "/api/procore/test-dailylog", body: { companyId: C, projectId: P, cleanup: true }, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  const del = out.json().steps.find((s) => s.name === "Delete the test entries");
  assert.ok(del.ok, del.detail);
  assert.equal(calls.filter((c) => c.method === "DELETE").length, created.length, "every test entry it made");
  process.env.PROCORE_API_URL = "https://api.procore.com";
  out = res();
  await check({ method: "GET", url: "/api/procore/test-dailylog", headers }, out);
  assert.equal(out.statusCode, 403);
});
