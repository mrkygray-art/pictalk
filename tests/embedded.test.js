// Embedded mode (src/embedded.js): companyId / projectId from the link, unfilled {{...}}
// placeholders count as not received, and iframe detection. No emulators needed.
// The browser side (strip, button, new tab) is checked by e2e/e2e-embed.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanId, inIframe, readEmbed } from "../src/embedded.js";

// A pretend window: top is itself unless a parent is given
function fakeWindow(search, { parent, throwOnTop = false } = {}) {
  const win = { location: { search } };
  win.self = win;
  if (throwOnTop) {
    Object.defineProperty(win, "top", { get() { throw new Error("cross-origin"); } });
  } else {
    win.top = parent ?? win;
  }
  return win;
}

test("real ids are kept (trimmed); blank and {{...}} placeholders are not received", () => {
  assert.equal(cleanId("123"), "123");
  assert.equal(cleanId("  456 "), "456");
  assert.equal(cleanId("abc-DEF_9"), "abc-DEF_9");
  for (const missing of [null, undefined, "", "   ", "{{procore.company.id}}", "{{procore.project.id}}", "{{ projectId }}", "{{}}"]) {
    assert.equal(cleanId(missing), null, JSON.stringify(missing));
  }
  // Only a whole {{...}} value is a placeholder
  assert.equal(cleanId("{single}"), "{single}");
  assert.equal(cleanId("12{{x}}"), "12{{x}}");
});

test("iframe detection: window.self !== window.top, and a blocked top counts as embedded", () => {
  assert.equal(inIframe(fakeWindow("")), false);
  assert.equal(inIframe(fakeWindow("", { parent: {} })), true);
  assert.equal(inIframe(fakeWindow("", { throwOnTop: true })), true);
});

test("readEmbed reads both ids from the query string", () => {
  assert.deepEqual(readEmbed(fakeWindow("?companyId=123&projectId=456", { parent: {} })), {
    embedded: true, companyId: "123", projectId: "456", hasIds: true,
  });
});

test("literal {{procore...}} placeholders, raw or percent-encoded, are not received", () => {
  for (const search of [
    "?companyId={{procore.company.id}}&projectId={{procore.project.id}}",
    "?companyId=%7B%7Bprocore.company.id%7D%7D&projectId=%7B%7Bprocore.project.id%7D%7D",
  ]) {
    assert.deepEqual(readEmbed(fakeWindow(search, { parent: {} })), {
      embedded: true, companyId: null, projectId: null, hasIds: true,
    }, search);
  }
});

test("one id filled, the other a placeholder or missing", () => {
  assert.deepEqual(readEmbed(fakeWindow("?companyId=77&projectId={{procore.project.id}}", { parent: {} })), {
    embedded: true, companyId: "77", projectId: null, hasIds: true,
  });
  assert.deepEqual(readEmbed(fakeWindow("?projectId=88")), {
    embedded: false, companyId: null, projectId: "88", hasIds: true,
  });
});

test("an ordinary PicTalk link: not embedded, no ids (the strip stays hidden)", () => {
  assert.deepEqual(readEmbed(fakeWindow("")), { embedded: false, companyId: null, projectId: null, hasIds: false });
  assert.deepEqual(readEmbed(fakeWindow("?invite=abc")), { embedded: false, companyId: null, projectId: null, hasIds: false });
});
