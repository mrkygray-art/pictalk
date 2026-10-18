// Sample My items for the guest demo (api/_demoMyItems.js): what Procore is sent, that a second run skips what's
// there, and that Remove deletes only the samples. Mocked Procore, no emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { addMyItemsSamples, MY_ITEMS_SAMPLES, removeMyItemsSamples, sampleBody } from "../api/_demoMyItems.js";
import { itemRow } from "../api/_myItems.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const GUEST = "481805";
let saved, calls, records, nextId;
beforeEach(() => {
  calls = [];
  records = [{ id: 1, name: "Someone else's real item" }];
  nextId = 100;
  saved = { fetch: globalThis.fetch, env: { ...process.env } };
  Object.assign(process.env, ENV);
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? "GET";
    calls.push({ method, u, body: init.body ? JSON.parse(init.body) : null });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (/observation_types/.test(u)) return json(200, [{ id: 7, name: "Deficiency", category: "quality", active: true }, { id: 8, name: "Safety Hazard", category: "safety", active: true }]);
    if (method === "GET") return json(200, u.includes("punch") ? records.filter((r) => r.kind === "punch") : records.filter((r) => r.kind !== "punch"));
    if (method === "POST") { const b = JSON.parse(init.body); const name = (b.observation ?? b.punch_item).name; records.push({ id: nextId, name, kind: b.punch_item ? "punch" : "obs" }); return json(201, { id: nextId++, number: 3 }); }
    if (method === "PATCH") return json(200, {});
    if (method === "DELETE") { records = records.filter((r) => !u.includes(`/${r.id}?`)); return new Response(null, { status: 204 }); }
    throw new Error(`unexpected ${method} ${u}`);
  };
});
afterEach(() => { globalThis.fetch = saved.fetch; process.env = saved.env; });
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = { headers: { host: "sitesnap-procore.vercel.app", cookie: `${SESSION_COOKIE}=${cookie()}` } };
const res = { setHeader() {}, getHeader() {} };
const cfg = { apiUrl: ENV.PROCORE_API_URL, loginUrl: ENV.PROCORE_LOGIN_URL, clientId: "id", clientSecret: "x", sessionSecret: ENV.SESSION_SECRET };
const projects = [{ code: "HP", companyId: "4291776", projectId: "373715" }];

test("three samples per demo project: one overdue, one open, one Ready for review", () => {
  for (const code of ["HP", "WG", "LV"]) {
    const list = MY_ITEMS_SAMPLES[code];
    assert.equal(list.length, 3);
    assert.equal(list.filter((s) => s.due != null && s.due < 0).length, 1);
    assert.equal(list.filter((s) => s.ready).length, 1);
  }
});

test("the request: tagged title, the guest as assignee, a past due date for the overdue one", () => {
  const obs = sampleBody(MY_ITEMS_SAMPLES.HP[0], { projectId: "373715", guestUserId: GUEST, observationTypeId: 7, today: "2026-10-17" });
  assert.equal(obs.path, "/rest/v1.0/observations/items");
  assert.match(obs.body.observation.name, /^\[SS-DEMO\] Recheck anchor bolt/);
  assert.deepEqual(obs.body.observation.assignee_ids, [481805]);
  assert.equal(obs.body.observation.due_date, "2026-10-15");
  assert.equal(obs.body.observation.type_id, 7);
  const punch = sampleBody(MY_ITEMS_SAMPLES.WG[1], { projectId: "373716", guestUserId: GUEST, observationTypeId: null, today: "2026-10-17" });
  assert.equal(punch.path, "/rest/v1.1/punch_items");
  assert.deepEqual(punch.body.punch_item.login_information_ids, [481805]);
  assert.equal(punch.body.punch_item.due, "2026-10-22");
});

test("add: makes them, sets the ready one to Ready for review, and a second run skips them", async () => {
  const first = await addMyItemsSamples(req, res, cfg, { projects, guestUserId: GUEST, today: "2026-10-17" });
  assert.equal(first.filter((l) => l.ok && l.detail.startsWith("made")).length, 3);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
  assert.match(first[2].detail, /Ready for review/);
  const before = calls.filter((c) => c.method === "POST").length;
  const again = await addMyItemsSamples(req, res, cfg, { projects, guestUserId: GUEST, today: "2026-10-17" });
  assert.ok(again.every((l) => l.detail === "already there"));
  assert.equal(calls.filter((c) => c.method === "POST").length, before);
});

test("remove: deletes only the samples", async () => {
  await addMyItemsSamples(req, res, cfg, { projects, guestUserId: GUEST, today: "2026-10-17" });
  const r = await removeMyItemsSamples(req, res, cfg, { projects });
  assert.equal(r.removed, 3);
  assert.deepEqual(records.map((x) => x.name), ["Someone else's real item"]);
});

test("My items shows the titles without the [SS-DEMO] tag", () => {
  assert.equal(itemRow("observation", { id: 1, name: "[SS-DEMO] Exit sign out" }).title, "Exit sign out");
  assert.equal(itemRow("observation", { id: 1, name: "[SS-DEMO][ARCHIVED] Old" }).title, "Old");
});
