// The Daily Log parser (functions/dailyLogParser.js): the model's answer is only kept where it matches the
// project's real lists, times must be real, unsure answers become "Check this" flags with one-tap fixes, and a
// bad answer falls back to one Note. Uses the spec's test sentences (B9) with model answers shaped like the
// real model's. No emulators or API calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const p = require("../functions/dailyLogParser.js");

const context = {
  date: "2026-10-16",
  timeZone: "America/Los_Angeles",
  myCompany: { id: 10, name: "Ironbridge Construction" },
  companies: [{ id: 10, name: "Ironbridge Construction" }, { id: 11, name: "Summit Framing" }, { id: 12, name: "VoltLine Electric" }, { id: 13, name: "ABC Ready Mix" }],
  delayTypes: [{ id: 1, name: "Weather" }, { id: 2, name: "Material" }, { id: 3, name: "Labor" }, { id: 4, name: "Inspection" }],
  locations: [{ id: 50, name: "Level 2" }],
};
const answer = (over) => ({ understood: true, manpower: [], delays: [], deliveries: [], notes: [], needs_confirmation: [], ...over });
const mp = (over) => ({ company: null, worker_count: null, hours: null, trade: null, location: null, comment: null, source_phrase: "", ...over });
const dl = (over) => ({ delay_type: null, start_time: null, end_time: null, duration_hours: null, company: null, location: null, comment: null, source_phrase: "", ...over });
const dv = (over) => ({ description: null, time: null, vendor: null, comment: null, source_phrase: "", ...over });
const run = (transcript, over) => p.validate(answer(over), { transcript, context });

test("'Six guys on site, drywall delayed waiting on materials, forklift delivery at 10.'", () => {
  const r = run("Six guys on site, drywall delayed waiting on materials, forklift delivery at 10.", {
    manpower: [mp({ worker_count: 6, source_phrase: "six guys on site" })],
    delays: [dl({ delay_type: "Material", comment: "Drywall delayed waiting on materials", source_phrase: "drywall delayed waiting on materials" })],
    deliveries: [dv({ description: "Forklift", time: "10:00", source_phrase: "forklift delivery at 10" })],
    needs_confirmation: [{ path: "deliveries[0].time", reason: "AM or PM not stated" }],
  });
  assert.equal(r.understood, true);
  assert.equal(r.manpower.length, 1);
  assert.equal(r.manpower[0].workers, 6);
  assert.equal(r.manpower[0].company, 10, "the foreman's own company fills in");
  assert.equal(r.manpower[0].defaulted, true);
  assert.equal(r.manpower[0].hours, null, "hours not said stay blank");
  assert.equal(r.delays[0].type, "Material");
  assert.match(r.delays[0].comment, /drywall/i);
  assert.equal(r.deliveries[0].what, "Forklift");
  assert.equal(r.deliveries[0].time, "10:00");
  const f = r.deliveries[0].flags[0];
  assert.deepEqual(f.fields, ["time"]);
  assert.deepEqual(f.options.map((o) => o.label), ["10:00 AM", "10:00 PM"]);
  assert.deepEqual(f.options[1].patch, { time: "22:00" });
  assert.equal(r.notes.length, 0);
});

test("'Just a quiet day, nothing to report.' -> Notes only", () => {
  const r = run("Just a quiet day, nothing to report.", { notes: [{ text: "Quiet day, nothing to report.", location: null, source_phrase: "just a quiet day, nothing to report" }] });
  assert.equal(r.manpower.length + r.delays.length + r.deliveries.length, 0);
  assert.equal(r.notes[0].text, "Quiet day, nothing to report.");
});

