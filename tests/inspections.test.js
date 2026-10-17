// Inspections (sitesnap-inspections-spec.md), the Procore side: api/_inspections.js, api/procore/inspections.js and
// the sandbox check page api/procore/test-inspections.js, against a mocked Procore shaped like Westgate's
// [Procore] Site Safety Inspection #1 / #2. Plus the phone's voice commands. No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import inspections from "../api/procore/inspections.js";
import check, { pace } from "../api/procore/test-inspections.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { setStore } from "../api/_firestore.js";
import { answerOf, groupInspections, inspectionDetail, inspectionSummary, itemKind, responseBody } from "../api/_inspections.js";
import { voiceCommand } from "../src/messaging/inspectionVoice.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const C = "4291776";
const P = "373716";
const ME = 111; // Edward
const DANA = 222;
const SUB = 30; // Ironbridge? no: a sub vendor

const item = (id, name, position, extra = {}) => ({ id, name, position, status: "none", item_response: null, type: { id: 1, category: "default", name: "default" }, attachments: [], comments: [], observations: [], ...extra });
let lists, refuse, calls, ops, made, hideNa;
function freshLists() {
  return {
    9001: {
      id: 9001, name: "[Procore] Site Safety Inspection", number: 1, status: "Open", item_count: 4, inspected_item_count: 1, not_inspected_item_count: 3,
      inspectors: [{ id: ME, name: "Edward Gray" }, { id: DANA, name: "Dana Whitfield" }, { id: 333, name: "Marcus Ortega" }],
      responsible_contractor: null, location: null, due_at: null, description: "A very long legal disclaimer…",
      sections: [
        { id: 51, name: "General", position: 2, not_applicable: false, items: [item(701, "Fire extinguishers in place", 1), item(702, "Exits are marked", 2, { status: "yes", item_response: { status: "conforming", responder: { id: DANA, name: "Dana Whitfield" }, responded_at: "2026-10-16T15:00:00Z", payload: {} } })] },
        { id: 50, name: "Fall Protection and Perimeter Protection", position: 1, not_applicable: false, items: [item(601, "Guardrails installed", 1), item(602, "Guardrails installed", 2)] },
      ],
    },
    9002: {
      id: 9002, name: "[Procore] Site Safety Inspection", number: 2, status: "Open", item_count: 1, inspected_item_count: 0,
      inspectors: [{ id: ME, name: "Edward Gray" }], responsible_contractor: { id: SUB, name: "VoltLine Electric" }, location: { id: 77, node_name: "Level 2" },
      due_at: "2026-10-20T00:00:00Z", sections: [{ id: 60, name: "Electrical", position: 1, not_applicable: false, items: [item(801, "Temporary panels covered", 1)] }],
    },
    9003: { id: 9003, name: "OAC Pre-Drywall Checklist", number: 1, status: "Open", item_count: 0, inspectors: [{ id: DANA, name: "Dana Whitfield" }], sections: [] },
    9004: { id: 9004, name: "Old one", number: 3, status: "Closed", item_count: 2, inspected_item_count: 2, inspectors: [], sections: [] },
  };
}
const findItemRaw = (itemId) => { for (const l of Object.values(lists)) for (const s of l.sections ?? []) for (const it of s.items) if (String(it.id) === String(itemId)) return { l, s, it }; return null; };
const json = (init) => (typeof init.body === "string" ? JSON.parse(init.body) : null);

