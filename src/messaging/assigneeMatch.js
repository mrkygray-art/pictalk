// Who the Report card proposes as the assignee (full-loop demo spec step C), against the project's directory
// (people: { id, name, company, title, role }). In order:
//   1. people the speaker named, as the classifier matched them;
//   2. the company the classifier heard ("drywall sub" -> Clean Line Drywall): its people;
//   3. the trade (from the card's trade, else the AI's): people whose company or title names it.
// One person: picked. Several: the best 3 to choose from (foremen first). None: the person must pick.
// Never guesses past that: no match means no assignee.
const low = (s) => String(s ?? "").trim().toLowerCase();

// A trade's key word: "Roofing / Envelope" -> roofing, "Electrical" -> electric, "Plumbing" -> plumb
const STEMS = [["electric", /electric/], ["plumb", /plumb/], ["drywall", /drywall|gypsum/], ["roof", /roof|envelope|waterproof/],
  ["paint", /paint/], ["concrete", /concrete/], ["mechanical", /mechanical|hvac/], ["fire", /fire|sprinkler/]];
export function tradeStem(name) {
  const n = low(name);
  return STEMS.find(([, re]) => re.test(n))?.[0] ?? (n.split(/[\s/]+/)[0] || null);
}

const foremanFirst = (a, b) => (/foreman/i.test(b.title ?? "") - /foreman/i.test(a.title ?? "")) || String(a.name).localeCompare(String(b.name));

/** { picked: [person], choices: [person], how: "named" | "company" | "trade" | null } */
export function proposeAssignee({ draft, people = [], tradeName = null }) {
  const named = (draft?.assignees ?? []).map((a) => people.find((p) => String(p.id) === String(a.id))).filter(Boolean);
  if (named.length) return { picked: named, choices: [], how: "named" };
  const company = low(draft?.suggested_assignee?.company);
  if (company) {
    const crew = people.filter((p) => low(p.company) === company).sort(foremanFirst);
    if (crew.length === 1) return { picked: crew, choices: [], how: "company" };
    if (crew.length > 1) return { picked: [], choices: crew.slice(0, 3), how: "company" };
  }
  const stem = tradeStem(tradeName ?? draft?.trade?.name);
  if (stem) {
    const crew = people.filter((p) => low(p.company).includes(stem) || low(p.title).includes(stem)).sort(foremanFirst);
    if (crew.length === 1) return { picked: crew, choices: [], how: "trade" };
    if (crew.length > 1) return { picked: [], choices: crew.slice(0, 3), how: "trade" };
  }
  return { picked: [], choices: [], how: null };
}
