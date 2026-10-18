// The capture classifier (functions/classifier.js): the model's draft is only kept where it matches the
// project's real lists, unknown fields stay blank, dates resolve from what was said, and any bad answer
// falls back to an Observation with the raw words. Uses the spec's five sample utterances with model
// answers shaped like the real model's. No emulators or API calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const c = require("../functions/classifier.js");

const NOW = new Date(2026, 9, 14, 9, 0); // Wednesday, Oct 14, 2026
const context = {
  projectName: "1234 - Sandbox Test Project",
  observationTypes: [
    { id: 11036845, name: "Deficiency", category: "Quality" },
    { id: 11036851, name: "Safety Hazard", category: "Safety" },
    { id: 11036855, name: "Commissioning", category: "Commissioning" },
  ],
  trades: [{ id: 1, name: "Painting" }, { id: 2, name: "Drywall" }, { id: 3, name: "Electrical" }, { id: 4, name: "Fire Protection" }],
  locations: [{ id: 50, name: "Level 2" }],
  people: [
    { id: 481274, name: "Edward Gray", company: "Kyco", title: null },
    { id: 900, name: "Lisa Hubbard", company: "ABC Drywall", title: "Foreman" },
    { id: 901, name: "John Bohaman", company: "Delta Plumbing", title: null },
    { id: 902, name: "Jim Henson", company: "Kyco", title: "Superintendent" },
  ],
};
const answer = (over) => ({
  record_type: "observation", confidence: 0.9, title: "", description: "", observation_type: "", trade: "", location: "",
  priority: "", assignee_names: [], due: "", impact_mentioned: false, impact_notes: "", missing_fields: [], reasoning_short: "", ...over,
});
const run = (transcript, over) => c.validate(answer(over), { transcript, context, now: NOW });

test("'Paint touch up on the wall by the stairwell on level two' -> Punch Item, Painting, Level 2 stairwell", () => {
  const t = "Paint touch up on the wall by the stairwell on level two.";
  const r = run(t, { record_type: "punch_item", title: "Paint touch-up at Level 2 stairwell wall", description: "Paint touch-up needed on the wall by the stairwell on Level 2.", trade: "Painting", location: "Level 2 stairwell", priority: "low" });
  assert.equal(r.record_type, "punch_item");
  assert.deepEqual(r.trade, { id: 1, name: "Painting" });
  assert.equal(r.location_text, "Level 2 stairwell");
  assert.deepEqual(r.location, { id: 50, name: "Level 2" }, "matches the project's Level 2 location");
  assert.equal(r.priority, "low");
  assert.equal(r.transcript, t, "the original words are kept untouched");
  assert.deepEqual(r.missing_fields, ["assignee", "due"]);
});

test("'Fire caulking is missing around the pipe penetrations in the electrical room' -> Observation, high, Deficiency", () => {
  const r = run("Fire caulking is missing around the pipe penetrations in the electrical room.", {
    title: "Fire caulking missing at electrical room pipe penetrations", description: "Fire caulking is missing around the pipe penetrations in the electrical room.",
    observation_type: "Deficiency", trade: "Fire Protection", location: "electrical room", priority: "high",
  });
  assert.equal(r.record_type, "observation");
  assert.deepEqual(r.observation_type, { id: 11036845, name: "Deficiency", category: "Quality" });
  assert.equal(r.priority, "high");
  assert.equal(r.location_text, "electrical room");
  assert.equal(r.location, null, "not one of the project's locations: kept as words, no id");
});

test("'Duct is in the way of our conduit, reroute, two guys half a day' -> Observation in the MVP, impact noted, could be a Change Event", () => {
  const r = run("Duct is in the way of our conduit, we need to reroute, two guys half a day.", {
    record_type: "change_event", title: "Duct conflicts with conduit route", description: "A duct is in the way of the conduit; the conduit needs to be rerouted.",
    trade: "Electrical", impact_mentioned: true, impact_notes: "two guys half a day",
  });
  assert.equal(r.record_type, "observation");
  assert.equal(r.suggested_record_type, "change_event");
  assert.equal(r.impact_mentioned, true);
  assert.match(r.description, /Possible cost or schedule impact: two guys half a day\.$/);
  assert.equal(r.impact_notes, "two guys half a day", "as said, never calculated");
});

