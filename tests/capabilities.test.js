// Tool access per project (api/_capabilities.js) and what the phone does with it (src/messaging/capabilities.js):
// the picker's rows, fallbacks, the guest demo, and My items. No emulators, no Procore: send() is a stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromManifest, manifestEntry, probeAll, stateOf, TOOLS } from "../api/_capabilities.js";
import { isNew, NEW_DAYS, NEW_RELEASED, pickerRows, routeFor, showMyItems } from "../src/messaging/capabilities.js";

const ALL = ["issue", "safety", "delay", "extra", "question"];
const tools = (over = {}) => Object.fromEntries(TOOLS.map((t) => [t, { state: "available", canCreate: true, ...(over[t] ?? {}) }]));

test("a probe's status: 2xx available, 401/403 denied, anything else unknown", () => {
  assert.equal(stateOf(200), "available");
  assert.equal(stateOf(403), "denied");
  assert.equal(stateOf(401), "denied");
  assert.equal(stateOf(404), "unknown");
  assert.equal(stateOf(500), "unknown");
  assert.equal(stateOf(0), "unknown");
});

test("the permission list decides when it names the tool; probes cover the rest", async () => {
  const calls = [];
  const send = async (path) => {
    calls.push(path);
    if (path === "/rest/v1.0/settings/permissions") {
      return { status: 200, json: { tools: [
        { name: "observations", available_for_user: true, can_create: true, user_access_level: { id: 3, name: "Standard" } },
        { name: "change_events", available_for_user: false, can_create: false, user_access_level: { id: 1, name: "None" } },
        { name: "rfi", available_for_user: true, can_create: false, user_access_level: { id: 2, name: "Read Only" } },
      ] } };
    }
    if (path.includes("manpower_logs")) return { status: 403 };
    if (path.includes("incidents")) throw new TypeError("network"); // no signal
    return { status: 200 };
  };
  const { tools: t, manifest } = await probeAll(send, { projectId: "1", today: "2026-10-17" });
  assert.equal(manifest.status, 200);
  assert.deepEqual(t.observations, { state: "available", canCreate: true, level: "Standard", source: "manifest" });
  assert.equal(t.change_events.state, "denied");
  assert.equal(t.rfis.canCreate, false);
  assert.equal(t.daily_log.state, "denied");
  assert.equal(t.incidents.state, "unknown");
  assert.deepEqual(t.punch_list, { state: "denied", canCreate: false, level: null, source: "manifest" }); // not in a 200 list = off
  assert.ok(!calls.some((p) => p.includes("observations/items") || p.includes("punch_items")), "no probe for a tool the list answered");
  assert.ok(calls.some((p) => p.includes("incidents")), "incidents' name isn't confirmed, so it's still probed");
  assert.equal(Object.keys(t).length, TOOLS.length);
});

test("a refused permission list falls back to probes for every tool", async () => {
  const { tools: t, manifest } = await probeAll(async (path) => ({ status: path.includes("settings") ? 404 : 200 }), { projectId: "1", today: "2026-10-17" });
  assert.equal(manifest.status, 404);
  assert.ok(Object.values(t).every((x) => x.state === "available" && x.source === "probe"));
});

test("signed out (an HttpError from the session) is passed on, not turned into unknown", async () => {
  const err = Object.assign(new Error("signed out"), { status: 401 });
  await assert.rejects(probeAll(async () => { throw err; }, { projectId: "1", today: "2026-10-17" }), /signed out/);
});

test("manifest entries: matched by name, None and unavailable mean denied", () => {
  assert.equal(manifestEntry({ tools: [{ name: "checklists" }] }, "inspections")?.name, "checklists");
  assert.equal(manifestEntry({ tools: [] }, "inspections"), null);
  assert.equal(manifestEntry(null, "rfis"), null);
  assert.equal(fromManifest({ available_for_user: true, user_access_level: { id: 1, name: "None" } }).state, "denied");
  assert.equal(fromManifest({ available_for_user: true, can_create: true, user_access_level: { id: 1 } }).canCreate, false);
  assert.equal(fromManifest({ available_for_user: true }).canCreate, null);
});

test("picker: everything allowed shows every ready row with its preferred record", () => {
  const rows = pickerRows(tools(), { ready: ALL });
  assert.deepEqual(rows.map((r) => r.id), ALL);
  assert.deepEqual(rows.map((r) => r.via), ["record", "observation", "daily_log", "change_event", "rfi"]);
});

test("picker: subcontractor (no Change Events, no Daily Log, no RFIs) gets the fallbacks", () => {
  const t = tools({ change_events: { state: "denied" }, daily_log: { state: "denied" }, rfis: { state: "available", canCreate: false } });
  assert.deepEqual(pickerRows(t, { ready: ALL }).map((r) => [r.id, r.via]), [["issue", "record"], ["safety", "observation"], ["delay", "observation"], ["extra", "message"], ["question", "message"]]);
});

test("picker: no Observations hides Safety, and Delay too without the Daily Log; Issue stays on Punch List", () => {
  const t = tools({ observations: { state: "denied" }, daily_log: { state: "denied" } });
  assert.deepEqual(pickerRows(t, { ready: ALL }).map((r) => r.id), ["issue", "extra", "question"]);
  assert.equal(routeFor("issue", tools({ observations: { state: "denied" }, punch_list: { state: "denied" } })), null);
});

test("picker: unknown hides nothing; only built types show; the demo shows every built row", () => {
  assert.deepEqual(pickerRows({}, { ready: ALL }).map((r) => r.id), ALL);
  assert.deepEqual(pickerRows({}, { ready: ["issue"] }).map((r) => r.id), ["issue"]);
  const guest = tools(Object.fromEntries(TOOLS.map((x) => [x, { canCreate: false }])));
  assert.deepEqual(pickerRows(guest, { ready: ALL }).map((r) => r.id), ["extra", "question"]); // what a real view-only user would get
  assert.deepEqual(pickerRows(guest, { ready: ALL, demo: true }).map((r) => r.id), ALL);
});

test("My items shows unless both Observations and Punch List are refused", () => {
  assert.equal(showMyItems({}), true);
  assert.equal(showMyItems(tools({ observations: { state: "denied" } })), true);
  assert.equal(showMyItems(tools({ observations: { state: "denied" }, punch_list: { state: "denied" } })), false);
  assert.equal(showMyItems(tools({ observations: { state: "denied" }, punch_list: { state: "denied" } }), { demo: true }), true);
});

test("the New pill ends NEW_DAYS after release", () => {
  const start = new Date(`${NEW_RELEASED}T00:00:00Z`).getTime();
  assert.equal(isNew(start + 86_400_000), true);
  assert.equal(isNew(start + (NEW_DAYS + 1) * 86_400_000), false);
});

test("the Daily Log probe asks for the day before (a UTC today can be tomorrow on the project's clock)", async () => {
  const seen = [];
  await probeAll(async (path, q) => { seen.push([path, q]); return { status: path.includes("settings") ? 500 : 200 }; }, { projectId: "1", today: "2026-10-18" });
  assert.equal(seen.find(([p]) => p.includes("manpower_logs"))[1].log_date, "2026-10-17");
});