const reply = (u, init) => {
  const m = init.method ?? "GET";
  if (/\/me\?/.test(u)) return [200, { id: ME, name: "Edward Gray", login: "edward@example.com" }];
  if (/\/companies\?/.test(u)) return [200, [{ id: Number(C), name: "Kyco", is_active: true }]];
  if (/\/v1\.1\/projects\?/.test(u)) return [200, [{ id: Number(P), name: "Westgate Distribution Center" }]];
  if (/\/projects\/373716\/users/.test(u)) return [200, [{ id: ME, name: "Edward Gray", vendor: { id: SUB, name: "VoltLine Electric" } }]];
  if (new RegExp(`/projects/${P}/checklist/lists\\?`).test(u)) {
    if (refuse === "list") return [403, { errors: "Forbidden" }];
    return [200, Object.values(lists).map(({ sections, ...rest }) => rest)]; // eslint-disable-line no-unused-vars
  }
  let x = /\/rest\/v1\.0\/checklist\/lists\/(\d+)\?project_id=/.exec(u);
  if (x && m === "GET") {
    if (!lists[x[1]]) return [404, { errors: "Not found" }];
    // The sandbox's read has no not_applicable on sections
    return [200, hideNa ? { ...lists[x[1]], sections: lists[x[1]].sections.map(({ not_applicable, ...sec }) => sec) } : lists[x[1]]]; // eslint-disable-line no-unused-vars
  }
  x = /\/projects\/373716\/checklist\/items\/(\d+)\/item_response$/.exec(u);
  if (x && m === "POST") {
    if (refuse === "answer") return [403, { errors: "You do not have sufficient access" }];
    if (refuse === "respond404") return [404, { errors: "Not found" }];
    const hit = findItemRaw(x[1]);
    const b = json(init).item_response;
    hit.it.item_response = { status: b.status ?? "neutral", responder: { id: ME, name: "Edward Gray" }, responded_at: "2026-10-16T18:00:00Z", payload: { text_value: b.text_value } };
    return [201, hit.it.item_response];
  }
  x = /\/rest\/v1\.0\/checklist\/lists\/(\d+)\/items\/(\d+)$/.exec(u);
  if (x && m === "PATCH") {
    const hit = findItemRaw(x[2]);
    if (init.body instanceof FormData) { hit.it.attachments.push({ id: 1 }); return [200, { ...hit.it }]; }
    hit.it.status = json(init).item.status;
    return [200, hit.it];
  }
  x = /\/rest\/v1\.0\/checklist\/lists\/(\d+)\/sections\/(\d+)\/toggle_not_applicable$/.exec(u);
  if (x && m === "PATCH") {
    // Like the sandbox (2026-10-16): on answers every item not_applicable, off clears them all
    const s = lists[x[1]].sections.find((y) => String(y.id) === x[2]);
    s.not_applicable = !s.not_applicable;
    for (const i of s.items) Object.assign(i, s.not_applicable ? { status: "n/a", item_response: { status: "not_applicable", responder: { id: ME, name: "Edward Gray" }, payload: null } } : { status: "none", item_response: null });
    return [200, { id: s.id, name: s.name, position: s.position, not_applicable: s.not_applicable }];
  }
  if (/\/rest\/v1\.0\/checklist\/lists\/\d+\/comments$/.test(u)) return refuse === "note" ? [404, { message: "Item not found" }] : [201, { id: 5 }];
  x = /\/v1\.1\/projects\/373716\/checklist\/lists\/(\d+)\/close$/.exec(u);
  if (x) return refuse === "close" ? [403, { errors: "Forbidden" }] : [200, { ...lists[x[1]], status: "Closed" }];
  if (/\/observations\/items$/.test(u) && m === "POST") {
    const b = json(init);
    if (refuse === "link" && b.inspection_item_failed) return [422, { errors: { checklist_item: ["can't be linked"] } }];
    made.push(b);
    if (b.inspection_item_failed) { const hit = findItemRaw(b.observation.checklist_item_id); hit.it.status = "no"; hit.it.observations.push({ id: 4000 + made.length, number: made.length }); }
    return [201, { id: 4000 + made.length, number: made.length }];
  }
  if (/\/projects\/373716\/uploads/.test(u)) return [201, { uuid: "UP1", url: "https://storage.test/upload", fields: { key: "k" } }];
  if (/storage\.test\/upload/.test(u)) return [204, null];
  return [404, { errors: "Not found" }];
};
const fakeDb = {
  collection: () => ({ doc: (key) => ({ collection: (name) => ({ doc: (id) => ({
    get: async () => ({ exists: ops.has(`${key}/${name}/${id}`), data: () => ops.get(`${key}/${name}/${id}`) }),
    set: async (v) => { ops.set(`${key}/${name}/${id}`, v); },
  }) }) }) }),
};
let saved;
beforeEach(() => {
  lists = freshLists();
  refuse = null;
  hideNa = false;
  calls = [];
  ops = new Map();
  made = [];
  pace.gapMs = 0;
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log, warn: console.warn };
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
const get = async (q = "") => { const out = res(); await inspections({ method: "GET", url: `/api/procore/inspections?companyId=${C}&projectId=${P}${q}`, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out); return out; };
const post = async (body, handler = inspections) => { const out = res(); await handler({ method: "POST", url: "/api/procore/inspections", body: { companyId: C, projectId: P, ...body }, headers: { ...headers, cookie: `${SESSION_COOKIE}=${cookie()}` } }, out); return out; };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const card = (extra = {}) => ({ title: "Temporary panel uncovered", description: "Panel at the east wall has no cover", observationTypeId: 11036845, assigneeIds: [], ...extra });

test("list: assigned to me (inspector), my company's work (responsible contractor), open on the project; closed ones left out", async () => {
  const out = await get();
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.equal(b.access, true);
  assert.deepEqual(b.groups.mine.map((r) => r.title), ["[Procore] Site Safety Inspection #2", "[Procore] Site Safety Inspection #1"], "due soonest first, then no due date");
  assert.deepEqual(b.groups.company.map((r) => r.title), ["[Procore] Site Safety Inspection #2"], "VoltLine is my company and #2's responsible contractor");
  assert.deepEqual(b.groups.open.map((r) => r.title), ["OAC Pre-Drywall Checklist #1"], "someone else's, still open; the closed one is left out");
  const one = b.groups.mine[1];
  assert.deepEqual(one.progress, { done: 1, total: 4 });
  assert.equal(one.status, "In progress");
  assert.equal(b.groups.mine[0].location, "Level 2");
  assert.equal(b.groups.mine[0].due, "2026-10-20");
  assert.ok(!/access-1|secret-never-leak/.test(out.body));
  assert.equal(calls.find((c) => /checklist\/lists\?/.test(c.url)).headers["Procore-Company-Id"], C);
});

test("list: a 403 is the plain no-permission message, never a raw code", async () => {
  refuse = "list";
  const b = (await get()).json();
  assert.equal(b.access, false);
  assert.equal(b.reason, "Your Procore role can't see Inspections on this project. Ask your project manager for access.");
});

test("one inspection: sections in Procore's order, items numbered 1.1, 1.2, 2.1; repeated text told apart by number; who answered", async () => {
  const b = (await get("&id=9001")).json();
  assert.equal(b.access, true);
  assert.equal(b.myId, String(ME));
  const s = b.inspection.sections;
  assert.deepEqual(s.map((x) => x.name), ["Fall Protection and Perimeter Protection", "General"]);
  assert.deepEqual(s[0].items.map((i) => `${i.number} ${i.text}`), ["1.1 Guardrails installed", "1.2 Guardrails installed"]);
  assert.equal(s[1].items[1].number, "2.2");
  assert.deepEqual(s[1].items[1].answer.by, { id: String(DANA), name: "Dana Whitfield" });
  assert.equal(s[1].items[1].answer.counts, "pass");
  assert.deepEqual(b.inspection.counts, { total: 4, answered: 1, pass: 1, fail: 0, na: 0, neutral: 0 });
  assert.equal(b.inspection.description, "A very long legal disclaimer…");
});

test("answer: Pass is sent as item_response conforming with the company header, and the fresh item comes back", async () => {
  const out = await post({ listId: "9001", action: "answer", itemId: "601", answer: { counts: "pass" } });
  assert.equal(out.statusCode, 200, out.body);
  const sent = calls.find((c) => /item_response$/.test(c.url));
  assert.match(sent.url, /\/rest\/v1\.0\/projects\/373716\/checklist\/items\/601\/item_response$/);
  assert.deepEqual(JSON.parse(sent.body), { item_response: { status: "conforming" } });
  assert.equal(sent.headers["Procore-Company-Id"], C);
  const b = out.json();
  assert.equal(b.way, "item_response");
  assert.equal(b.item.answer.counts, "pass");
  assert.equal(b.counts.pass, 2);
});

test("answer: Fail = non_conforming, N/A = not_applicable; the older PATCH is used only when item_response isn't there", async () => {
  assert.deepEqual(responseBody({ kind: "passfail" }, { counts: "fail" }), { item_response: { status: "non_conforming" } });
  assert.deepEqual(responseBody({ kind: "passfail" }, { counts: "na" }), { item_response: { status: "not_applicable" } });
  refuse = "respond404";
  const out = await post({ listId: "9001", action: "answer", itemId: "601", answer: { counts: "na" } });
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(out.json().way, "item_patch");
  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(JSON.parse(patch.body), { project_id: 373716, section_id: 50, item: { status: "n/a" } });
});

test("answer: someone else answered first -> 409 'Already answered by Dana Whitfield'; known or force sends it", async () => {
  const out = await post({ listId: "9001", action: "answer", itemId: "702", answer: { counts: "fail" } });
  assert.equal(out.statusCode, 409);
  const b = out.json();
  assert.equal(b.error, "already_answered");
  assert.equal(b.message, "Already answered by Dana Whitfield.");
  assert.equal(b.answer.counts, "pass");
  assert.ok(!calls.some((c) => /item_response$/.test(c.url)), "nothing overwritten");
  const seen = await post({ listId: "9001", action: "answer", itemId: "702", answer: { counts: "fail" }, known: { byId: String(DANA), at: "2026-10-16T15:00:00Z" } });
  assert.equal(seen.statusCode, 200, "the phone already showed Dana's answer: the foreman chose to change it");
  lists = freshLists();
  const forced = await post({ listId: "9001", action: "answer", itemId: "702", answer: { counts: "fail" }, force: true });
  assert.equal(forced.statusCode, 200, "Use Mine");
  lists = freshLists();
  const same = await post({ listId: "9001", action: "answer", itemId: "702", answer: { counts: "pass" } });
  assert.equal(same.statusCode, 200, "the same answer isn't a conflict");
});

test("answer: a 403 becomes a plain message", async () => {
  refuse = "answer";
  const out = await post({ listId: "9001", action: "answer", itemId: "601", answer: { counts: "pass" } });
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().message, "Your Procore role can't answer items on this inspection. Ask your project manager for access.");
});

test("section N/A: toggled only when it differs, so a retry never flips it back", async () => {
  const on = await post({ listId: "9001", action: "section_na", sectionId: "50", na: true });
  assert.deepEqual(on.json(), { ok: true, na: true, changed: true });
  assert.equal(lists[9001].sections.find((s) => s.id === 50).not_applicable, true);
  const again = await post({ listId: "9001", action: "section_na", sectionId: "50", na: true });
  assert.deepEqual(again.json(), { ok: true, na: true, changed: false });
  assert.equal(calls.filter((c) => /toggle_not_applicable/.test(c.url)).length, 1);
  const sec = (await get("&id=9001")).json().inspection.sections[0];
  assert.equal(sec.na, true);
});

test("photo: multipart PATCH on the item with attachments[] and its answer unchanged; once only per op id", async () => {
  const body = { listId: "9001", action: "photo", itemId: "702", opId: "op-photo-0001", photo: { type: "image/jpeg", data: JPEG } };
  const out = await post(body);
  assert.equal(out.statusCode, 200, out.body);
  const patch = calls.find((c) => c.method === "PATCH");
  assert.ok(patch.body instanceof FormData);
  assert.equal(patch.body.get("item[status]"), "yes", "Dana's Pass stays");
  assert.equal(patch.body.get("section_id"), "51");
  assert.ok(patch.body.get("attachments[]") instanceof Blob);
  calls = [];
  const again = await post(body);
  assert.equal(again.json().duplicate, true);
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("note: a Procore comment; when Procore refuses the path it says not saved (the phone keeps it)", async () => {
  assert.deepEqual((await post({ listId: "9001", action: "note", itemId: "601", text: "Missing at the stair" })).json(), { ok: true, saved: true });
  const note = calls.find((c) => /comments$/.test(c.url));
  assert.match(note.url, /\/rest\/v1\.0\/checklist\/lists\/9001\/comments$/);
  assert.deepEqual(JSON.parse(note.body), { project_id: 373716, item_id: 601, comment: { body: "Missing at the stair" } });
  refuse = "note";
  assert.equal((await post({ listId: "9001", action: "note", itemId: "601", text: "x" })).json().saved, false);
});

test("fail: Report an issue's Observation, linked to the item (inspection_item_failed) with the inspection's location and the item in the description; once only", async () => {
  const body = { listId: "9002", action: "fail", itemId: "801", opId: "op-fail-00001", card: card(), files: [{ name: "a.jpg", type: "image/jpeg", data: JPEG }], contractor: null };
  const out = await post(body);
  assert.equal(out.statusCode, 201, out.body);
  const b = out.json();
  assert.equal(b.linked, true);
  assert.equal(b.itemFailed, true);
  assert.equal(made.length, 1);
  const o = made[0];
  assert.equal(o.inspection_item_failed, 1);
  assert.equal(o.observation.checklist_item_id, 801);
  assert.equal(o.observation.location_id, 77, "the inspection's location when none was said");
  assert.equal(o.observation.personal, false);
  assert.deepEqual(o.observation.upload_ids, ["UP1"]);
  assert.match(o.observation.description, /Failed inspection item 1\.1: Temporary panels covered/);
  assert.match(o.observation.description, /Inspection: \[Procore\] Site Safety Inspection #2 · Level 2/);
  assert.match(o.observation.description, /Responsible contractor: VoltLine Electric/);
  assert.match(o.observation.description, /via SiteSnap AI/);
  const again = await post(body);
  assert.equal(again.json().duplicate, true);
  assert.equal(made.length, 1, "a retry never makes a second Observation");
});

test("fail: Procore won't link it -> made unlinked (item number in the description) and the item is marked failed", async () => {
  refuse = "link";
  const out = await post({ listId: "9001", action: "fail", itemId: "601", opId: "op-fail-00002", card: card(), files: [] });
  assert.equal(out.statusCode, 201, out.body);
  const b = out.json();
  assert.equal(b.linked, false);
  assert.equal(b.itemFailed, true);
  assert.equal(made[0].inspection_item_failed, undefined);
  assert.match(made[0].observation.description, /Failed inspection item 1\.1/);
  const answer = calls.find((c) => /items\/601\/item_response$/.test(c.url));
  assert.deepEqual(JSON.parse(answer.body), { item_response: { status: "non_conforming" } });
});

test("close: submitted; a role that can't close gets 'Saved. Your project manager will review it.'", async () => {
  assert.deepEqual((await post({ listId: "9001", action: "close" })).json(), { closed: true });
  assert.match(calls.find((c) => /close$/.test(c.url)).url, /\/rest\/v1\.1\/projects\/373716\/checklist\/lists\/9001\/close$/);
  refuse = "close";
  assert.deepEqual((await post({ listId: "9001", action: "close" })).json(), { closed: false, reason: "role", message: "Saved. Your project manager will review it." });
});

test("POST safety: other projects, cross-site posts and unknown actions are refused", async () => {
  assert.equal((await post({ projectId: "999", listId: "9001", action: "close" })).statusCode, 403);
  const cross = res();
  await inspections({ method: "POST", url: "/api/procore/inspections", body: { companyId: C, projectId: P, listId: "9001", action: "close" }, headers: { ...headers, origin: "https://evil.example", cookie: `${SESSION_COOKIE}=${cookie()}` } }, cross);
  assert.equal(cross.statusCode, 403);
  assert.equal((await post({ listId: "9001", action: "delete" })).statusCode, 400);
  assert.equal((await post({ listId: "9001", action: "fail", itemId: "601", opId: "bad" })).statusCode, 400);
});

test("item kinds and answers: template options, open-ended text/number/date, old yes/no status", () => {
  const choice = { type: { category: "multiple_choice" }, response_set: { name: "Custom", responses: [{ id: 1, name: "Good", corresponding_status: "yes" }, { id: 2, name: "At risk", corresponding_status: "no" }, { id: 3, name: "Observed", corresponding_status: "none" }] } };
  assert.equal(itemKind(choice), "choice");
  const d = inspectionDetail({ id: 1, sections: [{ id: 1, items: [{ id: 1, name: "q", ...choice }] }] }).sections[0].items[0];
  assert.deepEqual(d.options.map((o) => `${o.label}=${o.counts}`), ["Good=pass", "At risk=fail", "Observed=neutral"]);
  assert.deepEqual(responseBody(d, { optionId: 2 }), { item_response: { response_option_id: 2 } });
  const dflt = { type: { category: "default" }, response_set: { global: true, responses: [{ id: 1, name: "Conforming", corresponding_status: "yes" }, { id: 2, name: "Deficient", corresponding_status: "no" }, { id: 3, name: "N/A", corresponding_status: "n/a" }] } };
  assert.equal(itemKind(dflt), "passfail", "the default set shows SiteSnap's Pass / Fail / N/A");
  assert.equal(itemKind({ type: { category: "open_ended_number" } }), "number");
  assert.equal(itemKind({ type: { category: "open_ended_date" } }), "date");
  assert.equal(itemKind({ type: { category: "open_ended_text" } }), "text");
  assert.deepEqual(responseBody({ kind: "number" }, { value: "7.5" }), { item_response: { number_value: 7.5 } });
  assert.throws(() => responseBody({ kind: "date" }, { value: "tomorrow" }), /Pick a date/);
  assert.equal(answerOf({ status: "no" }).counts, "fail");
  assert.equal(answerOf({ status: "none" }), null);
});

test("summary: the number goes after the name unless the name already has it", () => {
  assert.equal(inspectionSummary({ id: 1, name: "Safety walk", number: 3 }).title, "Safety walk #3");
  assert.equal(inspectionSummary({ id: 1, name: "Safety walk #3", number: 3 }).title, "Safety walk #3");
  const g = groupInspections([inspectionSummary({ id: 1, name: "a", number: 1, inspectors: [{ id: 5, name: "x" }] })], { myId: 5, myCompanyId: null });
  assert.equal(g.mine.length, 1);
});

test("voice: pass / fail / not applicable / section not applicable; anything else is a note", () => {
  assert.deepEqual(voiceCommand("Pass."), { counts: "pass" });
  assert.deepEqual(voiceCommand("fail"), { counts: "fail" });
  assert.deepEqual(voiceCommand("Not applicable"), { counts: "na" });
  assert.deepEqual(voiceCommand("N/A"), { counts: "na" });
  assert.deepEqual(voiceCommand("section not applicable"), { section: "na" });
  assert.equal(voiceCommand("guardrail missing on the north side, pass it to the framer"), null);
});

test("check page: reads the list and the picked inspection; writes only when asked", async () => {
  process.env.PROCORE_API_URL = "https://sandbox.procore.test";
  const read = await post({ match: "#2" }, check);
  assert.equal(read.statusCode, 200, read.body);
  const b = read.json();
  assert.ok(b.steps.find((s) => s.name === "Read the project's inspections").ok);
  assert.ok(b.steps.some((s) => /^Open \[Procore\] Site Safety Inspection #2/.test(s.name)));
  assert.ok(!calls.some((c) => c.method !== "GET" && /procore\.test/.test(c.url)), "read only");
  calls = [];
  const write = await post({ match: "#2", write: true }, check);
  assert.equal(write.statusCode, 200, write.body);
  assert.ok(calls.some((c) => /item_response$/.test(c.url)));
  assert.equal(calls.filter((c) => /toggle_not_applicable/.test(c.url)).length, 2, "on and back");
});

test("section N/A when Procore's read doesn't say (the sandbox): SiteSnap remembers what it set, so a retry never flips it back", async () => {
  hideNa = true;
  const on = await post({ listId: "9001", action: "section_na", sectionId: "50", na: true });
  assert.equal(on.json().changed, true);
  const again = await post({ listId: "9001", action: "section_na", sectionId: "50", na: true });
  assert.equal(again.json().changed, false);
  assert.equal(calls.filter((c) => /toggle_not_applicable/.test(c.url)).length, 1);
  const secs = (await get("&id=9001")).json().inspection.sections;
  assert.equal(secs.find((s) => s.id === "50").na, true, "shown as N/A from SiteSnap's record");
  assert.equal(secs.find((s) => s.id === "51").na, false);
  const off = await post({ listId: "9001", action: "section_na", sectionId: "50", na: false });
  assert.equal(off.json().changed, true);
  assert.equal(calls.filter((c) => /toggle_not_applicable/.test(c.url)).length, 2);
});

test("section N/A set in Procore's web app (every item N/A, nothing remembered) shows as N/A; turned off there, it shows on again", async () => {
  hideNa = true;
  for (const i of lists[9001].sections.find((x) => x.id === 50).items) Object.assign(i, { status: "n/a", item_response: { status: "not_applicable", payload: null } });
  let secs = (await get("&id=9001")).json().inspection.sections;
  assert.equal(secs.find((x) => x.id === "50").na, true);
  await post({ listId: "9001", action: "section_na", sectionId: "51", na: true });
  for (const i of lists[9001].sections.find((x) => x.id === 51).items) Object.assign(i, { status: "none", item_response: null }); // turned off in Procore
  secs = (await get("&id=9001")).json().inspection.sections;
  assert.equal(secs.find((x) => x.id === "51").na, false, "SiteSnap's record gives way to what Procore's items say");
});
