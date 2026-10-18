// The sandbox demo seed (api/procore/demo-seed.js, api/_demoSeedRun.js, api/_demoSeedData.js) against a stateful
// fake Procore and an in-memory SiteSnap store. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import demoSeed, { forgetSeedGuards } from "../api/procore/demo-seed.js";
import { pace } from "../api/_seedSteps.js";
import { setSeedStore, setSeedWait } from "../api/_demoSeedRun.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import {
  COMPANIES, DAILY_LOGS, INSPECTIONS, KY, MESSAGES, OBSERVATIONS, PEOPLE, PHOTOS, PROJECTS, PUNCH_ITEMS, RECORDS,
  emailFor, fullName, isSeedEmail, personByKey, recipientsOf, tasks, workDays,
} from "../api/_demoSeedData.js";
import { SEED, EXTRA_FOREMEN, cleanupPlan } from "../api/_seedDirectory.js";
import { DEMO_PEOPLE, DEMO_COMPANIES } from "../api/_demoScenarios.js";
import { SEED_PHOTOS } from "../api/_demoSeedPhotos.js";

pace.gapMs = 0;
pace.spikeWaitMs = 0;
setSeedWait(async () => {});

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  DEMO_MODE: "true", DEMO_ADMIN_EMAILS: "owner@example.com",
};
const CO = 4291776;
const ME = 77;
let calls, saved, db, P, admin, refuse, tools;

// ---------- in-memory SiteSnap store (same interface as store() in api/_demoSeedRun.js) ----------
function memoryStore() {
  const rows = new Map(); const threads = new Map(); const msgs = new Map(); const links = new Map(); let meta = {};
  return {
    rowsMap: rows, threads, msgs, links,
    async rows() { return Object.fromEntries([...rows].map(([k, v]) => [k, structuredClone(v)])); },
    async row(id) { return rows.get(id) ?? null; },
    async saveRow(id, row) { rows.set(id, structuredClone(row)); },
    async meta() { return structuredClone(meta); },
    async saveMeta(p) { meta = { ...meta, ...p }; },
    async putThread(key, cid, d) { threads.set(`${key}/${cid}`, d); },
    async putMessage(key, cid, mid, d) { msgs.set(`${key}/${cid}/${mid}`, d); },
    async messageExists(key, cid, mid) { return msgs.has(`${key}/${cid}/${mid}`); },
    async putPhotoLink(key, id, d) { links.set(`${key}/${id}`, d); },
    async deletePhotoLink(key, id) { links.delete(`${key}/${id}`); },
    async deleteThread(key, cid) { threads.delete(`${key}/${cid}`); for (const k of [...msgs.keys()]) if (k.startsWith(`${key}/${cid}/`)) msgs.delete(k); },
  };
}