test("'Tell Lisa the drywall in room 204 needs to be redone by Friday' -> Punch Item for Lisa Hubbard, due Friday", () => {
  const r = run("Tell Lisa the drywall in room 204 needs to be redone by Friday.", {
    record_type: "punch_item", title: "Redo drywall in Room 204", description: "The drywall in Room 204 needs to be redone.",
    trade: "Drywall", location: "Room 204", assignee_names: ["Lisa"], due: "Friday",
  });
  assert.equal(r.record_type, "punch_item");
  assert.deepEqual(r.assignees, [{ id: 900, name: "Lisa Hubbard" }]);
  assert.equal(r.due_date, "2026-10-16", "the coming Friday");
  assert.equal(r.due_said, "Friday");
  assert.deepEqual(r.trade, { id: 2, name: "Drywall" });
});

test("'Something's off back there' -> low confidence, an Observation, mostly blank, asks for more", () => {
  const r = run("Something's off back there.", { record_type: "unknown", confidence: 0.2, description: "Something is off in the back area." });
  assert.equal(r.record_type, "observation");
  assert.equal(r.low_confidence, true, "the card leads with the type switcher");
  assert.equal(r.title, null);
  assert.deepEqual(r.missing_fields, ["title", "trade", "location", "priority", "assignee", "due"]);
});

test("never invents: unknown people, trades and types are dropped, not guessed", () => {
  const r = run("Tell Mike to fix it.", { assignee_names: ["Mike", "Edward"], trade: "Glazing", observation_type: "Crack" });
  assert.deepEqual(r.assignees, [{ id: 481274, name: "Edward Gray" }]);
  assert.deepEqual(r.unmatched_names, ["Mike"], "said but not on the project: the foreman picks");
  assert.equal(r.trade, null);
  assert.equal(r.observation_type, null);
});

test("two people with the same first name: no guess", () => {
  const two = { ...context, people: [...context.people, { id: 903, name: "Lisa Chen", company: "Kyco" }] };
  const r = c.validate(answer({ assignee_names: ["Lisa"] }), { transcript: "Tell Lisa", context: two, now: NOW });
  assert.deepEqual(r.assignees, []);
  assert.deepEqual(r.unmatched_names, ["Lisa"]);
  const full = c.validate(answer({ assignee_names: ["Lisa Chen"] }), { transcript: "Tell Lisa Chen", context: two, now: NOW });
  assert.deepEqual(full.assignees, [{ id: 903, name: "Lisa Chen" }]);
});

test("due dates: weekdays, today, tomorrow, a written date; nothing in the past; nonsense stays blank", () => {
  assert.equal(c.resolveDue("Friday", NOW), "2026-10-16");
  assert.equal(c.resolveDue("by Wednesday", NOW), "2026-10-21", "today is Wednesday, so next week's");
  assert.equal(c.resolveDue("today", NOW), "2026-10-14");
  assert.equal(c.resolveDue("tomorrow", NOW), "2026-10-15");
  assert.equal(c.resolveDue("2026-10-20", NOW), "2026-10-20");
  assert.equal(c.resolveDue("Oct 20", NOW), "2026-10-20");
  assert.equal(c.resolveDue("2026-01-01", NOW), null, "in the past");
  assert.equal(c.resolveDue("before the pour", NOW), null);
  assert.equal(c.resolveDue("", NOW), null);
});

test("an RFI or unsupported type becomes an Observation for now; priority and confidence are kept in range", () => {
  const r = run("Need the architect to confirm the ceiling height.", { record_type: "rfi", priority: "urgent", confidence: 7 });
  assert.equal(r.record_type, "observation");
  assert.equal(r.suggested_record_type, "rfi");
  assert.equal(r.priority, null);
  assert.equal(r.confidence, 1);
});

test("bad model output falls back to an Observation with the raw words", () => {
  const t = "Water stain on the ceiling tile in the lobby near the door.";
  for (const text of ["not json", "[]", '{"record_type": 3}'.replace("3", "null"), ""]) {
    const r = c.fromModelText(text, { transcript: t, context, now: NOW });
    assert.equal(r.record_type, "observation");
    assert.equal(r.description, t.replace(/\s+/g, " ").trim());
    assert.equal(r.transcript, t);
  }
  const fb = c.fallback(t, "model unavailable");
  assert.equal(fb.fallback, true);
  assert.equal(fb.title, "Water stain on the ceiling tile in the lobby near");
  assert.ok(fb.missing_fields.includes("trade"));
});

