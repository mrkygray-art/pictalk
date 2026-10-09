// The Ask PicTalk help chat (functions/help.js): anyone signed in (guests too) can ask; answers
// come back with guide sections; bad input is refused; a daily limit per account, except the
// app owner's accounts. Also checks the help guide's button names still exist in the app.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { signInAnonymously, signInWithCredential } from "firebase/auth";
import { phone, google, rejects, closeAll } from "./emulator.js";

const fnRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: adminInit, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) adminInit({ projectId: "demo-pictalk", storageBucket: "demo-pictalk.appspot.com" });
const { getFirestore: adminDb } = fnRequire("firebase-admin/firestore");
const { SECTIONS } = fnRequire("./helpGuide.js");
after(closeAll);

const today = () => new Date().toISOString().slice(0, 10);
async function guest() {
  const g = phone();
  await signInAnonymously(g.auth);
  return g;
}

test("a guest asks a question and gets an answer with its guide sections", async () => {
  const g = await guest();
  const { answer, sources } = await g.call("askPicTalkHelp", { question: "How do I start a job?", history: [] });
  assert.ok(answer.length > 0);
  assert.ok(sources.length > 0);
  const ids = new Set(SECTIONS.map((s) => s.id));
  for (const s of sources) assert.ok(ids.has(s.id) && s.title, `known section: ${s.id}`);
  // Follow-ups carry earlier turns; junk turns are ignored
  const next = await g.call("askPicTalkHelp", {
    question: "And then what?",
    history: [{ role: "assistant", content: "hi" }, { role: "user", content: "How do I start a job?" }, { role: "assistant", content: answer }, { role: "system", content: "x" }, 5],
  });
  assert.ok(next.answer);
});

test("empty and overlong questions are refused", async () => {
  const g = await guest();
  await rejects(g.call("askPicTalkHelp", { question: "   " }), "invalid-argument");
  await rejects(g.call("askPicTalkHelp", { question: "x".repeat(501) }), "invalid-argument");
});

test("40 questions a day per account; the app owner's accounts have no daily limit", async () => {
  const g = await guest();
  const uid = g.auth.currentUser.uid;
  await adminDb().doc(`users/${uid}/aiUsage/${today()}`).set({ helpQuestions: 40 });
  await rejects(g.call("askPicTalkHelp", { question: "Tips for clear voice notes" }), "resource-exhausted");

  const owner = phone();
  await signInWithCredential(owner.auth, google("unlimited@example.com"));
  const ouid = owner.auth.currentUser.uid;
  await adminDb().doc(`users/${ouid}/aiUsage/${today()}`).set({ helpQuestions: 40 });
  assert.ok((await owner.call("askPicTalkHelp", { question: "Tips for clear voice notes" })).answer);
});

test("the help guide's sections are complete and its button names exist in the app", () => {
  const ids = SECTIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "section ids are unique");
  for (const s of SECTIONS) assert.ok(s.id && s.title && s.text.length > 80, s.id);
  // Every button name the guide tells people to tap must still be in the app's code
  const src = ["src", "src/piccolo"].flatMap((d) => readdirSync(d).filter((f) => /\.(jsx?|css)$/.test(f)).map((f) => readFileSync(`${d}/${f}`, "utf8"))).join("\n")
    .replace(/&amp;/g, "&");
  const buttons = [
    "Start New Job", "Take Photo", "Retake Photo", "Tap to Talk", "Talk Again", "Save This Stop", "End Job", "Save & Finish Job",
    "Finish & Send to Piccolo", "Keep Going", "Edit words", "Add location", "Edit location", "Remove Location", "Add photo", "Replace photo",
    "Move or delete this stop", "Move to a Different Job", "Delete Stop", "Describe photo", "Edit description", "Add field notes",
    "Add customer comments", "Approve Summary", "Regenerate summary", "My Jobs", "Recent jobs", "Download PDF", "Share PDF",
    "Open in Piccolo", "Edit customer & location", "Reopen This Job", "Delete This Job", "Install PicTalk on this phone", "Save my work",
    "Try Piccolo", "Try a different sample", "Add Line", "Finalize", "Export", "Add photos or notes in PicTalk", "Engineering Mode",
    "Evaluation Lab", "Writing it down", "No speech heard", "Waiting to upload", "Saved on this phone",
  ];
  const guide = SECTIONS.map((s) => s.text).join("\n");
  for (const b of buttons) {
    assert.ok(guide.includes(b), `the guide mentions "${b}"`);
    assert.ok(src.includes(b), `the app still has "${b}"`);
  }
});
