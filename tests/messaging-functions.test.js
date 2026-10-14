// SiteSnap messaging functions (functions/messaging.js) in the emulators, with the free stand-ins
// (PICTALK_FAKE_AI=1, PICTALK_FAKE_STT=1): a new message updates the feed card, gets its voice note
// written down when the app couldn't, and has its tasks flagged; tasks are marked done by the people
// they're for; the composer callables check project membership.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { signInWithCustomToken } from "firebase/auth";
import { phone, rejects, closeAll, run } from "./emulator.js";

const fnRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: adminInit, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) adminInit({ projectId: "demo-pictalk", storageBucket: "demo-pictalk.appspot.com" });
const { getFirestore } = fnRequire("firebase-admin/firestore");
const { getAuth } = fnRequire("firebase-admin/auth");
const { getStorage } = fnRequire("firebase-admin/storage");
const db = () => getFirestore();

const KEY = `77${Date.now() % 100000}_${Math.floor(Math.random() * 1e6)}`; // a fresh project each run
const CID = `c-${run}`;
const P = (id, name, company = null) => ({ procoreUserId: id, name, company, title: null });
const conv = (path) => db().doc(`procoreProjects/${KEY}/conversations/${CID}${path}`);

async function until(fn, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out waiting for the function");
}

// A Procore user signed in to SiteSnap (what api/procore/session hands the app)
async function procoreUser(id) {
  const p = phone();
  const token = await getAuth().createCustomToken(`procore_${id}`, { procoreUserId: id });
  await signInWithCustomToken(p.auth, token);
  return p;
}

before(async () => {
  for (const id of ["201", "202", "203"]) await db().doc(`procoreProjects/${KEY}/members/${id}`).set({ procoreUserId: id, name: `User ${id}`, at: 1 });
  await conv("").set({
    createdBy: P("201", "Sam Sender"), tagged: [P("202", "Tia Tagged", "ABC Drywall")], taggedIds: ["202"],
    status: "open", createdAt: 1, lastActivityAt: 1,
  });
});
after(closeAll);

const message = (mid, extra) => conv(`/messages/${mid}`).set({
  authorId: "201", authorName: "Sam Sender", text: "", transcript: "", transcriptStatus: "none", photos: [],
  voicePath: null, voiceType: null, aiDescription: null, clientCreatedAt: Date.now(), createdAt: Date.now(), ...extra,
});

test("a request becomes a task for the tagged person, and the feed card shows the latest message", async () => {
  await message("m1", { text: "Please send the revised drawings for level 2", photos: [{ path: `messages/${KEY}/${CID}/m1/photo-1.jpg` }] });
  const m = await until(async () => { const d = (await conv("/messages/m1").get()).data(); return d?.tasksStatus && d; });
  assert.equal(m.tasksStatus, "done");
  assert.equal(m.tasks.length, 1);
  assert.deepEqual(m.tasks[0].assigneeIds, ["202"]);
  assert.deepEqual(m.tasks[0].assigneeNames, ["Tia Tagged"]);
  assert.equal(m.tasks[0].status, "open");
  const c = (await conv("").get()).data();
  assert.equal(c.messageCount, 1);
  assert.equal(c.lastMessage.authorId, "201");
  assert.match(c.lastMessage.text, /revised drawings/);
  assert.equal(c.lastMessage.photoCount, 1);
  assert.equal(c.firstPhotoPath, `messages/${KEY}/${CID}/m1/photo-1.jpg`);
  assert.deepEqual(c.taskAssigneeIds, ["202"]);
  assert.equal(c.openTasks.length, 1);
});

test("a plain report has no task", async () => {
  await message("m2", { text: "Here's the electrical panel at grid C4" });
  const m = await until(async () => { const d = (await conv("/messages/m2").get()).data(); return d?.tasksStatus && d; });
  assert.deepEqual(m.tasks, []);
  assert.equal((await conv("").get()).data().messageCount, 2);
});

test("a voice note sent with no signal gets written down by the server", async () => {
  const path = `messages/${KEY}/${CID}/m3/voice.webm`;
  await getStorage().bucket().file(path).save(Buffer.alloc(1234, 1), { contentType: "audio/webm" });
  await message("m3", { voicePath: path, voiceType: "audio/webm", transcriptStatus: "pending" });
  const m = await until(async () => { const d = (await conv("/messages/m3").get()).data(); return d?.transcriptStatus === "done" && d.tasksStatus && d; });
  assert.equal(m.transcript, "Test transcript (1234 bytes of audio).");
  assert.equal((await conv("").get()).data().lastMessage.hasVoice, true);
});

test("the person a task is for marks it done; others on the project can't; outsiders can't at all", async () => {
  const tia = await procoreUser("202");
  const other = await procoreUser("203");
  const outsider = await procoreUser("299");
  const args = (status) => ({ key: KEY, cid: CID, mid: "m1", taskId: "m1-t1", status });
  await rejects(other.call("setMessageTask", args("done")), "permission-denied");
  await rejects(outsider.call("setMessageTask", args("done")), "permission-denied");
  await tia.call("setMessageTask", args("done"));
  assert.equal((await conv("/messages/m1").get()).data().tasks[0].status, "done");
  let c = (await conv("").get()).data();
  assert.deepEqual(c.openTasks, []);
  assert.deepEqual(c.taskAssigneeIds, []);
  const sam = await procoreUser("201");
  await sam.call("setMessageTask", args("open")); // the sender can reopen it
  c = (await conv("").get()).data();
  assert.equal(c.openTasks.length, 1);
  assert.deepEqual(c.taskAssigneeIds, ["202"]);
});

test("composer: a member gets the words for an uploaded voice note; wrong paths and outsiders are refused", async () => {
  const tia = await procoreUser("202");
  const path = `messages/${KEY}/${CID}/m4/voice.webm`;
  await getStorage().bucket().file(path).save(Buffer.alloc(500, 1), { contentType: "audio/webm" });
  const out = await tia.call("transcribeMessageVoice", { key: KEY, path, type: "audio/webm" });
  assert.equal(out.text, "Test transcript (500 bytes of audio).");
  await rejects(tia.call("transcribeMessageVoice", { key: KEY, path: `messages/9_9/${CID}/m4/voice.webm` }), "invalid-argument");
  await rejects(tia.call("transcribeMessageVoice", { key: KEY, path: `voice/someone/x.webm` }), "invalid-argument");
  const outsider = await procoreUser("299");
  await rejects(outsider.call("transcribeMessageVoice", { key: KEY, path }), "permission-denied");
  await rejects(phone().call("transcribeMessageVoice", { key: KEY, path }), "unauthenticated");
});
