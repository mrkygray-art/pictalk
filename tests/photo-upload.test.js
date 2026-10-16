// Snap's server side (/api/procore/photo-upload) against a mocked Procore and a fake capture log. No emulators.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import upload from "../api/procore/photo-upload.js";
import { seal, SESSION_COOKIE } from "../api/_procore.js";
import { setStore } from "../api/_firestore.js";

const ENV = {
  PROCORE_CLIENT_ID: "id", PROCORE_CLIENT_SECRET: "secret-never-leak", PROCORE_LOGIN_URL: "https://login-sandbox.procore.test",
  PROCORE_API_URL: "https://sandbox.procore.test", SESSION_SECRET: "test-session-secret-32-bytes-long!!",
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
let calls, saved, albums, log, refuse;
const reply = (u, init) => {
  const m = init.method ?? "GET";
  if (/storage\.test/.test(u)) return [204, null];
  if (/image_categories/.test(u) && m === "GET") return [200, albums];
  if (/image_categories/.test(u) && m === "POST") {
    if (refuse === "album") return [403, { errors: "You do not have sufficient access to complete that action." }];
    const a = { id: 900 + albums.length, ...JSON.parse(init.body).image_category, count: 0 };
    albums.push(a);
    return [201, a];
  }
  if (/\/projects\/373212\?/.test(u)) return [200, { id: 373212, time_zone: "US/Pacific" }];
  if (/\/projects\/373212\/uploads/.test(u)) return [201, { uuid: "UP1", url: "https://storage.test/up", fields: { key: "k" } }];
  if (/\/images\?/.test(u) && m === "POST") {
    if (refuse === "photo") return [403, { errors: "You do not have sufficient access to complete that action." }];
    return [201, { id: 2614999, image_category_id: JSON.parse(init.body).image.image_category_id }];
  }
  return [404, { errors: "Not found" }];
};
// A fake Firestore: procoreProjects/{key}/photoCaptures/{id}
const fakeDb = {
  collection: () => ({ doc: (key) => ({ collection: () => ({ doc: (id) => ({
    get: async () => ({ exists: log.has(`${key}/${id}`), data: () => log.get(`${key}/${id}`) }),
    set: async (v) => { log.set(`${key}/${id}`, v); },
  }) }) }) }),
};
beforeEach(() => {
  calls = [];
  log = new Map();
  refuse = null;
  albums = [{ id: 1, name: "Unclassified", private: false }, { id: 2, name: "Owner only", private: true }];
  saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log };
  Object.assign(process.env, ENV);
  console.log = () => {};
  setStore(fakeDb);
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
  setStore(null);
});
const cookie = () => seal({ at: "access-1", rt: "refresh-1", exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.SESSION_SECRET, SESSION_COOKIE);
function res() {
  const headers = {};
  return { statusCode: 200, headers, setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; }, end(b) { this.body = b ?? ""; }, json() { return JSON.parse(this.body); } };
}
const post = async (extra = {}) => {
  const out = res();
  const body = { companyId: "4291776", projectId: "373212", captureId: "cap-12345678", takenAt: "2026-10-16T04:30:00Z", description: "Rebar at grid C\n\nPhoto by Chloe Abara, Oct 15, 9:30 PM", photo: { type: "image/jpeg", data: JPEG }, ...extra };
  await upload({ method: "POST", url: "/api/procore/photo-upload", body, headers: { host: "sitesnap-procore.vercel.app", origin: "https://sitesnap-procore.vercel.app", "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie()}` } }, out);
  return out;
};
const posted = (re) => calls.filter((c) => c.method === "POST" && re.test(c.url)).map((c) => JSON.parse(c.body));

test("no album picked: makes the day's public 'Field photos' album (the project's own day it was taken), then the photo", async () => {
  const out = await post();
  assert.equal(out.statusCode, 200, out.body);
  // 04:30 UTC on Oct 16 is Oct 15 in Pacific
  assert.deepEqual(posted(/image_categories/), [{ image_category: { name: "Field photos 2026-10-15", private: false } }]);
  const [img] = posted(/\/images\?/);
  assert.equal(img.upload_uuid, "UP1");
  assert.equal(img.image.private, false);
  assert.equal(img.image.image_category_id, 902);
  assert.match(img.image.description, /Rebar at grid C/);
  assert.deepEqual(out.json(), { imageId: 2614999, albumId: 902, albumName: "Field photos 2026-10-15", duplicate: false });
  // The next photo that day goes in the same album, not a new one
  await post({ captureId: "cap-87654321" });
  assert.equal(posted(/image_categories/).length, 1);
});

test("a retry with the same capture id never makes a second photo in Procore", async () => {
  await post();
  calls = [];
  const again = await post();
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().duplicate, true);
  assert.equal(again.json().imageId, 2614999);
  assert.equal(calls.length, 0, "no Procore calls at all");
});

test("a picked album is used; a private one is refused in plain words", async () => {
  const out = await post({ albumId: 1 });
  assert.equal(out.json().albumName, "Unclassified");
  assert.equal(posted(/image_categories/).length, 0);
  const priv = await post({ albumId: 2, captureId: "cap-private1" });
  assert.equal(priv.statusCode, 400);
  assert.match(priv.json().message, /private/);
});

test("Procore refusals come back as the spec's plain messages", async () => {
  refuse = "photo";
  const out = await post({ albumId: 1 });
  assert.equal(out.statusCode, 403);
  assert.match(out.json().message, /You don't have permission to add photos to this project/);
  refuse = "album";
  const album = await post({ captureId: "cap-noalbum1" });
  assert.equal(album.statusCode, 403);
  assert.match(album.json().message, /can't make albums/);
  assert.equal(log.size, 0, "nothing remembered when nothing was saved");
});

test("only JPEG / PNG / WebP photos (never TIFF or HEIC), and a sane capture id", async () => {
  for (const type of ["image/tiff", "image/heic", "application/pdf"]) {
    const out = await post({ photo: { type, data: JPEG } });
    assert.equal(out.statusCode, 400, type);
  }
  assert.equal((await post({ captureId: "../x" })).statusCode, 400);
  assert.equal(calls.length, 0);
});
