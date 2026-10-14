// SiteSnap messaging rules (firestore.rules, storage.rules): only a Procore project's members read its
// conversations, messages and files; people write only as themselves; server fields stay server-only.
// Members are recorded by api/procore/session at procoreProjects/{key}/members/{procoreUserId}.
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, arrayUnion } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";

const KEY = "4291776_373235";
const OTHER = "4291776_999";
let env;
// A Procore user's SiteSnap sign-in (api/procore/session): uid procore_{id}, claim procoreUserId
const user = (id) => env.authenticatedContext(`procore_${id}`, { procoreUserId: id });
const fs = (id) => user(id).firestore();
const P = (id, name) => ({ procoreUserId: id, name, company: "ABC Mechanical", title: null });
const conv = (by, tagged, extra = {}) => ({
  createdBy: P(by, `User ${by}`), tagged: tagged.map((t) => P(t, `User ${t}`)), taggedIds: tagged,
  status: "open", createdAt: 1, lastActivityAt: 1, ...extra,
});
const msg = (author, extra = {}) => ({
  authorId: author, authorName: `User ${author}`, text: "Can you send the door schedule?", transcript: "", transcriptStatus: "none",
  photos: [{ path: `messages/${KEY}/c1/m2/photo-1.jpg` }], voicePath: null, voiceType: null, aiDescription: null, clientCreatedAt: 2, createdAt: 2, ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pictalk-msgrules",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const id of ["101", "102", "103"]) await setDoc(doc(db, `procoreProjects/${KEY}/members/${id}`), { procoreUserId: id, name: `User ${id}`, at: 1 });
    await setDoc(doc(db, `procoreProjects/${OTHER}/members/104`), { procoreUserId: "104", name: "User 104", at: 1 });
    await setDoc(doc(db, `procoreProjects/${KEY}/conversations/c1`), conv("101", ["102"], { lastMessage: { text: "hi" }, messageCount: 1 }));
    await setDoc(doc(db, `procoreProjects/${KEY}/conversations/c1/messages/m1`), msg("101"));
    await setDoc(doc(db, "procoreUsers/101"), { name: "User 101", projectKeys: [KEY] });
    await setDoc(doc(db, `procoreProjects/${KEY}/responsibilities/102`), { label: "PM" });
  });
});
after(async () => { await env.cleanup(); });

test("project members read its conversations and messages, tagged or not; nobody else does", async () => {
  for (const id of ["101", "102", "103"]) {
    await assertSucceeds(getDoc(doc(fs(id), `procoreProjects/${KEY}/conversations/c1`)));
    await assertSucceeds(getDocs(collection(fs(id), `procoreProjects/${KEY}/conversations/c1/messages`)));
  }
  await assertSucceeds(getDocs(query(collection(fs("103"), `procoreProjects/${KEY}/conversations`), where("taggedIds", "array-contains", "103"))));
  await assertFails(getDoc(doc(fs("104"), `procoreProjects/${KEY}/conversations/c1`)), "on another project");
  await assertFails(getDocs(collection(fs("104"), `procoreProjects/${KEY}/conversations`)));
  // A PicTalk-style account (no Procore claim) and nobody signed in
  await assertFails(getDoc(doc(env.authenticatedContext("guest1").firestore(), `procoreProjects/${KEY}/conversations/c1`)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `procoreProjects/${KEY}/conversations/c1`)));
});

