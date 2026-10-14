// Project directory search (Who do I message?): the whole directory is loaded once per project
// and searched here, on the phone, so typing is instant and works with weak signal.
// People come from /api/procore/directory (api/_responsibilities.js person()):
//   { id, name, firstName, lastName, title, role, company, ... }
// No email or phone reaches the browser; those stay on the server.

export const FILTERS = [
  ["name", "Name"],
  ["title", "Title"],
  ["company", "Company"],
  ["all", "All"],
];

export const clean = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const words = (s) => clean(s).split(/[^a-z0-9&']+/).filter(Boolean);

// One small typo is forgiven for words of 4+ letters ("smoth" finds "Smith")
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}
function nearPrefix(word, term) {
  if (word.startsWith(term)) return true;
  if (term.length < 4) return false;
  // compare with the start of the word at the same length, one shorter and one longer
  return [term.length - 1, term.length, term.length + 1].some((n) => n > 0 && n <= word.length && editDistance(term, word.slice(0, n)) <= 1);
}

// What a filter matches against (title also covers the Procore role, since titles are often blank)
function fieldsFor(p, filter) {
  const name = [p.name, p.firstName, p.lastName].filter(Boolean).join(" ");
  if (filter === "name") return [name];
  if (filter === "title") return [p.title, p.role].filter(Boolean);
  if (filter === "company") return [p.company].filter(Boolean);
  return [name, p.title, p.role, p.company].filter(Boolean);
}

// 0 = exact, 1 = starts with, 2 = every word matches, 3 = contains anywhere, 4 = one typo, -1 = no match
function score(texts, query) {
  const q = clean(query);
  if (!q) return texts.some((t) => clean(t)) ? 2 : -1; // a blank field never matches, even with no query
  const terms = q.split(" ");
  let best = -1;
  const better = (s) => { if (best === -1 || s < best) best = s; };
  for (const t of texts) {
    const c = clean(t);
    if (!c) continue;
    if (c === q) better(0);
    else if (c.startsWith(q)) better(1);
    const ws = words(c);
    if (terms.every((term) => ws.some((w) => w.startsWith(term)))) better(2);
    else if (c.includes(q)) better(3);
    else if (terms.every((term) => ws.some((w) => nearPrefix(w, term)))) better(4);
  }
  return best;
}

const lastNameOf = (p) => clean(p.lastName || String(p.name ?? "").trim().split(/\s+/).pop());

export function searchPeople(people, query, filter = "name") {
  const hits = [];
  for (const p of people ?? []) {
    const s = score(fieldsFor(p, filter), query);
    if (s >= 0) hits.push({ p, s });
  }
  hits.sort((a, b) => a.s - b.s
    || lastNameOf(a.p).localeCompare(lastNameOf(b.p))
    || clean(a.p.name).localeCompare(clean(b.p.name)));
  return hits.map((h) => h.p);
}

// Company filter: the same results grouped under each company, companies A to Z, "No company" last
export function groupByCompany(people) {
  const groups = new Map();
  for (const p of people) {
    const k = p.company || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b))
    .map(([company, list]) => ({ company: company || null, people: list }));
}

// What a selected person carries into the capture flow (and onto the saved stop): no contact details
export const recipientOf = (p) => ({
  procoreUserId: String(p.id),
  name: String(p.name ?? "").slice(0, 120),
  company: p.company ? String(p.company).slice(0, 120) : null,
  title: (p.title || p.role) ? String(p.title || p.role).slice(0, 120) : null,
});

// ---------- per-project cache (localStorage; names, titles and companies only, never tokens) ----------

const CACHE_PREFIX = "sitesnap-directory:";
const LAST_PROJECT = "sitesnap-project";
export const STALE_MS = 60 * 60 * 1000; // refresh in the background when older than an hour

const store = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function readCache(companyId, projectId) {
  try {
    const raw = store()?.getItem(`${CACHE_PREFIX}${companyId}_${projectId}`);
    const v = raw ? JSON.parse(raw) : null;
    return v && Array.isArray(v.people) && typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}

export function writeCache(companyId, projectId, value) {
  try {
    store()?.setItem(`${CACHE_PREFIX}${companyId}_${projectId}`, JSON.stringify(value));
  } catch { /* full or blocked: the list still works, just not offline */ }
}

// The project list, so the picker still works with no signal
const PROJECTS = "sitesnap-projects";
export function readProjectsCache() {
  try {
    const v = JSON.parse(store()?.getItem(PROJECTS) ?? "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
export function writeProjectsCache(list) {
  try { store()?.setItem(PROJECTS, JSON.stringify(list)); } catch { /* ignore */ }
}

// Who signed in on this phone (Procore id and name only), so the feed opens with no signal
const ME = "sitesnap-me";
export function readMe() {
  try {
    const v = JSON.parse(store()?.getItem(ME) ?? "null");
    return v?.procoreUserId ? { procoreUserId: String(v.procoreUserId), name: v.name ?? null } : null;
  } catch {
    return null;
  }
}
export function writeMe(me) {
  try { store()?.setItem(ME, JSON.stringify({ procoreUserId: me.procoreUserId, name: me.name ?? null })); } catch { /* ignore */ }
}
export function clearMe() {
  try { store()?.removeItem(ME); } catch { /* ignore */ }
}

export function readLastProject() {
  try {
    const v = JSON.parse(store()?.getItem(LAST_PROJECT) ?? "null");
    return v && v.companyId && v.projectId ? v : null;
  } catch {
    return null;
  }
}

export function writeLastProject(p) {
  try {
    store()?.setItem(LAST_PROJECT, JSON.stringify({ companyId: String(p.companyId), projectId: String(p.projectId), name: p.name ?? null }));
  } catch { /* ignore */ }
}

// Which project to open: the one in the link, else the last used one (if still on the list), else the only one
export function pickProject(projects, { companyId, projectId } = {}, last = null) {
  const find = (c, p) => projects.find((x) => String(x.companyId) === String(c) && String(x.projectId) === String(p));
  return (companyId && projectId && find(companyId, projectId))
    || (last && find(last.companyId, last.projectId))
    || (projects.length === 1 ? projects[0] : null);
}

export function updatedLabel(at, now = Date.now()) {
  const mins = Math.round((now - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return d.toLocaleString(undefined, sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
