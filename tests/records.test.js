// Step 3: creating the confirmed record in Procore (api/_records.js, api/procore/records.js,
// api/procore/record-options.js) against a mocked Procore shaped like the sandbox's answers. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import records from "../api/procore/records.js";
import recordOptions from "../api/procore/record-options.js";
import { cleanCard, descriptionHtml, observationBody, punchBody } from "../api/_records.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
let calls, routes, saved;
beforeEach(() => {
  calls = [];
  routes = [];
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, ENV);
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const r = routes.find((x) => (init.method ?? "GET") === x.method && x.re.test(u));
    if (!r) throw new Error(`unexpected fetch ${init.method ?? "GET"} ${u}`);
    const { status = 200, body = {} } = typeof r.reply === "function" ? r.reply(u, init) : r.reply;
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { log: saved.log, error: saved.error });
});
const on = (method, re, reply) => routes.push({ method, re, reply });
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = (method, url, body, headers = {}) => ({
  method, url, body,
  headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}`, ...headers },
});
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const run = async (h, r) => { const out = res(); await h(r, out); return out; };

function procore({ observationRefusesAssignee = false } = {}) {
  on("GET", /\/rest\/v1\.0\/companies\?/, { body: [{ id: 4291776, name: "Kyco", is_active: true }] });
  on("GET", /\/rest\/v1\.1\/projects\?/, { body: [{ id: 373235, name: "Sandbox Test Project" }] });
  on("GET", /\/rest\/v1\.0\/me\?/, { body: { id: 481274, login: "e@example.com", name: "Edward Gray" } });
  let n = 0;
  on("POST", /\/projects\/373235\/uploads$/, () => ({ status: 201, body: { uuid: `U${++n}`, url: "https://storage.test/b", fields: { key: `k${n}` } } }));
  on("POST", /^https:\/\/storage\.test\/b$/, { status: 204 });
  on("POST", /\/observations\/items$/, (u, init) => {
    const b = JSON.parse(init.body);
    if (observationRefusesAssignee && b.observation.assignee_ids) return { status: 403, body: { errors: "Ineligible assignees", ineligible_assignees: [{ id: 900, name: "Lisa Hubbard" }] } };
    return { status: 201, body: { id: 370999, number: "4" } };
  });
  on("POST", /\/rest\/v1\.1\/punch_items$/, { status: 201, body: { id: 196900, position: 2 } });
  on("POST", /\/send_email\?project_id=373235$/, { status: 200, body: {} });
}

const card = (over) => ({
  recordType: "punch_item", title: "Redo drywall in Room 204", description: "The drywall in Room 204 needs to be redone.",
  transcript: "Tell Lisa the drywall in room 204 needs to be redone by Friday.", tradeId: 2, locationText: "Room 204",
  priority: "medium", assigneeIds: [900], dueDate: "2026-10-16", captureId: "cap-1", ...over,
});
const photo = { name: "SiteSnap-photo-1.jpg", type: "image/jpeg", data: Buffer.from("fakejpeg").toString("base64") };
const voice = { name: "SiteSnap-voice.webm", type: "audio/webm", data: Buffer.from("fakeaudio").toString("base64") };

test("the record body: not private, HTML description with 'Reported by' and the words as said, ids as numbers", () => {
  const c = cleanCard(card({ recordType: "observation", observationTypeId: "11036845", priority: "high", assigneeIds: ["900", "x", 900] }));
  const o = observationBody(c, "373235", { reporterName: "Edward Gray", uploadIds: ["U1"], link: "https://sitesnap-procore.vercel.app" });
  assert.equal(o.project_id, 373235);
  assert.equal(o.observation.personal, false, "the project defaults to private: always send false");
  assert.equal(o.observation.type_id, 11036845);
  assert.equal(o.observation.priority, "High");
  assert.deepEqual(o.observation.assignee_ids, [900]);
  assert.deepEqual(o.observation.mt_location, ["Room 204"]);
  assert.equal(o.observation.due_date, "2026-10-16");
  assert.match(o.observation.description, /^<p>The drywall in Room 204 needs to be redone\.<\/p><p>Reported by Edward Gray via SiteSnap AI\.<\/p><p>What was said: "Tell Lisa/);
  const p = punchBody(cleanCard(card({ impactMentioned: true })), "373235", { reporterName: "Edward Gray" });
  assert.equal(p.punch_item.private, false);
  assert.equal(p.punch_item.reference, "Reported by Edward Gray via SiteSnap AI");
  assert.deepEqual(p.punch_item.login_information_ids, [900]);
  assert.equal(p.punch_item.due, "2026-10-16");
  assert.equal(p.punch_item.cost_impact, "yes_unknown");
  assert.match(descriptionHtml({ description: "<b>x</b>", transcript: "" }, "A & B"), /&lt;b&gt;x&lt;\/b&gt;.*A &amp; B/, "text is escaped");
});

test("a card that can't become a record is refused with a plain reason", () => {
  assert.throws(() => cleanCard(card({ recordType: "rfi" })), /Observation or Punch Item/);
  assert.throws(() => cleanCard(card({ title: "  " })), /title/);
  assert.throws(() => cleanCard(card({ recordType: "observation", observationTypeId: null })), /kind of observation/);
  assert.equal(cleanCard(card({ dueDate: "Friday" })).dueDate, null, "only real dates");
});

test("sends a Punch Item with the photo and voice note attached, then emails the assignee only", async () => {
  procore();
  const out = await run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373235", card: card(), files: [photo, voice], link: "https://sitesnap-procore.vercel.app" }));
  assert.equal(out.statusCode, 201, out.body);
  assert.deepEqual(out.json(), { recordType: "punch_item", id: 196900, number: 2, url: "https://sandbox.procore.test/373235/project/punch_list/196900", warnings: [], reporterName: "Edward Gray" });
  const made = JSON.parse(calls.find((c) => /punch_items$/.test(c.url) && c.method === "POST").body);
  assert.deepEqual(made.punch_item.upload_ids, ["U1", "U2"]);
  const mail = calls.find((c) => /send_email/.test(c.url));
  assert.match(mail.url, /\/rest\/v1\.1\/punch_items\/196900\/send_email\?project_id=373235$/);
  assert.deepEqual(JSON.parse(mail.body).distribution_ids, [900], "the assignee only");
  assert.ok(!out.body.includes("access-1") && !out.body.includes("secret-never-leak"));
});

test("an Observation Procore won't let them assign is created unassigned, with a plain warning", async () => {
  procore({ observationRefusesAssignee: true });
  const out = await run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373235", card: card({ recordType: "observation", observationTypeId: 11036845 }), files: [] }));
  assert.equal(out.statusCode, 201, out.body);
  assert.equal(out.json().number, "4");
  assert.match(out.json().warnings[0], /Created without an assignee/);
  assert.ok(!calls.some((c) => /send_email/.test(c.url)), "no one to email");
});

test("refuses: a project they're not on, no sign-in, another site, odd files; nothing created", async () => {
  procore();
  const other = await run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "999", card: card(), files: [] }));
  assert.equal(other.statusCode, 403);
  const html = await run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373235", card: card(), files: [{ name: "x.html", type: "text/html", data: "PGI+" }] }));
  assert.equal(html.statusCode, 400);
  const cross = await run(records, req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373235", card: card() }, { origin: "https://evil.example" }));
  assert.equal(cross.statusCode, 403);
  const anon = await run(records, { ...req("POST", "/api/procore/records", { companyId: "4291776", projectId: "373235", card: card() }), headers: { ...req("POST", "/").headers, cookie: "" } });
  assert.equal(anon.statusCode, 401);
  assert.ok(!calls.some((c) => c.method === "POST" && /punch_items|observations/.test(c.url)), "nothing created");
});

test("record-options: the project's Observation types, trades and locations", async () => {
  on("GET", /observation_types$/, { body: [{ id: 1, name: "Deficiency", category: "Quality", active: true }, { id: 2, name: "Old", category: "Quality", active: false }] });
  on("GET", /\/companies\/4291776\/trades$/, { body: [{ id: 5, name: "Drywall", active: true }] });
  on("GET", /\/projects\/373235\/locations\?/, { body: [{ id: 50, node_name: "Level 2", name: "Building A > Level 2" }] });
  const out = await run(recordOptions, req("GET", "/api/procore/record-options?companyId=4291776&projectId=373235"));
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(out.json(), {
    observationTypes: [{ id: 1, name: "Deficiency", category: "Quality" }],
    trades: [{ id: 5, name: "Drywall" }],
    locations: [{ id: 50, name: "Level 2" }],
    canObservations: true,
  });
});