test("a member starts a conversation as themselves, tagging at least one person; summary fields are server-only", async () => {
  await assertSucceeds(setDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/c2`), conv("102", ["101", "103"])));
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/c3`), conv("101", ["103"])), "as someone else");
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/c4`), conv("102", [])), "no one tagged");
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/c5`), conv("102", ["101"], { lastMessage: { text: "fake" } })), "server field");
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/c6`), conv("102", ["101"], { status: "closed" })), "must start open");
  await assertFails(setDoc(doc(fs("104"), `procoreProjects/${KEY}/conversations/c7`), conv("104", ["101"])), "not a member");
  await assertFails(deleteDoc(doc(fs("101"), `procoreProjects/${KEY}/conversations/c1`)), "no deleting");
});

test("any member tags more people; the people on it open / close; nobody untags or edits the summary", async () => {
  const ref1 = (id) => doc(fs(id), `procoreProjects/${KEY}/conversations/c1`);
  await assertSucceeds(updateDoc(ref1("103"), { tagged: arrayUnion(P("103", "User 103")), taggedIds: arrayUnion("103") }));
  await assertSucceeds(updateDoc(ref1("102"), { status: "closed", statusBy: "102", statusAt: 5 }));
  await assertSucceeds(updateDoc(ref1("101"), { status: "open", statusBy: "101", statusAt: 6 }));
  await assertFails(updateDoc(ref1("101"), { taggedIds: ["101"] }), "removing tagged people");
  await assertFails(updateDoc(ref1("101"), { lastMessage: { text: "edited" } }));
  await assertFails(updateDoc(ref1("101"), { status: "archived" }));
  await assertFails(updateDoc(ref1("104"), { status: "closed" }), "not a member");
  await assertFails(updateDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/c2`), { status: "closed", statusBy: "103", statusAt: 7 }), "statusBy must be me");
});

test("messages: written once by their author; tasks and other server fields can't be faked", async () => {
  const m = (id, mid) => doc(fs(id), `procoreProjects/${KEY}/conversations/c1/messages/${mid}`);
  await assertSucceeds(setDoc(m("102", "m2"), msg("102")));
  await assertFails(setDoc(m("102", "m3"), msg("101")), "as someone else");
  await assertFails(setDoc(m("102", "m4"), msg("102", { tasks: [{ text: "fake" }] })), "tasks are server-only");
  await assertFails(setDoc(m("102", "m5"), msg("102", { transcriptStatus: "failed" })));
  await assertFails(setDoc(m("102", "m6"), msg("102", { photos: Array.from({ length: 11 }, () => ({ path: "x" })) })), "at most 10 photos");
  await assertFails(updateDoc(m("101", "m1"), { text: "changed" }), "no editing");
  await assertFails(setDoc(m("104", "m7"), msg("104")), "not a member");
});