// ---------- a stateful fake Procore ----------
function fakeProcore() {
  let id = 1000;
  const next = () => ++id;
  const s = {
    projects: [{ id: 2000, name: "Real project" }], vendors: [], projectVendors: {}, users: [], projectUsers: {}, trades: [], albums: {}, images: {},
    observations: {}, punch: {}, logs: {}, companyTemplates: {}, projectTemplates: {}, lists: {}, answers: [], comments: [], responseLogs: [], invites: [],
  };
  const json = (body, status = 200) => ({ status, body });
  const route = (method, u, body) => {
    const url = new URL(u);
    const p = url.pathname;
    const q = url.searchParams;
    let m;
    if (refuse && refuse(method, p, body)) return refuse(method, p, body);
    if (u.startsWith("https://s3.procore.test")) return json({}, 204);
    if (method === "GET" && p === "/rest/v1.0/companies") return json([{ id: CO, name: "Sandbox" }]);
    if (method === "GET" && p === "/rest/v1.1/projects") return json(s.projects.map((x) => ({ id: x.id, name: x.name })));
    if (method === "GET" && p === "/rest/v1.0/projects") return json(s.projects);
    if (method === "POST" && p === "/rest/v1.0/projects") { const x = { id: next(), name: body.project.name }; s.projects.push(x); return json(x, 201); }
    if (method === "GET" && (m = p.match(/^\/rest\/v1\.0\/projects\/(\d+)$/))) { const x = s.projects.find((y) => String(y.id) === m[1]); return x ? json(x) : json({}, 404); }
    if (method === "GET" && /\/projects\/\d+\/permission_templates$/.test(p)) return json([{ id: 1, name: "Project Manager - Internal" }, { id: 2, name: "Foreman / Superintendent - Internal" }, { id: 3, name: "Subcontractor - External" }, { id: 4, name: "Owner - External" }]);
    if (method === "GET" && /\/companies\/\d+\/permission_templates\/\d+$/.test(p)) return admin ? json({ id: 1 }) : json({ error: "forbidden" }, 403);
    if (method === "GET" && p === "/rest/v1.0/me") return json({ id: ME, name: "Edward Gray" });
    if (method === "GET" && p === "/rest/v1.0/settings/permissions") return json({ tools: tools.map((name) => ({ name })) });
    // vendors
    if (method === "GET" && p === "/rest/v1.0/vendors") { const term = (q.get("filters[search]") ?? "").toLowerCase(); return json(s.vendors.filter((v) => !term || v.name.toLowerCase().includes(term))); }
    if (method === "GET" && (m = p.match(/^\/rest\/v1\.0\/vendors\/(\d+)$/))) return json(s.vendors.find((v) => String(v.id) === m[1]) ?? {}, s.vendors.some((v) => String(v.id) === m[1]) ? 200 : 404);
    if (method === "POST" && p === "/rest/v1.0/vendors") { const v = { id: next(), ...body.vendor }; s.vendors.push(v); return json(v, 201); }
    if (method === "PATCH" && (m = p.match(/^\/rest\/v1\.0\/vendors\/(\d+)$/))) return json({ id: Number(m[1]) });
    if (method === "GET" && /\/vendors\/inactive$/.test(p)) return json([]);
    if (method === "GET" && (m = p.match(/^\/rest\/v1\.0\/projects\/(\d+)\/vendors$/))) return json((s.projectVendors[m[1]] ?? []).map((vid) => ({ id: vid })));
    if (method === "POST" && (m = p.match(/^\/rest\/v1\.0\/projects\/(\d+)\/vendors\/(\d+)\/actions\/add$/))) { (s.projectVendors[m[1]] ??= []).push(Number(m[2])); return json({}); }
    // users
    if (method === "GET" && p === `/rest/v1.3/companies/${CO}/users`) { const term = (q.get("filters[search]") ?? "").toLowerCase(); return json(s.users.filter((x) => !term || x.email_address.toLowerCase() === term)); }
    if (method === "POST" && p === `/rest/v1.3/companies/${CO}/users`) { const x = { id: next(), ...body.user, vendor: s.vendors.find((v) => v.id === body.user.vendor_id) }; s.users.push(x); return json(x, 201); }
    if (method === "PATCH" && (m = p.match(/^\/rest\/v1\.3\/companies\/\d+\/users\/(\d+)$/))) return json({ id: Number(m[1]) });
    if (method === "GET" && /\/users\/inactive$/.test(p)) return json([]);
    if (method === "GET" && /\/companies\/\d+\/people$/.test(p)) return json([]);
    if (method === "GET" && (m = p.match(/^\/rest\/v1\.0\/projects\/(\d+)\/users$/))) {
      const want = q.get("filters[id][]");
      return json((s.projectUsers[m[1]] ?? []).map((uid) => s.users.find((x) => x.id === uid)).filter((x) => x && (!want || String(x.id) === want)));
    }
    if (method === "POST" && (m = p.match(/^\/rest\/v1\.0\/projects\/(\d+)\/users\/(\d+)\/actions\/add$/))) { (s.projectUsers[m[1]] ??= []).push(Number(m[2])); return json({}); }
    if (method === "PATCH" && /permission_template_assignments$/.test(p)) return json({});
    if (method === "GET" && p === "/rest/v1.0/project_roles") return json([]);
    if ((m = p.match(/^\/rest\/v1\.0\/companies\/\d+\/users\/(\d+)\/invite$/))) { s.invites.push(Number(m[1])); return json({}); }
    // trades, albums, photos, uploads
    if (method === "GET" && /\/companies\/\d+\/trades$/.test(p)) return json(s.trades);
    if (method === "POST" && /\/companies\/\d+\/trades$/.test(p)) { const t = { id: next(), name: body.trade.name }; s.trades.push(t); return json(t, 201); }
    if (method === "GET" && p === "/rest/v1.0/image_categories") return json(s.albums[q.get("project_id")] ?? []);
    if (method === "POST" && p === "/rest/v1.0/image_categories") { const a = { id: next(), ...body.image_category }; (s.albums[q.get("project_id")] ??= []).push(a); return json(a, 201); }
    if (method === "POST" && p === "/rest/v1.0/images") { const i = { id: next(), ...body }; s.images[i.id] = i; return json(i, 201); }
    if ((m = p.match(/^\/rest\/v1\.0\/images\/(\d+)$/))) { if (method === "DELETE") { delete s.images[m[1]]; return json({}, 204); } return s.images[m[1]] ? json(s.images[m[1]]) : json({}, 404); }
    if (method === "POST" && /\/rest\/v1\.1\/projects\/\d+\/uploads$/.test(p)) return json({ uuid: `up-${next()}`, url: "https://s3.procore.test/up", fields: { key: "k" } });
    // Observations and Punch Items
    if (method === "GET" && /\/observation_types$/.test(p)) return json([{ id: 11, name: "Safety Hazard", category: "safety", active: true }, { id: 12, name: "Deficiency", category: "quality", active: true }]);
    if (method === "POST" && p === "/rest/v1.0/observations/items") { const o = { id: next(), number: Object.keys(s.observations).length + 1, ...body.observation, assignees: (body.observation.assignee_ids ?? []).map((x) => ({ id: x })) }; s.observations[o.id] = o; return json(o, 201); }
    if ((m = p.match(/^\/rest\/v1\.0\/observations\/items\/(\d+)$/))) {
      const o = s.observations[m[1]];
      if (!o) return json({}, 404);
      if (method === "PATCH") { Object.assign(o, body.observation); if (body.observation.assignee_ids) o.assignees = body.observation.assignee_ids.map((x) => ({ id: x })); }
      return json(o);
    }
    if (method === "POST" && (m = p.match(/^\/rest\/v1\.0\/observations\/items\/(\d+)\/response_logs$/))) { s.responseLogs.push({ id: m[1], ...body }); if (body.status === "closed") s.observations[m[1]].status = "closed"; return json({}, 201); }
    if (method === "DELETE" && (m = p.match(/\/observations\/items\/(\d+)$/))) { delete s.observations[m[1]]; return json({}, 204); }
    if (method === "POST" && p === "/rest/v1.1/punch_items") { const x = { id: next(), position: Object.keys(s.punch).length + 1, status: "open", workflow_status: "initiated", ...body.punch_item, assignments: (body.punch_item.login_information_ids ?? []).map((l) => ({ login_information: { id: l } })) }; s.punch[x.id] = x; return json(x, 201); }
    if ((m = p.match(/^\/rest\/v1\.1\/punch_items\/(\d+)$/))) {
      const x = s.punch[m[1]];
      if (!x) return json({}, 404);
      if (method === "DELETE") { delete s.punch[m[1]]; return json({}, 204); }
      if (method === "PATCH") Object.assign(x, body.punch_item);
      return json(x);
    }
    if (method === "POST" && /\/punch_items\/\d+\/comments$/.test(p)) return json({}, 201);
    // Daily Log
    if (/delay_log_types$/.test(p)) return json([{ id: 1, display_name: "Weather", translation_key: "weather" }, { id: 2, display_name: "Inspection", translation_key: "inspection" }]);
    if (method === "POST" && (m = p.match(/^\/rest\/v1\.0\/projects\/(\d+)\/(\w+_logs)$/))) { const e = { id: next(), path: m[2], ...body }; s.logs[e.id] = e; return json(e, 201); }
    if (method === "DELETE" && (m = p.match(/\/\w+_logs\/(\d+)$/))) { delete s.logs[m[1]]; return json({}, 204); }
    // Inspections: the template's section call ignores items_attributes, the first item path is 404, the second works
    const ct = `/rest/v1.0/companies/${CO}/checklist/list_templates`;
    if (method === "GET" && p === ct) return json(Object.values(s.companyTemplates));
    if (method === "POST" && p === ct) { const t = { id: next(), name: body.list_template.name, sections: [] }; s.companyTemplates[t.id] = t; return json(t, 201); }
    if (method === "GET" && (m = p.match(/^\/rest\/v1\.0\/companies\/\d+\/checklist\/list_templates\/(\d+)$/))) return json(s.companyTemplates[m[1]]);
    if (method === "POST" && (m = p.match(/^\/rest\/v1\.0\/companies\/\d+\/checklist\/list_templates\/(\d+)\/sections$/))) { const sec = { id: next(), name: body.section.name, items: [] }; s.companyTemplates[m[1]].sections.push(sec); return json(sec, 201); }
    if (method === "POST" && /list_templates\/\d+\/sections\/\d+\/items$/.test(p)) return json({ error: "not found" }, 404);
    if (method === "POST" && (m = p.match(/^\/rest\/v1\.0\/companies\/\d+\/checklist\/list_templates\/(\d+)\/items$/))) { const t = s.companyTemplates[m[1]]; t.sections[0].items.push({ id: next(), name: body.item.name, position: body.item.position }); return json({}, 201); }
    if (method === "GET" && /\/projects\/\d+\/checklist\/list_templates$/.test(p)) return json([]);
    if (method === "POST" && /create_from_company_template$/.test(p)) { const src = s.companyTemplates[body.source_template_id]; const t = { ...structuredClone(src), id: next() }; s.projectTemplates[t.id] = t; return json(t, 201); }
    if (method === "POST" && p === "/rest/v1.0/checklist/lists") {
      const tpl = s.projectTemplates[body.template_id] ?? s.companyTemplates[body.template_id];
      const l = { id: next(), name: body.list.name, inspectors: body.list.inspector_ids ?? [], sections: structuredClone(tpl.sections).map((sec) => ({ ...sec, items: sec.items.map((it) => ({ ...it, id: next() })) })) };
      s.lists[l.id] = l;
      return json(l, 201);
    }
    if ((m = p.match(/^\/rest\/v1\.0\/checklist\/lists\/(\d+)$/))) { if (method === "DELETE") { delete s.lists[m[1]]; return json({}, 204); } return s.lists[m[1]] ? json(s.lists[m[1]]) : json({}, 404); }
    if (method === "POST" && (m = p.match(/\/checklist\/items\/(\d+)\/item_response$/))) { s.answers.push({ item: Number(m[1]), ...body.item_response }); return json({}, 201); }
    if (method === "POST" && /\/checklist\/lists\/\d+\/comments$/.test(p)) { s.comments.push(body); return json({}, 201); }
    return null;
  };
  return { s, route };
}

