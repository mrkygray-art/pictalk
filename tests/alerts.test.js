// Phone alerts (functions/messaging.js): who hears about a new message and what the alert says. No emulators.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { alertTargets, alertFor } = createRequire(import.meta.url)("../functions/messaging.js");

test("everyone on the thread hears about it except the person who wrote it", () => {
  const conv = { createdBy: { procoreUserId: "481274" }, taggedIds: ["900", "901", "481274"] };
  assert.deepEqual(alertTargets(conv, { authorId: "900" }).sort(), ["481274", "901"]);
  assert.deepEqual(alertTargets(conv, { authorId: "481274" }).sort(), ["900", "901"]);
  assert.deepEqual(alertTargets({ createdBy: { procoreUserId: "1" } }, { authorId: "1" }), []);
});

test("the alert: who wrote it, the card's line (words once), and a link that opens the thread", () => {
  const a = alertFor("4291776_373235", "c1", { authorName: "Edward Gray", text: "Ceiling tile and light need to be replaced.", transcript: "Ceiling tile and light need to be replaced", photos: [{ path: "x" }] });
  assert.deepEqual(a, { title: "Edward Gray", body: "Ceiling tile and light need to be replaced", url: "/?companyId=4291776&projectId=373235&cid=c1", tag: "c1" });
  assert.equal(alertFor("1_2", "c", { authorName: "Tyler", photos: [{}, {}] }).body, "Sent 2 photos");
  assert.equal(alertFor("1_2", "c", { authorName: "Tyler", status: { code: "on_it", label: "On it" } }).body, "On it");
  assert.equal(alertFor("1_2", "c", { authorName: "Procore", event: "closed" }).body, "Closed by Procore");
});