test("read marks: mine only; members, users and tags stay server-only", async () => {
  await assertSucceeds(setDoc(doc(fs("102"), `procoreProjects/${KEY}/members/102/reads/c1`), { lastReadAt: 9 }));
  await assertSucceeds(getDoc(doc(fs("102"), `procoreProjects/${KEY}/members/102/reads/c1`)));
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${KEY}/members/101/reads/c1`), { lastReadAt: 9 }), "someone else's");
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${KEY}/members/102/reads/c1`), { lastReadAt: 9, extra: 1 }));
  await assertSucceeds(getDoc(doc(fs("102"), `procoreProjects/${KEY}/members/102`)), "my own membership");
  await assertFails(getDoc(doc(fs("102"), `procoreProjects/${KEY}/members/101`)));
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${OTHER}/members/102`), { procoreUserId: "102" }), "can't add myself to a project");
  await assertFails(getDoc(doc(fs("101"), "procoreUsers/101")));
  await assertFails(getDoc(doc(fs("102"), `procoreProjects/${KEY}/responsibilities/102`)));
});

test("message files: members of that project upload and read photos and voice notes; nobody else", async () => {
  // Storage rules look members up in the emulators' own project (demo-pictalk), so check files there
  const senv = await initializeTestEnvironment({
    projectId: "demo-pictalk",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
  await senv.withSecurityRulesDisabled(async (ctx) => {
    for (const id of ["102", "103"]) await setDoc(doc(ctx.firestore(), `procoreProjects/${KEY}/members/${id}`), { procoreUserId: id, name: `User ${id}`, at: 1 });
    await setDoc(doc(ctx.firestore(), `procoreProjects/${OTHER}/members/104`), { procoreUserId: "104", name: "User 104", at: 1 });
  });
  const st = (id) => senv.authenticatedContext(`procore_${id}`, { procoreUserId: id }).storage();
  const photo = `messages/${KEY}/c1/m2/photo-1.jpg`;
  const voice = `messages/${KEY}/c1/m2/voice.webm`;
  await assertSucceeds(uploadBytes(ref(st("102"), photo), new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
  await assertSucceeds(uploadBytes(ref(st("102"), voice), new Uint8Array([1, 2, 3]), { contentType: "audio/webm" }));
  await assertSucceeds(getBytes(ref(st("103"), photo)));
  await assertFails(getBytes(ref(st("104"), photo)), "another project's member");
  await assertFails(uploadBytes(ref(st("104"), `messages/${KEY}/c1/m9/photo-1.jpg`), new Uint8Array([1]), { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(st("102"), `messages/${KEY}/c1/m9/photo-1.jpg`), new Uint8Array([1]), { contentType: "text/html" }), "photos must be images");
  await assertFails(uploadBytes(ref(st("102"), `messages/${KEY}/c1/m9/notes.txt`), new Uint8Array([1]), { contentType: "text/plain" }), "only photo-* and voice.*");
  await senv.cleanup();
});

test("quick replies: a short status rides on a message; a made-up shape is refused", async () => {
  const m = (mid) => doc(fs("102"), `procoreProjects/${KEY}/conversations/c1/messages/${mid}`);
  await assertSucceeds(setDoc(m("q1"), msg("102", { text: "", photos: [], status: { code: "on_it", label: "On it" } })));
  await assertSucceeds(setDoc(m("q2"), msg("102", { text: "", photos: [], status: { code: "delayed", label: "Delayed", reason: "Weather", newDate: "Fri, Oct 16" } })));
  await assertFails(setDoc(m("q3"), msg("102", { status: { code: "done", label: "Done", by: "101" } })), "extra keys");
  await assertFails(setDoc(m("q4"), msg("102", { status: "done" })), "must be a map");
  await assertFails(setDoc(m("q5"), msg("102", { status: { code: "", label: "x" } })), "empty code");
});

test("closed: no new messages (rules too, not just the screen); only the sender or someone tagged closes or reopens", async () => {
  const { writeBatch } = await import("firebase/firestore");
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `procoreProjects/${KEY}/conversations/k1`), conv("101", ["102"]));
  });
  const line = (id, event) => msg(id, { text: "", photos: [], event, clientCreatedAt: 9, createdAt: 9 });
  const close = (id, mid) => {
    const f = fs(id);
    const b = writeBatch(f);
    b.update(doc(f, `procoreProjects/${KEY}/conversations/k1`), { status: "closed", statusBy: id, statusAt: 9 });
    b.set(doc(f, `procoreProjects/${KEY}/conversations/k1/messages/${mid}`), line(id, "closed"));
    return b.commit();
  };
  const reopen = (id, mid) => {
    const f = fs(id);
    const b = writeBatch(f);
    b.update(doc(f, `procoreProjects/${KEY}/conversations/k1`), { status: "open", statusBy: id, statusAt: 10 });
    b.set(doc(f, `procoreProjects/${KEY}/conversations/k1/messages/${mid}`), line(id, "reopened"));
    return b.commit();
  };
  await assertFails(close("103", "e0"), "103 is on the project but not on this message");
  await assertSucceeds(close("102", "e1"));
  await assertFails(setDoc(doc(fs("101"), `procoreProjects/${KEY}/conversations/k1/messages/n1`), msg("101")), "no messages while closed");
  await assertFails(setDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/k1/messages/n2`), msg("102", { status: { code: "done", label: "Done" } })), "not even a quick reply");
  await assertFails(setDoc(doc(fs("101"), `procoreProjects/${KEY}/conversations/k1/messages/n3`), line("101", "closed")), "a closed line on its own, already closed: only with the close");
  await assertFails(reopen("103", "e2"), "not on this message");
  await assertSucceeds(reopen("101", "e3"));
  await assertSucceeds(setDoc(doc(fs("102"), `procoreProjects/${KEY}/conversations/k1/messages/n4`), msg("102")), "open again: messages are back");
  await assertFails(setDoc(doc(fs("103"), `procoreProjects/${KEY}/conversations/k1/messages/n5`), line("103", "reopened")), "a reopened line from someone not on it");
});
