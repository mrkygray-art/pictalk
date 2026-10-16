// Project photos: /api/procore/photos and /api/procore/photo-file against a mocked Procore, and the
// By day / By area / By trade grouping (src/messaging/photosStore.js). No emulators needed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import photos, { PER_PAGE } from "../api/procore/photos.js";
import photoFile, { allowedLink } from "../api/procore/photo-file.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { dayOf, groupPhotos, hasArea, hasTrade } from "../src/messaging/photosStore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const FAS = "https://sandbox.procore.com/fas/api/v5/files/x/thumb?companyId=1&sig=abc";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
let calls, saved, refuse;
const img = (id, extra = {}) => ({
  id, image_category_id: 7, image_category_name: "Field photos 2026-10-16", image_category_private: false, description: `photo ${id}`,
  uploader: { id: 1, name: "Chloe Abara", login: "chloe@example.com" }, created_at: "2026-10-16T16:54:57Z", taken_at: null,
  location: null, trades: [], url: FAS.replace("thumb", "full"), thumbnail_url: FAS, ...extra,
});
const reply = (u, init) => {
  if (/\/fas\//.test(u)) return init.headers?.Authorization === "Bearer access-1" ? [200, JPEG, { "content-type": "" }] : [401, { errors: "no" }];
  if (refuse) return [refuse, { errors: "You do not have sufficient access to complete that action." }];
  if (/image_categories/.test(u)) return [200, [{ id: 7, name: "Field photos 2026-10-16", count: 2, private: false, updated_at: "2026-10-16T17:00:00Z", cover_photo: FAS }]];
  if (/\/projects\/373212\?/.test(u)) return [200, { id: 373212, time_zone: "US/Pacific" }];
  if (/\/images\?/.test(u)) {
    const page = Number(new URL(u).searchParams.get("page"));
    return page === 1
      ? [200, [img(2), img(1, { location: { id: 9, node_name: "Level 2 East" }, trades: [{ id: 5, name: "Electrical" }] })], { total: "3", "per-page": String(PER_PAGE), link: '<https://x/images?page=2&per_page=48>; rel="next"' }]
      : [200, [img(0)], { total: "3" }];
  }
  return [404, { errors: "Not found" }];
};
beforeEach(() => {
  calls = [];
  refuse = 0;
  saved = { fetch: globalThis.fetch, env: { ...process.env } };
  Object.assign(process.env, ENV);
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {} });
    const [status, body, headers = {}] = reply(String(url), init);
    return new Response(Buffer.isBuffer(body) ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.env = saved.env;
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const get = async (handler, query) => {
  const out = res();
  await handler({ method: "GET", url: `/api/procore/x?${new URLSearchParams(query)}`, headers: { host: "sitesnap-procore.vercel.app", cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  return out;
};
const P = { companyId: "4291776", projectId: "373212" };

test("albums: name, count, private, updated, and a cover through SiteSnap (never Procore's link)", async () => {
  const out = await get(photos, { ...P, view: "albums" });
  assert.equal(out.statusCode, 200, out.body);
  const [a] = out.json().albums;
  assert.deepEqual({ id: a.id, name: a.name, count: a.count, private: a.private }, { id: 7, name: "Field photos 2026-10-16", count: 2, private: false });
  assert.match(a.cover, /^\/api\/procore\/photo-file\?/);
  assert.equal(new URLSearchParams(a.cover.split("?")[1]).get("u"), FAS);
});

test("photos: newest first, paged by Procore's Link header, project time zone on page 1, no uploader email", async () => {
  const out = await get(photos, { ...P, view: "photos" });
  assert.equal(out.statusCode, 200, out.body);
  const b = out.json();
  assert.equal(b.nextPage, 2);
  assert.equal(b.timeZone, "US/Pacific");
  assert.equal(b.photos[0].by, "Chloe Abara");
  assert.deepEqual(b.photos[1].location, { id: 9, name: "Level 2 East" });
  assert.deepEqual(b.photos[1].trades, [{ id: 5, name: "Electrical" }]);
  assert.ok(!/example\.com|access-1/.test(out.body));
  const q = new URL(calls.find((c) => /\/images\?/.test(c.url)).url).searchParams;
  assert.equal(q.get("sort"), "-created_at");
  const two = (await get(photos, { ...P, view: "photos", page: "2", albumId: "7" })).json();
  assert.equal(two.nextPage, null);
  assert.equal(new URL(calls.filter((c) => /\/images\?/.test(c.url)).at(-1).url).searchParams.get("image_category_id"), "7");
});

test("photos: Procore's refusal comes back in plain words", async () => {
  refuse = 403;
  const out = await get(photos, { ...P, view: "albums" });
  assert.equal(out.statusCode, 403);
  assert.match(out.json().message, /don't have access to this project's photos/);
});

test("photo-file: fetches Procore's file with the person's token, sends a photo type and a private week-long cache", async () => {
  const out = await get(photoFile, { ...P, u: FAS });
  assert.equal(out.statusCode, 200, String(out.body));
  assert.equal(out.headers["content-type"], "image/jpeg");
  assert.match(out.headers["cache-control"], /private, max-age=604800/);
  assert.deepEqual(Buffer.from(out.body), JPEG);
});

test("photo-file: only https links on procore.com; the token never goes anywhere else", async () => {
  assert.ok(allowedLink("https://sandbox.procore.com/fas/x"));
  assert.ok(allowedLink("https://app.procore.com/x"));
  for (const bad of ["http://sandbox.procore.com/fas/x", "https://evilprocore.com/x", "https://procore.com.evil.test/x", "https://example.com/x", "javascript:alert(1)"]) {
    assert.equal(allowedLink(bad), null, bad);
    const out = await get(photoFile, { ...P, u: bad });
    assert.equal(out.statusCode, 400, bad);
  }
  assert.ok(!calls.some((c) => !/procore\.(com|test)/.test(new URL(c.url).hostname)));
});

test("grouping: by the project's own day, by area, by trade; area and trade chips only when a photo has one", () => {
  const list = [
    { id: 3, createdAt: "2026-10-16T16:00:00Z", location: { id: 9, name: "Level 2 East" }, trades: [{ id: 5, name: "Electrical" }] },
    { id: 2, createdAt: "2026-10-16T04:59:00Z", location: null, trades: [] }, // 9:59 pm Oct 15 in Pacific
    { id: 1, createdAt: "2026-10-15T20:00:00Z", location: { id: 9, name: "Level 2 East" }, trades: [] },
  ];
  assert.equal(dayOf("2026-10-16T04:59:00Z", "US/Pacific"), "2026-10-15");
  assert.deepEqual(groupPhotos(list, "day", "US/Pacific").map((g) => [g.key, g.photos.map((p) => p.id)]), [["2026-10-16", [3]], ["2026-10-15", [2, 1]]]);
  assert.deepEqual(groupPhotos(list, "area").map((g) => [g.label, g.photos.length]), [["Level 2 East", 2], ["No area set", 1]]);
  assert.deepEqual(groupPhotos(list, "trade").map((g) => g.label), ["Electrical", "No trade set"]);
  assert.equal(hasArea(list), true);
  assert.equal(hasTrade([list[1]]), false);
});