test("the prompt carries today's date, the project's lists, and the words", () => {
  const p = c.buildPrompt({ transcript: "Paint touch up", context, now: NOW });
  assert.match(p, /TODAY: Wednesday, October 14, 2026/);
  assert.match(p, /Deficiency \(Quality\)/);
  assert.match(p, /Lisa Hubbard, ABC Drywall, Foreman/);
  assert.match(p, /FOREMAN SAID:\nPaint touch up/);
  assert.ok(!/@/.test(p), "no email addresses go to the model");
});

test("the emulator stand-in follows the same rules (used by later end-to-end tests)", () => {
  const input = { transcript: "Tell Lisa the drywall in room 204 needs to be redone by Friday", context, now: NOW };
  const r = c.validate(c.fakeAnswer(input), input);
  assert.equal(r.record_type, "punch_item");
  assert.deepEqual(r.assignees, [{ id: 900, name: "Lisa Hubbard" }]);
  assert.equal(r.due_date, "2026-10-16");
});

// ---------- full-loop demo spec step B: who it's for, the follow-up question ----------

test("'Cracked drywall at the east stairwell … drywall sub' -> the project's drywall company, nobody invented", () => {
  const r = run("Cracked drywall at the east stairwell, needs fixing before paint Thursday, drywall sub.", {
    title: "Cracked drywall at east stairwell", description: "Cracked drywall at the east stairwell needs fixing before paint on Thursday.",
    observation_type: "Deficiency", trade: "Drywall", location: "east stairwell", priority: "medium", due: "Thursday", assignee_company: "ABC Drywall",
  });
  assert.deepEqual(r.suggested_assignee, { name: null, company: "ABC Drywall" });
  assert.deepEqual(r.assignees, [], "a company, not a person: the card picks the person");
  assert.equal(r.due_date, "2026-10-15");
  assert.equal(r.follow_up_question, null, "sure of it: no question");
  assert.deepEqual(r.missing_info, r.missing_fields);
});

test("a company that isn't on the project is dropped; a named person is the suggested name", () => {
  assert.equal(run("Get the roofer out here.", { assignee_company: "Skyline Roofing" }).suggested_assignee.company, null);
  assert.equal(run("Tell Lisa.", { assignee_names: ["Lisa"], assignee_company: "abc drywall" }).suggested_assignee.name, "Lisa Hubbard");
  assert.equal(run("Tell Lisa.", { assignee_company: "abc drywall" }).suggested_assignee.company, "ABC Drywall", "as the project lists it");
});

test("not sure: the one follow-up question is kept; sure: it's dropped", () => {
  const unsure = run("Something's off back there.", { record_type: "unknown", confidence: 0.3, follow_up_question: "What needs fixing, and where is it?" });
  assert.equal(unsure.follow_up_question, "What needs fixing, and where is it?");
  const sure = run("Fire caulking missing.", { confidence: 0.9, follow_up_question: "Which room?" });
  assert.equal(sure.follow_up_question, null);
  assert.equal(c.fallback("x").follow_up_question, null);
  assert.ok(c.SCHEMA.required.includes("assignee_company") && c.SCHEMA.required.includes("follow_up_question"));
  assert.ok(c.SCHEMA.properties.record_type.enum.includes("daily_log"));
});

test("the emulator stand-in hears 'drywall sub' and asks when it's vague", () => {
  const ctx = { ...context, people: [...context.people, { id: 903, name: "Carlos Mendez", company: "Clean Line Drywall", title: "Drywall Foreman" }] };
  const sub = c.validate(c.fakeAnswer({ transcript: "Cracked drywall at the east stairwell, needs fixing before paint Thursday, drywall sub.", context: { ...ctx, people: ctx.people.filter((p) => p.id !== 900) } }), { transcript: "x", context: ctx, now: NOW });
  assert.equal(sub.suggested_assignee.company, "Clean Line Drywall");
  const vague = c.validate(c.fakeAnswer({ transcript: "Something's off.", context: ctx }), { transcript: "Something's off.", context: ctx, now: NOW });
  assert.match(vague.follow_up_question, /What needs fixing/);
});
