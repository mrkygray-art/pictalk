// The Photos check page (api/procore/test-photos.js) against a mocked Procore. No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import check, { pace, TEST_ALBUM } from "../api/procore/test-photos.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
let calls, saved, albums, refuseImages, refuseAlbums, stored;
const RL = { "x-rate-limit-limit": "3600", "x-rate-limit-remaining": "3590", "x-rate-limit-reset": "1760000000" };
const reply = (u, init) => {
  const m = init.method ?? "GET";
  if (/storage\.test\/upload/.test(u)) return [204, null];
  if (/\/fas\//.test(u)) return init.headers?.Authorization === "Bearer access-1" ? [200, "jpeg", { "content-type": "image/jpeg" }] : [401, { errors: "unauthorized" }];
  if (/\/me\?/.test(u)) return [200, { id: 481274, name: "Edward Gray" }];
  if (/\/projects\/373235\?/.test(u)) return [200, { id: 373235, time_zone: "America/Los_Angeles" }];
  if (/\/projects\?|\/companies\?/.test(u)) return [200, /companies/.test(u) ? [{ id: 4291776, name: "Kyco", is_active: true }] : [{ id: 373235, name: "Sandbox Test Project" }]];
  if (/image_categories/.test(u) && m === "GET") return [200, albums, RL];
  if (/\/projects\/373235\/users/.test(u)) return [200, [{ id: 481274, name: "Edward Gray", permission_template: { id: 2, name: "Subcontractor - External" } }]];
  if (/image_categories/.test(u) && m === "POST" && refuseAlbums) return [403, { errors: "You do not have sufficient access to complete that action." }];
  if (/image_categories/.test(u) && m === "POST") { const a = { id: 77, name: JSON.parse(init.body).image_category.name, private: false, count: 0 }; albums.push(a); return [201, a]; }
  if (/\/companies\/4291776\/trades/.test(u)) return [200, [{ id: 5, name: "Electrical", active: true }]];
  if (/\/projects\/373235\/locations/.test(u)) return [200, [{ id: 9, name: "Level 2 East" }]];
  if (/\/projects\/373235\/uploads/.test(u)) return [201, { uuid: "UP1", url: "https://storage.test/upload", fields: { key: "k" } }];
  if (/\/images\/555/.test(u) && m === "PATCH") { stored.description = JSON.parse(init.body).image.description.slice(0, 2000); return [200, stored]; }
  if (/\/images\/555/.test(u)) { const show = { ...stored }; delete show.thumbnail_url; return [200, show]; } // Show Image has no thumbnail_url
  if (/\/images\?/.test(u) && m === "POST") {
    if (refuseImages) return [403, { errors: "You do not have permission" }];
    const b = JSON.parse(init.body);
    stored = { id: 555, image_category_id: b.image.image_category_id, image_category_name: TEST_ALBUM, private: false, description: b.image.description,
      trades: [{ id: 5, name: "Electrical" }], location: { id: 9, name: "Level 2 East" }, uploader: { id: 481274, name: "Edward Gray", login: "e@example.com" },
      url: "https://sandbox.procore.test/fas/full?companyId=1&sig=abc", thumbnail_url: "https://sandbox.procore.test/fas/thumb?companyId=1&sig=abc" };
    return [201, stored];
  }
  if (/\/images\?/.test(u)) return [200, [stored], { total: "1", "per-page": "1", ...RL }];
  return [404, { errors: "Not found" }];
};
beforeEach(() => {
  calls = [];
  albums = [{ id: 1, name: "Site Photos", private: false, count: 4 }, { id: 2, name: "Owner only", private: true, count: 1 }];
  refuseImages = false;
  refuseAlbums = false;
  stored = null;
  pace.gapMs = 0;
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log };
  Object.assign(process.env, ENV);
  console.log = () => {};
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    const [status, body, headers = {}] = reply(String(url), init);
    return new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
  console.log = saved.log;
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const run = async () => {
  const out = res();
  await check({ method: "POST", url: "/api/procore/test-photos", body: { companyId: "4291776", projectId: "373235" }, headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  return out;
};
const stepNamed = (b, start) => b.steps.find((s) => s.name.startsWith(start));

test("photos check: makes the test album once, uploads one public photo with description, trade and location, answers all six questions", async () => {
  const out = await run();
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.match(stepNamed(b, "List albums").detail, /2 album\(s\); 1 private/);
  assert.match(stepNamed(b, "Create an album").detail, /Yes: made "SiteSnap test album"/);
  const img = JSON.parse(calls.find((c) => c.method === "POST" && /\/images\?/.test(c.url)).body);
  assert.equal(img.upload_uuid, "UP1");
  assert.equal(img.image.image_category_id, 77);
  assert.equal(img.image.private, false);
  assert.deepEqual(img.image.trade_ids, [5]);
  assert.equal(img.image.location_id, 9);
  assert.match(img.image.log_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(stepNamed(b, "Add a photo").ok);
  assert.ok(stepNamed(b, "Description set when").ok);
  assert.match(stepNamed(b, "Trade and location").detail, /Electrical; location: Level 2 East/);
  assert.match(stepNamed(b, "Description changed later").detail, /read back 2000 characters/);
  assert.match(stepNamed(b, "List photos in an album").detail, /Total header: 1/);
  assert.match(stepNamed(b, "Thumbnail link").detail, /Without a Procore sign-in: 401.*With the person's sign-in: 200 image\/jpeg/);
  assert.match(stepNamed(b, "List photos created today (project day").detail, /is in the list/);
  assert.match(stepNamed(b, "Rate limit").detail, /limit 3600/);
  assert.ok(!/e@example\.com|access-1|secret-never-leak/.test(out.body), out.body);

  // A second run reuses the album
  calls = [];
  const again = (await run()).json();
  assert.match(stepNamed(again, "Create an album").detail, /already exists/);
  assert.ok(!calls.some((c) => c.method === "POST" && /image_categories/.test(c.url)));
});

test("photos check: someone who can't make albums still tries the upload into an existing public album", async () => {
  refuseAlbums = true;
  const b = (await run()).json();
  assert.match(b.who, /template here: Subcontractor - External/);
  assert.equal(stepNamed(b, "Create an album").ok, false);
  assert.match(stepNamed(b, "Fallback").detail, /"Site Photos" \(id 1\)/);
  const img = JSON.parse(calls.find((c) => c.method === "POST" && /\/images\?/.test(c.url)).body);
  assert.equal(img.image.image_category_id, 1, "never the private album");
  assert.ok(stepNamed(b, "Add a photo").ok);
});

test("photos check: a person without Standard on Photos gets the plain-language refusal", async () => {
  refuseImages = true;
  const b = (await run()).json();
  const add = stepNamed(b, "Add a photo");
  assert.equal(add.ok, false);
  assert.match(add.detail, /You don't have permission to add photos to this project/);
});

test("photos check: sandbox only", async () => {
  process.env.PROCORE_API_URL = "https://api.procore.com";
  const out = res();
  await check({ method: "GET", url: "/api/procore/test-photos", headers: {} }, out);
  assert.equal(out.statusCode, 403);
});