beforeEach(() => {
  calls = []; admin = true; refuse = null; tools = ["observations", "punch_list", "checklists", "daily_log", "images", "directory"];
  db = memoryStore();
  setSeedStore(db);
  forgetSeedGuards();
  P = fakeProcore();
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log, error: console.error };
  Object.assign(process.env, ENV);
  delete process.env.DEMO_SEED_EMAIL;
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    const r = P.route(method, u, body);
    if (!r) throw new Error(`unexpected fetch ${method} ${u}`);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  Object.assign(console, { log: saved.log, error: saved.error });
  setSeedStore(null);
});

const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
const req = (method, body) => ({
  method, url: "/api/procore/demo-seed", body,
  headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` },
});
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const post = async (body) => { const out = res(); await demoSeed(req("POST", body), out); return out; };
const run = async (id) => (await post({ action: "run", id })).json();
async function seedAll() {
  const skip = [];
  for (let i = 0; i < 400; i++) {
    const b = (await post({ action: "next", skip })).json();
    if (b.finished) return;
    if (b.status !== "done") skip.push(b.id);
  }
  throw new Error("didn't finish");
}
const pid = (code) => String(P.s.projects.find((x) => x.name === PROJECTS[code].name).id);

// ---------- data ----------

test("the cast: 22 people + Ky, no first or last name shared with anyone already in the sandbox or each other", () => {
  assert.equal(PEOPLE.length, 22);
  const existing = [...SEED.flatMap((c) => c.users), ...EXTRA_FOREMEN.map((f) => f.user), ...DEMO_PEOPLE];
  const firsts = new Set(existing.map((p) => p.first_name.toLowerCase()));
  const lasts = new Set(existing.map((p) => p.last_name.toLowerCase()));
  for (const p of PEOPLE) {
    assert.ok(!firsts.has(p.first_name.toLowerCase()), `${fullName(p)}: first name already used`);
    assert.ok(!lasts.has(p.last_name.toLowerCase()), `${fullName(p)}: last name already used`);
  }
  assert.equal(new Set(PEOPLE.map((p) => p.first_name)).size, PEOPLE.length);
  assert.equal(new Set(PEOPLE.map((p) => p.last_name)).size, PEOPLE.length);
  const companyWords = new Set([...SEED.map((c) => c.vendor.name), ...Object.values(DEMO_COMPANIES).map((v) => v.name)].map((n) => n.split(" ")[0].toLowerCase()));
  for (const v of Object.values(COMPANIES)) {
    assert.ok(!companyWords.has(v.name.split(" ")[0].toLowerCase()), `${v.name} starts like an existing company`);
    assert.ok(v.abbreviated_name.length <= 10, v.abbreviated_name);
  }
  const phones = [...existing.map((p) => p.mobile_phone), ...Object.values(DEMO_COMPANIES).map((v) => v.business_phone), ...SEED.map((c) => c.vendor.business_phone)];
  for (const ph of [...PEOPLE.map((p) => p.mobile_phone), ...Object.values(COMPANIES).map((v) => v.business_phone)]) assert.ok(!phones.includes(ph), `${ph} already used`);
});

test("every assignee, reviewer, inspector and message person is on that project; titles tagged; counts as the spec", () => {
  const on = (k, code) => k === KY || personByKey(k).projects.includes(code);
  assert.equal(OBSERVATIONS.length, 12);
  assert.equal(PUNCH_ITEMS.length, 14);
  for (const r of OBSERVATIONS) { for (const k of [...r.assignees, r.by]) assert.ok(on(k, r.project), `${r.id}: ${k}`); assert.match(r.title, /^\[DEMO\] /); }
  for (const r of PUNCH_ITEMS) { for (const k of [r.assignee, r.reviewer]) assert.ok(on(k, r.project), `${r.id}: ${k}`); assert.match(r.title, /^\[DEMO\] /); }
  for (const i of INSPECTIONS) assert.ok(on(i.inspector, i.project), i.id);
  for (const m of MESSAGES) for (const k of [m.from, ...recipientsOf(m), ...m.msgs.map((x) => x[0])]) assert.ok(on(k, m.project), `${m.id}: ${k}`);
  assert.equal(Object.values(DAILY_LOGS).reduce((n, d) => n + d.days.length, 0), 21);
  for (const [code, d] of Object.entries(DAILY_LOGS)) for (const day of d.days) for (const [co] of day.manpower) assert.ok(PEOPLE.some((p) => p.company === co && p.projects.includes(code)), `${code} manpower ${co}`);
  // M8: the whole project team but not the owner's people
  const m8 = recipientsOf(MESSAGES.find((m) => m.id === "m8"));
  assert.ok(!m8.some((k) => k !== KY && personByKey(k).company === "tidewater"));
  for (const k of Object.keys(PHOTOS)) assert.ok(SEED_PHOTOS[k]?.length > 1000, `photo ${k} built`);
});

test("emails are plus-addresses of the configured inbox, never written in the repo; the test-people cleanup keeps them", () => {
  assert.equal(emailFor(personByKey("osei")), "owner+demo-osei@example.com");
  process.env.DEMO_SEED_EMAIL = "Base@Mail.example.com";
  assert.equal(emailFor(personByKey("osei")), "base+demo-osei@mail.example.com");
  assert.ok(isSeedEmail("anyone+demo-alvarez@x.test") && !isSeedEmail("anyone+alvarez@x.test"));
  const src = fs.readFileSync(new URL("../api/_demoSeedData.js", import.meta.url), "utf8");
  assert.ok(!/@gmail\.com/i.test(src), "no personal address in the data file");
  const plan = cleanupPlan({ users: [{ id: 1, name: "Vincent Ashford", email_address: "x+demo-ashford@y.test", is_active: true }], vendors: [{ id: 2, name: "Harborline Construction", is_active: true }] });
  assert.ok(JSON.stringify(plan).includes("Demo seed page"));
});

test("work days skip weekends and end today (or the Friday before)", () => {
  assert.deepEqual(workDays("2026-10-18"), ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  assert.equal(workDays("2026-10-14").at(-1), "2026-10-14");
});

// ---------- the page ----------

test("GET: 404 unless DEMO_MODE=true and the sandbox; the page carries noindex", async () => {
  process.env.DEMO_MODE = "false";
  let out = res(); await demoSeed(req("GET"), out);
  assert.equal(out.statusCode, 404);
  process.env.DEMO_MODE = "true";
  out = res(); await demoSeed(req("GET"), out);
  assert.equal(out.statusCode, 200);
  assert.equal(out.headers["x-robots-tag"], "noindex, nofollow");
  process.env.PROCORE_API_URL = "https://api.procore.test";
  out = res(); await demoSeed(req("GET"), out);
  assert.equal(out.statusCode, 404);
});

test("a non-admin gets 403 and nothing is written", async () => {
  admin = false;
  const out = await post({ action: "state" });
  assert.equal(out.statusCode, 403);
  assert.ok(!calls.some((c) => c.method !== "GET"));
});

test("state: every task not started, the plan's counts and renames", async () => {
  const b = (await post({ action: "state" })).json();
  assert.equal(b.summary.total, tasks().length);
  assert.equal(b.summary.not_started, tasks().length);
  assert.ok(b.emailReady);
  assert.ok(b.renamed.some(([a, c]) => a === "Luis Herrera" && c === "Ruben Salazar"));
  assert.ok(b.renamed.some(([a]) => a === "Harbor Point Warehouse Conversion"));
});

test("Seed Everything: everything done, against only the three [DEMO] projects", async () => {
  await seedAll();
  const b = (await post({ action: "state" })).json();
  assert.equal(b.summary.done, b.summary.total, b.copyText);
  const s = P.s;
  assert.equal(s.projects.filter((x) => x.name.startsWith("[DEMO]")).length, 3);
  assert.equal(Object.keys(s.observations).length, 12);
  assert.equal(Object.keys(s.punch).length, 14);
  assert.equal(s.users.length, 22);
  assert.equal(Object.keys(s.images).length, 12);
  // Daily logs: every work day, manpower by company (contact_id = the vendor), weather in the note, tagged
  const notes = Object.values(s.logs).filter((e) => e.path === "notes_logs");
  assert.equal(notes.length, 21);
  assert.ok(notes.every((n) => /Weather: .*\[DEMO\]$/.test(n.notes_log.comment)));
  const harborline = s.vendors.find((v) => v.name === "Harborline Construction").id;
  assert.ok(Object.values(s.logs).some((e) => e.path === "manpower_logs" && e.manpower_log.contact_id === harborline && e.manpower_log.num_workers === 4));
  assert.ok(Object.values(s.logs).some((e) => e.path === "delay_logs" && e.delay_log.delay_type === "weather"));
  // Nothing written to the project that isn't a demo one
  assert.ok(!calls.some((c) => c.method !== "GET" && /\b2000\b/.test(c.url)));
  // Messages: 8 threads, M8 tags the team but not the owner, linked threads point at the real record
  assert.equal([...db.threads.keys()].length, 8);
  const t1 = [...db.threads].find(([k]) => k.endsWith("/seed-m1"))[1];
  const obs1 = Object.values(s.observations).find((o) => o.name.includes("lap splice"));
  assert.equal(t1.procore.id, obs1.id);
  assert.equal(t1.tagged.length, 2);
  assert.ok(t1.tagged.some((x) => x.procoreUserId === String(ME)), "Ky is tagged");
  // Photo linked for SiteSnap's badge
  assert.ok([...db.links.values()].some((l) => l.id === obs1.id));
});

test("records: OBS-04 has two assignees and three comments; statuses as planned; punch reviewer and location sent", async () => {
  await seedAll();
  const o4 = Object.values(P.s.observations).find((o) => o.name.includes("Conduit conflicts"));
  assert.equal(o4.assignees.length, 2);
  assert.ok(o4.assignees.some((a) => a.id === ME));
  assert.equal(P.s.responseLogs.filter((r) => String(r.id) === String(o4.id)).length, 3);
  assert.equal(o4.priority, "High");
  const o2 = Object.values(P.s.observations).find((o) => o.name.includes("guardrail"));
  assert.equal(o2.priority, "Urgent");
  for (const r of OBSERVATIONS) assert.equal(Object.values(P.s.observations).find((o) => o.name === r.title).status, r.status, r.id);
  for (const r of PUNCH_ITEMS) {
    const x = Object.values(P.s.punch).find((y) => y.name === r.title);
    const now = x.status === "closed" ? "closed" : x.workflow_status;
    assert.equal(now, r.status === "open" ? "initiated" : r.status, r.id);
    assert.deepEqual(x.mt_location, [r.location]);
    assert.ok(x.punch_item_manager_id && x.final_approver_id);
  }
  const pi12 = Object.values(P.s.punch).find((y) => y.name.includes("Final clean"));
  assert.equal(pi12.final_approver_id, ME);
  const trade = P.s.trades.find((t) => t.name === "Painting");
  assert.equal(Object.values(P.s.punch).find((y) => y.name.includes("Paint holiday")).trade_id, trade.id);
});

test("Procore refusing the full punch item: retried with less, still made", async () => {
  refuse = (method, p, body) => (method === "POST" && p === "/rest/v1.1/punch_items" && body.punch_item.mt_location ? { status: 422, body: { errors: { mt_location: ["is invalid"] } } } : null);
  await seedAll();
  assert.equal(Object.keys(P.s.punch).length, 14);
  const b = (await post({ action: "state" })).json();
  assert.ok(b.tasks.find((t) => t.id === "record:PI-01").notes.some((n) => /less/.test(n)));
});

test("inspections: template questions added through the item path that works; answers and the fail note seeded", async () => {
  await seedAll();
  const a = Object.values(P.s.companyTemplates).find((t) => t.name.includes("Pre-Pour"));
  assert.equal(a.sections[0].items.length, 7);
  const lists = Object.values(P.s.lists);
  assert.equal(lists.length, 3);
  const insA = lists.find((l) => l.name.includes("Pre-pour"));
  assert.equal(insA.inspectors.length, 1);
  const itemsA = insA.sections[0].items.map((i) => i.id);
  const ans = P.s.answers.filter((x) => itemsA.includes(x.item));
  assert.deepEqual(ans.map((x) => x.status), ["conforming", "conforming", "non_conforming"]);
  assert.ok(P.s.comments.some((c) => /Observation #\d+/.test(c.comment.body) && c.item_id === itemsA[2]));
  const insC = lists.find((l) => l.name.includes("Final walk"));
  assert.ok(!P.s.answers.some((x) => insC.sections[0].items.some((i) => i.id === x.item)), "Final walk left open for the live demo");
});

test("a 429 stops the task; running it again resumes without making a second record", async () => {
  for (const id of ["project:MH", "trades", "company:harborline:MH", "company:beacon:MH", "person:alvarez:MH", "person:carter:MH"]) await run(id);
  let n = 0;
  refuse = (method, p) => (method === "POST" && /response_logs$/.test(p) && n++ === 0 ? { status: 429, body: {} } : null);
  await run("record:OBS-01");
  let b = (await post({ action: "state" })).json();
  assert.equal(b.tasks.find((t) => t.id === "record:OBS-01").status, "done", JSON.stringify(b.tasks.find((t) => t.id === "record:OBS-01"))); // OBS-01 has no comments: no response log
  refuse = (method, p) => (method === "PATCH" && /observations\/items/.test(p) ? { status: 429, body: {} } : null);
  await run("person:reed:MH"); // OBS-03 is assigned to Reed
  await run("record:OBS-03"); // ready_for_review needs a PATCH
  b = (await post({ action: "state" })).json();
  const row = b.tasks.find((t) => t.id === "record:OBS-03");
  assert.equal(row.status, "partial");
  assert.match(row.error, /429/);
  refuse = null;
  await run("record:OBS-03");
  b = (await post({ action: "state" })).json();
  assert.equal(b.tasks.find((t) => t.id === "record:OBS-03").status, "done");
  assert.equal(Object.values(P.s.observations).filter((o) => o.name.includes("unsecured cords")).length, 1);
});

test("restore: records moved during a demo go back to their starting status", async () => {
  await seedAll();
  const o4 = Object.values(P.s.observations).find((o) => o.name.includes("Conduit conflicts"));
  o4.status = "ready_for_review";
  const pi12 = Object.values(P.s.punch).find((y) => y.name.includes("Final clean"));
  pi12.status = "closed";
  const b = (await post({ action: "restore" })).json();
  assert.ok(b.results.every((r) => r.ok), JSON.stringify(b.results.filter((r) => !r.ok)));
  assert.equal(o4.status, "initiated");
  assert.equal(pi12.status, "open");
  assert.equal(pi12.workflow_status, "ready_for_review");
});

test("undo: removes only what the seed map recorded; a record renamed without [DEMO] is left alone", async () => {
  await seedAll();
  const o1 = Object.values(P.s.observations).find((o) => o.name.includes("lap splice"));
  o1.name = "Missing lap splice (kept by Ky)";
  let b = (await post({ action: "undo", id: "record:OBS-01" })).json();
  assert.equal(b.removed, 0);
  assert.equal(b.kept.length, 1);
  assert.ok(P.s.observations[o1.id]);
  b = (await post({ action: "undo", id: "record:OBS-02" })).json();
  assert.equal(b.removed, 1);
  b = (await post({ action: "undo", id: "dailylog:MH:0" })).json();
  assert.equal(b.removed, 4); // 2 manpower, the delivery, the note
  await post({ action: "undo", id: "message:m1" });
  assert.ok(![...db.threads.keys()].some((k) => k.endsWith("/seed-m1")));
  await post({ action: "undo", id: "inspection:INSP-A" });
  assert.equal(Object.values(P.s.lists).length, 2);
  // Setup isn't undone
  const out = await post({ action: "undo", id: "project:MH" });
  assert.equal(out.statusCode, 400);
  // Redo makes it again
  b = (await post({ action: "redo", id: "record:OBS-02" })).json();
  assert.equal(b.status, "done");
  assert.ok(Object.values(P.s.observations).some((o) => o.name.includes("guardrail")));
  assert.ok(pid("MH"));
});

test("invites: one email per person, through Procore's invite call", async () => {
  await seedAll();
  const b = (await post({ action: "invite", key: "alvarez" })).json();
  assert.ok(b.ok, b.detail);
  assert.equal(P.s.invites.length, 1);
  const st = (await post({ action: "state" })).json();
  assert.ok(st.people.find((p) => p.key === "alvarez").invite.ok);
});

test("no email configured: people tasks fail with a plain message, nothing else breaks", async () => {
  delete process.env.DEMO_ADMIN_EMAILS;
  await run("project:MH");
  await run("company:harborline:MH");
  const b = (await run("person:salazar:MH"));
  assert.equal(b.status, "failed");
  assert.match(b.error, /DEMO_SEED_EMAIL/);
  assert.equal(P.s.users.length, 0);
  assert.equal(RECORDS.length, 26);
});

test("tools off in a new project: Seed Everything stops after the projects and says which; on again, it carries on", async () => {
  tools = ["observations", "punch_list"];
  const b1 = (await post({ action: "next", skip: [] })).json();
  assert.equal(b1.id, "project:MH");
  assert.equal(b1.status, "partial");
  assert.equal((await post({ action: "next", skip: ["project:MH"] })).json().id, "project:CV");
  assert.equal((await post({ action: "next", skip: ["project:MH", "project:CV"] })).json().id, "project:DS");
  const blocked = (await post({ action: "next", skip: ["project:MH", "project:CV", "project:DS"] })).json();
  assert.ok(blocked.blocked);
  assert.deepEqual(blocked.toolsOff[PROJECTS.MH.name], ["Inspections", "Daily Log", "Photos", "Directory"]);
  assert.ok(!calls.some((c) => /(vendors|users)\b/.test(c.url) && c.method !== "GET"), "nothing added while tools are off");
  const st = (await post({ action: "state" })).json();
  assert.match(st.copyText, /TOOLS OFF: Inspections, Daily Log, Photos, Directory/);
  tools = ["observations", "punch_list", "checklists", "daily_log", "images", "directory"];
  const b2 = (await post({ action: "next", skip: [] })).json();
  assert.ok(!b2.blocked);
  assert.equal(b2.id, "trades");
});
