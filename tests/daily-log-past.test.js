// Past logs (api/procore/daily-log.js view=past, action update/delete) against a mocked Procore. No emulators needed.
// Reads a span of days, marks your own entries, lets you change or delete only your own, says when a Completed day
// is locked, and never sends an approval status.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import dailyLog from "../api/procore/daily-log.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { setStore } from "../api/_firestore.js";
import { entryFromProcore, hhmm, procoreFields, projectDay } from "../api/_dailyLog.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const C = "4291776";
const P = "373235";
const ME = 481274;
const TODAY = projectDay("Pacific Time (US & Canada)");
const day = (n) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let calls, saved, rows, locked, noRead;

const LIST = /\/projects\/373235\/(manpower|delay|delivery|notes)_logs\?/;
const ONE = /\/projects\/373235\/(manpower|delay|delivery|notes)_logs\/(\d+)$/;
const reply = (u, init) => {
  const m = init.method ?? "GET";
  if (/\/me\?/.test(u)) return [200, { id: ME, name: "Derek Lawson" }];
  if (/\/projects\/373235\?/.test(u)) return [200, { id: 373235, time_zone: "Pacific Time (US & Canada)" }];
  if (/\/projects\/373235\/users/.test(u)) return [200, [{ id: ME, name: "Derek Lawson", permission_template: { name: "Subcontractor - External" } }]];
  const l = LIST.exec(u);
  if (l && m === "GET") {
    if (noRead) return [403, { errors: "Forbidden" }];
    const q = new URL(u).searchParams;
    const list = rows.filter((r) => r.kind === l[1]);
    // like Procore: log_date = that day; start/end = the span (page 1 only; fewer than a page)
    if (q.get("log_date")) return [200, list.filter((r) => r.date === q.get("log_date"))];
    return [200, list.filter((r) => r.date >= q.get("start_date") && r.date <= q.get("end_date"))];
  }
  const o = ONE.exec(u);
  if (o) {
    const row = rows.find((r) => r.kind === o[1] && String(r.id) === o[2]);
    if (!row) return [404, { errors: "Not found" }];
    if (m === "GET") return [200, row];
    if (locked) return [403, { errors: "You do not have sufficient access to complete that action." }];
    if (m === "DELETE") { rows = rows.filter((r) => r !== row); return [204, null]; }
    if (m === "PATCH") { Object.assign(row, Object.values(JSON.parse(init.body))[0]); return [200, row]; }
  }
  return [404, { errors: "Not found" }];
};
beforeEach(() => {
  calls = [];
  locked = false;
  noRead = false;
  rows = [
    { kind: "manpower", id: 1, date: TODAY, num_workers: 4, num_hours: 8, contact: { id: 12, name: "ClearFlow Plumbing & Mechanical" }, notes: "Rough-in L2", created_by: { id: ME, name: "Derek Lawson" }, status: "pending", created_at: "2026-10-16T15:00:00Z" },
    { kind: "manpower", id: 2, date: TODAY, num_workers: 6, contact: { id: 10, name: "Ironbridge Construction" }, created_by: { id: 5, name: "Tyler Brandt" }, status: "approved", created_at: "2026-10-16T14:00:00Z" },
    { kind: "delay", id: 3, date: day(-2), delay_type: "weather", start_time: "8:00 AM", end_time: "10:30 AM", comments: "Rain", created_by: { id: ME, name: "Derek Lawson" }, status: "pending" },
    { kind: "delivery", id: 4, date: day(-2), time_hour: 7, time_minute: 30, delivery_from: "Ferguson", contents: "PVC", created_by: { id: ME, name: "Derek Lawson" }, status: "pending" },
    { kind: "notes", id: 5, date: day(-40), comment: "Old", created_by: { id: ME, name: "Derek Lawson" }, attachments: [{ id: 1 }] },
  ];
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log };
  Object.assign(process.env, ENV);
  console.log = () => {};
  setStore(null);
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    const [status, body] = reply(String(url), init);
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.log = saved.log;
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const headers = { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json" };
function res() {
  const h = {};
  return { statusCode: 200, headers: h, setHeader(k, v) { h[k.toLowerCase()] = v; }, getHeader(k) { return h[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const get = async (q) => { const out = res(); await dailyLog({ method: "GET", url: `/api/procore/daily-log?companyId=${C}&projectId=${P}&view=past${q}`, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out); return out; };
const post = async (body) => { const out = res(); await dailyLog({ method: "POST", url: "/api/procore/daily-log", body: { companyId: C, projectId: P, ...body }, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out); return out; };

test("past: two weeks of entries, newest day first, mine marked, read back into the review card's fields", async () => {
  const out = await get(`&from=${day(-13)}&to=${TODAY}`);
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.equal(b.access, true);
  assert.deepEqual(b.entries.map((e) => e.id), [2, 1, 3, 4], "today (by time made), then two days ago; the 40-day-old note is outside the span");
  const [theirs, mine] = b.entries;
  assert.equal(theirs.mine, false);
  assert.equal(theirs.by.name, "Tyler Brandt");
  assert.equal(mine.mine, true);
  assert.deepEqual(mine.entry, { company: 12, companyName: "ClearFlow Plumbing & Mechanical", workers: 4, hours: 8, location: null, locationName: null, trade: "", comment: "Rough-in L2" });
  assert.deepEqual(b.entries[2].entry.start, "08:00");
  assert.deepEqual(b.entries[2].entry.end, "10:30");
  assert.equal(b.entries[3].entry.time, "07:30");
  const read = calls.find((c) => /manpower_logs\?/.test(c.url));
  assert.match(read.url, new RegExp(`start_date=${day(-13)}&end_date=${TODAY}`));
  assert.ok(!/access-1|secret-never-leak/.test(out.body));
});

test("past: one day is read with log_date; a span after today stops at today; more than a month is refused", async () => {
  const one = await get(`&from=${day(-40)}&to=${day(-40)}`);
  assert.deepEqual(one.json().entries.map((e) => [e.id, e.photos]), [[5, 1]]);
  assert.ok(calls.some((c) => c.url.includes(`log_date=${day(-40)}`)));
  assert.equal((await get(`&from=${TODAY}&to=2099-01-01`)).json().to, TODAY);
  assert.equal((await get(`&from=${day(-40)}&to=${TODAY}`)).statusCode, 400);
  assert.equal((await get("&from=nope&to=nope")).statusCode, 400);
});

test("past: no Daily Log access says so, with the person's template", async () => {
  noRead = true;
  const b = (await get(`&from=${TODAY}&to=${TODAY}`)).json();
  assert.equal(b.access, false);
  assert.match(b.reason, /permission to see the Daily Log/);
  assert.equal(b.template, "Subcontractor - External");
});

test("edit your own entry: PATCH with the entry's own date, cleared fields as null, never a status", async () => {
  const out = await post({ action: "update", section: "manpower", id: 1, entry: { workers: 5, hours: null, company: 12, comment: "" } });
  assert.equal(out.statusCode, 200, out.body);
  const sent = calls.find((c) => c.method === "PATCH");
  assert.match(sent.url, /manpower_logs\/1$/);
  const body = JSON.parse(sent.body).manpower_log;
  assert.deepEqual(body, { date: TODAY, num_workers: 5, num_hours: null, contact_id: 12, location_id: null, notes: null });
  assert.ok(!("status" in body));
  assert.equal(out.json().entry.entry.workers, 5);
});

test("someone else's entry can't be changed or deleted; nothing is sent", async () => {
  for (const action of ["update", "delete"]) {
    const out = await post({ action, section: "manpower", id: 2, entry: { workers: 1 } });
    assert.equal(out.statusCode, 403);
    assert.equal(out.json().error, "not_yours");
  }
  assert.ok(!calls.some((c) => c.method === "PATCH" || c.method === "DELETE"));
});

test("delete your own entry", async () => {
  const out = await post({ action: "delete", section: "deliveries", id: 4 });
  assert.equal(out.statusCode, 200, out.body);
  assert.ok(calls.some((c) => c.method === "DELETE" && /delivery_logs\/4$/.test(c.url)));
  assert.ok(!rows.some((r) => r.id === 4));
});

test("a Completed (locked) day: Procore's 403 comes back as day_locked, and SiteSnap doesn't try to reopen it", async () => {
  locked = true;
  const out = await post({ action: "delete", section: "delays", id: 3 });
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().error, "day_locked");
  assert.match(out.json().message, /superintendent to reopen it/);
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 1);
  assert.ok(!calls.some((c) => c.method === "PATCH"), "no status change to get around the lock");
});

test("gone, bad section, bad edit: stopped with plain words", async () => {
  assert.equal((await post({ action: "delete", section: "notes", id: 999 })).json().error, "gone");
  assert.equal((await post({ action: "delete", section: "weather", id: 1 })).statusCode, 400);
  const bad = await post({ action: "update", section: "manpower", id: 1, entry: { workers: "" } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().message, "Add how many workers.");
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("reading back: times and delay types in Procore's shapes; creating still leaves blanks out", () => {
  assert.equal(hhmm("12:05 PM"), "12:05");
  assert.equal(hhmm("12:05 AM"), "00:05");
  assert.equal(hhmm("", null, null), null);
  assert.equal(entryFromProcore("delays", { delay_type: { name: "Weather" } }).entry.type, "Weather");
  assert.deepEqual(procoreFields("notes", { text: "Hi", location: null }, { date: TODAY }), { date: TODAY, comment: "Hi" });
  assert.deepEqual(procoreFields("deliveries", { what: "PVC", time: null, from: "", comment: "" }, { date: TODAY, clear: true }),
    { date: TODAY, time_hour: null, time_minute: null, delivery_from: null, contents: "PVC", comments: null });
});