test("'Eight framers and three electricians, rain stopped us 1 to 3.' -> two manpower, a weather delay 13:00-15:00 flagged", () => {
  const r = run("Eight framers and three electricians, rain stopped us 1 to 3.", {
    manpower: [mp({ worker_count: 8, trade: "Framing", source_phrase: "eight framers" }), mp({ worker_count: 3, trade: "Electrical", source_phrase: "three electricians" })],
    delays: [dl({ delay_type: "Weather", start_time: "13:00", end_time: "15:00", comment: "Rain", source_phrase: "rain stopped us 1 to 3" })],
    needs_confirmation: [{ path: "manpower[0].company", reason: "not said" }, { path: "manpower[1].company", reason: "not said" }, { path: "delays[0].start_time", reason: "AM or PM not stated" }],
  });
  assert.equal(r.manpower.length, 2);
  assert.equal(r.manpower[0].company, null, "a named trade with no company is never guessed");
  assert.equal(r.manpower[0].flags[0].fields[0], "company");
  assert.ok(r.manpower[0].flags[0].options.some((o) => o.label === "Ironbridge Construction (yours)"));
  assert.equal(r.delays[0].type, "Weather");
  assert.equal(r.delays[0].start, "13:00");
  assert.equal(r.delays[0].end, "15:00");
  const f = r.delays[0].flags.find((x) => x.fields.includes("start"));
  assert.deepEqual(f.options[1].patch, { start: "01:00", end: "03:00" });
});

test("'Concrete truck from ABC Ready Mix at 7:30.' -> vendor matched to the project's company", () => {
  const r = run("Concrete truck from ABC Ready Mix at 7:30.", {
    deliveries: [dv({ description: "Concrete", time: "07:30", vendor: "abc ready mix", source_phrase: "concrete truck from ABC Ready Mix at 7:30" })],
    needs_confirmation: [{ path: "deliveries[0].time", reason: "AM or PM not stated" }],
  });
  assert.equal(r.deliveries[0].from, "ABC Ready Mix");
  assert.equal(r.deliveries[0].flags[0].options[0].label, "7:30 AM");
});

test("gibberish or empty -> not understood, nothing kept", () => {
  const r = run("uh so the um", { understood: false, notes: [{ text: "uh so the um", location: null, source_phrase: "" }] });
  assert.equal(r.understood, false);
  assert.equal(r.notes.length, 0);
});

test("names not on the project's lists are never kept; they become Check this", () => {
  const r = run("Two guys from Acme, inspection hold", {
    manpower: [mp({ worker_count: 2, company: "Acme Concrete" })],
    delays: [dl({ delay_type: "Owner hold", comment: "Inspection hold" })],
  });
  assert.equal(r.manpower[0].company, null);
  assert.match(r.manpower[0].flags[0].reason, /Acme Concrete/);
  assert.equal(r.delays[0].type, null);
  assert.equal(r.delays[0].flags[0].fields[0], "type");
});

test("bad times and numbers are dropped, not passed on", () => {
  const r = run("x", { manpower: [mp({ worker_count: -3, hours: 40 })], deliveries: [dv({ description: "Rebar", time: "25:99" })] });
  assert.equal(r.manpower[0].workers, null);
  assert.equal(r.manpower[0].hours, null);
  assert.equal(r.deliveries[0].time, null);
});

test("an answer that isn't JSON falls back to one Note with the words", () => {
  const r = p.fromModelText("not json", { transcript: "Six guys on site", context });
  assert.equal(r.fallback, true);
  assert.equal(r.notes[0].text, "Six guys on site");
  assert.equal(r.manpower.length, 0);
});

test("the prompt carries the project's lists and the words", () => {
  const s = p.buildPrompt({ transcript: "Six guys on site", context });
  assert.match(s, /FOREMAN'S COMPANY: Ironbridge Construction/);
  assert.match(s, /DELAY TYPES: Weather; Material/);
  assert.match(s, /Six guys on site/);
});

test("the emulator stand-in sorts the spec's main example", () => {
  const raw = p.fakeAnswer({ transcript: "Six guys on site, drywall delayed waiting on materials, forklift delivery at 10." });
  const r = p.validate(raw, { transcript: "x", context });
  assert.equal(r.manpower[0].workers, 6);
  assert.equal(r.delays[0].type, "Material");
  assert.equal(r.deliveries[0].time, "10:00");
  assert.equal(p.fakeAnswer({ transcript: "uh um" }).understood, false);
});
