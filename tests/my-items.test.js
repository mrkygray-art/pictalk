// My items (api/_myItems.js, api/procore/my-items.js): Procore-shaped Observations and Punch Items, mine only,
// grouped Overdue / Open / Ready for review, and the badge counts from the same answer. Mocked Procore, no emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import myItems from "../api/procore/my-items.js";
import { assignedToMe, countsOf, groupItems, itemDetail, itemRow, stageOf } from "../api/_myItems.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const ME = 481274;
const obs = (id, extra = {}) => ({ id, number: id, name: `Obs ${id}`, status: "initiated", due_date: null, assignee: { id: ME, name: "Edward" }, created_by: { id: 9, name: "Dana PM" }, location: { node_name: "Level 2 > East" }, created_at: "2026-10-10T15:00:00Z", ...extra });
const punch = (id, extra = {}) => ({ id, position: id, name: `Punch ${id}`, status: "Open", workflow_status: "work_required", due_date: null, assignees: [{ id: ME, name: "Edward" }], punch_item_manager: { id: 8, name: "Marcus Super" }, created_at: "2026-10-11T15:00:00Z", ...extra });
let saved, calls, obsStatus, punchStatus;
const obsRows = [obs(1, { due_date: "2026-10-01" }), obs(2, { due_date: "2099-10-30" }), obs(3, { status: "ready_for_review" }), obs(4, { status: "closed" }), obs(5, { assignee: { id: 77, name: "Someone else" } })];
const punchRows = [punch(11, { due_date: "2026-10-05" }), punch(12), punch(13, { workflow_status: "ready_for_review" }), punch(14, { assignees: [{ id: 77 }] })];

beforeEach(() => {
  calls = [];
  obsStatus = 200;
  punchStatus = 200;
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log };
  Object.assign(process.env, ENV);
  console.log = () => {};
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (/\/rest\/v1\.0\/me\?/.test(u)) return json(200, { id: ME, name: "Edward" });
    if (/\/rest\/v1\.0\/projects\/373235\?/.test(u)) return json(200, { id: 373235, time_zone: "Pacific Time (US & Canada)" });
    if (/\/observations\/items\/3\?/.test(u)) return json(200, { ...obs(3, { status: "ready_for_review" }), description: "Cracked tile at the door", attachments: [{ url: "https://storage.procore.com/a/1.jpg", name: "crack.jpg" }, { url: "https://storage.procore.com/a/2.pdf", name: "spec.pdf" }] });
    if (/\/observations\/items\?/.test(u)) return obsStatus === 200 ? json(200, obsRows) : json(obsStatus, { errors: "Forbidden" });
    if (/\/punch_items\?/.test(u)) return punchStatus === 200 ? json(200, punchRows) : json(punchStatus, { errors: "Forbidden" });
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.log = saved.log;
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
async function get(qs) {
  const headers = {};
  const out = { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
  await myItems({ method: "GET", url: `/api/procore/my-items?${qs}`, headers: { host: "sitesnap-procore.vercel.app", cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  return out;
}

test("stages: Procore's statuses become open / ready / closed", () => {
  assert.equal(stageOf("observation", { status: "initiated" }).stage, "open");
  assert.equal(stageOf("observation", { status: "not_accepted" }).label, "Not accepted");
  assert.equal(stageOf("observation", { status: "ready_for_review" }).stage, "ready");
  assert.equal(stageOf("punch_item", { status: "Open", workflow_status: "ready_to_close" }).stage, "ready");
  assert.equal(stageOf("punch_item", { status: "Closed" }).stage, "closed");
});

test("assigned to me: observation assignee, punch assignees or assignments", () => {
  assert.equal(assignedToMe("observation", obs(1), ME), true);
  assert.equal(assignedToMe("observation", obs(5, { assignee: { id: 77 } }), ME), false);
  assert.equal(assignedToMe("punch_item", punch(1), ME), true);
  assert.equal(assignedToMe("punch_item", { assignments: [{ login_information_id: ME }] }, ME), true);
  assert.equal(assignedToMe("punch_item", { assignees: [{ id: 1 }] }, ME), false);
});

test("groups: overdue / open / ready by due date, closed left out; the badge counts open + overdue", () => {
  const rows = [...obsRows.map((r) => itemRow("observation", r)), ...punchRows.map((r) => itemRow("punch_item", r))];
  const g = groupItems(rows, "2026-10-17");
  assert.deepEqual(g.overdue.map((r) => r.id), ["1", "11"]);
  assert.ok(g.open.findIndex((r) => r.id === "2") < g.open.findIndex((r) => r.id === "12"), "dated before undated");
  assert.deepEqual(g.ready.map((r) => r.id).sort(), ["13", "3"]);
  assert.ok(!Object.values(g).flat().some((r) => r.id === "4"));
  assert.deepEqual(countsOf({ overdue: [1, 2], open: [1], ready: [1, 2, 3] }), { open: 3, overdue: 2 });
});

test("GET: mine only from both tools, grouped, counts match the list", async () => {
  const out = await get("companyId=4291776&projectId=373235");
  assert.equal(out.statusCode, 200);
  const b = out.json();
  const all = [...b.groups.overdue, ...b.groups.open, ...b.groups.ready];
  assert.ok(!all.some((r) => ["5", "14", "4"].includes(r.id)), "other people's and closed items left out");
  assert.deepEqual(b.counts, { open: b.groups.overdue.length + b.groups.open.length, overdue: b.groups.overdue.length });
  assert.equal(b.groups.overdue.length, 2);
  assert.match(b.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(all.find((r) => r.id === "11").assignedBy, "Marcus Super");
  assert.equal(all.find((r) => r.id === "1").location, "Level 2 > East");
  assert.match(all[0].url, /^https:\/\/sandbox\.procore\.test\/373235\/project\//);
  assert.ok(calls.some((u) => u.includes("filters%5Bassignee_id%5D%5B%5D=481274")), "observations asked for mine");
});

test("GET: no Punch List access shows the Observations without an error; both refused is a plain 403", async () => {
  punchStatus = 403;
  const one = await get("companyId=4291776&projectId=373235");
  assert.equal(one.statusCode, 200);
  assert.equal(one.json().tools.punch, "denied");
  assert.ok(one.json().groups.open.length > 0);
  obsStatus = 403;
  const none = await get("companyId=4291776&projectId=373235");
  assert.equal(none.statusCode, 403);
  assert.match(none.json().message, /Ask your project admin/);
});

test("detail: description and image attachments only", async () => {
  const { item } = (await get("companyId=4291776&projectId=373235&type=observation&id=3")).json();
  assert.equal(item.description, "Cracked tile at the door");
  assert.deepEqual(item.photos.map((p) => p.name), ["crack.jpg"]);
  assert.equal(item.stage, "ready");
  assert.equal(itemDetail("punch_item", { id: 1, assignments: [{ attachments: [{ url: "https://x.procore.com/p.png", filename: "p.png" }] }] }).photos.length, 1);
});
