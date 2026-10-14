// Who do I message? (src/directorySearch.js): searching a project's Procore directory on the phone
// by name, title or company; sorting; grouping; picking the project; and the per-project cache.
// No emulators or network needed.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  groupByCompany, pickProject, readCache, readLastProject, readProjectsCache, recipientOf, searchPeople,
  updatedLabel, writeCache, writeLastProject, writeProjectsCache,
} from "../src/directorySearch.js";

// The shape /api/procore/directory returns (api/_responsibilities.js person())
const P = (id, name, title, company, extra = {}) => {
  const [firstName = null, ...rest] = name.split(" ");
  return { id, name, firstName, lastName: rest.join(" ") || null, title, company, role: title, roleSource: title ? "job_title" : null, tag: null, ...extra };
};
const PEOPLE = [
  P(1, "Jon Smith", "Electrical Foreman", "ABC Mechanical"),
  P(2, "Ana Lopez", null, "Kyco Builders", { role: "Project Manager", roleSource: "project_team" }),
  P(3, "Jon Adams", "Superintendent", null),
  P(4, "Maria Jonas", "Purchasing", "Kyco Builders"),
  P(5, "Jon Smith", "Plumber", "Delta Plumbing"), // same name, another company
];
const names = (q, f) => searchPeople(PEOPLE, q, f).map((p) => `${p.name}#${p.id}`);

test("Name: first, last, or full name, in any case, with extra spaces; 'jon sm' finds Jon Smith", () => {
  assert.deepEqual(names("jon sm", "name"), ["Jon Smith#1", "Jon Smith#5"]);
  assert.deepEqual(names("  SMITH ", "name"), ["Jon Smith#1", "Jon Smith#5"]);
  assert.deepEqual(names("lopez", "name"), ["Ana Lopez#2"]);
});

test("Name forgives one small typo in a longer word", () => {
  assert.deepEqual(names("smoth", "name"), ["Jon Smith#1", "Jon Smith#5"]);
  assert.deepEqual(names("lopze", "name"), ["Ana Lopez#2"]);
  assert.deepEqual(names("xyz", "name"), [], "short nonsense matches nobody");
});

test("Title: 'electric' finds the Electrical Foreman; Procore roles count when the title is blank", () => {
  assert.deepEqual(names("electric", "title"), ["Jon Smith#1"]);
  assert.deepEqual(names("project man", "title"), ["Ana Lopez#2"]);
});

test("Title: someone with no title or role isn't in Title results but still is in Name and Company", () => {
  const people = [P(9, "No Title", null, "ABC Mechanical")];
  assert.deepEqual(searchPeople(people, "", "title"), []);
  assert.deepEqual(searchPeople(people, "no", "name").map((p) => p.id), [9]);
  assert.deepEqual(searchPeople(people, "abc", "company").map((p) => p.id), [9]);
});

test("Company: matches anywhere in the company name; All searches every field", () => {
  assert.deepEqual(names("kyco", "company"), ["Maria Jonas#4", "Ana Lopez#2"], "same match, so by last name");
  assert.deepEqual(names("mechanical", "company"), ["Jon Smith#1"]);
  assert.deepEqual(names("purch", "all"), ["Maria Jonas#4"]);
  assert.deepEqual(names("delta", "all"), ["Jon Smith#5"]);
});

test("sort: exact and starts-with matches first, then by last name", () => {
  assert.deepEqual(names("jon", "name"), ["Jon Adams#3", "Jon Smith#1", "Jon Smith#5", "Maria Jonas#4"]);
  assert.deepEqual(names("", "name"), ["Jon Adams#3", "Maria Jonas#4", "Ana Lopez#2", "Jon Smith#1", "Jon Smith#5"]);
});

test("Company grouping: companies A to Z, people without a company last", () => {
  const groups = groupByCompany(searchPeople(PEOPLE, "", "all"));
  assert.deepEqual(groups.map((g) => [g.company, g.people.length]), [
    ["ABC Mechanical", 1], ["Delta Plumbing", 1], ["Kyco Builders", 2], [null, 1],
  ]);
});

test("a picked person carries id, name, company and title only: no contact details", () => {
  const r = recipientOf({ ...PEOPLE[1], email: "ana@example.com", phone: "555-0100" });
  assert.deepEqual(r, { procoreUserId: "2", name: "Ana Lopez", company: "Kyco Builders", title: "Project Manager" });
  assert.deepEqual(recipientOf(P(3, "Jon Adams", null, null)), { procoreUserId: "3", name: "Jon Adams", company: null, title: null });
});

test("which project opens: the link's, else the last used one still on the list, else the only one", () => {
  const list = [
    { companyId: "1", projectId: "10", name: "Tower" },
    { companyId: "1", projectId: "11", name: "Annex" },
  ];
  assert.equal(pickProject(list, { companyId: "1", projectId: "11" }, null).name, "Annex");
  assert.equal(pickProject(list, {}, { companyId: "1", projectId: "10" }).name, "Tower");
  assert.equal(pickProject(list, {}, { companyId: "9", projectId: "99" }), null, "a project you're no longer on isn't reopened");
  assert.equal(pickProject(list, {}, null), null, "several projects: the user picks");
  assert.equal(pickProject([list[0]], {}, null).name, "Tower", "only one: chosen for you");
  assert.equal(pickProject([], {}, null), null, "no projects");
  assert.equal(pickProject(list, { companyId: "1", projectId: "77" }, null), null, "a link to a project you can't see isn't trusted");
});

// localStorage stand-in for the cache tests
let mem;
beforeEach(() => {
  mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
});

test("the directory is saved per project with its time, and read back offline", () => {
  assert.equal(readCache("1", "10"), null);
  writeCache("1", "10", { people: PEOPLE, at: 1000 });
  writeCache("1", "11", { people: [], at: 2000 });
  assert.equal(readCache("1", "10").people.length, 5);
  assert.equal(readCache("1", "11").at, 2000);
  mem.set("sitesnap-directory:1_12", "not json");
  assert.equal(readCache("1", "12"), null, "a broken entry is ignored");
});

test("cache, last project and project list survive storage that throws (private mode)", () => {
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  writeCache("1", "10", { people: [], at: 1 });
  writeLastProject({ companyId: "1", projectId: "10" });
  writeProjectsCache([{ companyId: "1", projectId: "10", name: "T" }]);
  assert.equal(readCache("1", "10"), null);
  assert.equal(readLastProject(), null);
  assert.equal(readProjectsCache(), null);
});

test("the last project and the project list are remembered", () => {
  writeLastProject({ companyId: 1, projectId: 10, name: "Tower", extra: "x" });
  assert.deepEqual(readLastProject(), { companyId: "1", projectId: "10", name: "Tower" });
  writeProjectsCache([{ companyId: "1", projectId: "10", name: "Tower" }]);
  assert.equal(readProjectsCache()[0].name, "Tower");
});

test("Last updated reads plainly", () => {
  const now = new Date(2026, 9, 14, 15, 0).getTime();
  assert.equal(updatedLabel(now - 20000, now), "just now");
  assert.equal(updatedLabel(now - 12 * 60000, now), "12 min ago");
  assert.match(updatedLabel(now - 3 * 3600000, now), /12:00/);
});
