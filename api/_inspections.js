// Inspections (sitesnap-inspections-spec.md): the one place for Procore's Inspections paths and field names, plus
// plain functions that turn Procore's answers into what the screens need. Procore's API still calls inspections
// "checklists": an inspection is a checklist list, a question is a checklist item. Best-known names from the desk
// check (docs/inspections-api-notes.md); confirm with /api/procore/test-inspections and fix any mismatch here only.

export const PATHS = {
  lists: (projectId) => `/rest/v1.0/projects/${projectId}/checklist/lists`,
  list: (listId) => `/rest/v1.0/checklist/lists/${listId}`, // ?project_id=
  respond: (projectId, itemId) => `/rest/v1.0/projects/${projectId}/checklist/items/${itemId}/item_response`,
  item: (listId, itemId) => `/rest/v1.0/checklist/lists/${listId}/items/${itemId}`,
  comment: (listId) => `/rest/v1.0/checklist/lists/${listId}/comments`, // body { project_id, item_id, comment: { body } }
  sectionToggle: (listId, sectionId) => `/rest/v1.0/checklist/lists/${listId}/sections/${sectionId}/toggle_not_applicable`,
  section: (listId, sectionId) => `/rest/v1.0/checklist/lists/${listId}/sections/${sectionId}`,
  close: (projectId, listId) => `/rest/v1.1/projects/${projectId}/checklist/lists/${listId}/close`,
};

// SiteSnap's words for Procore's statuses: Pass = Conforming, Fail = Deficient, N/A = N/A
export const STATUS = { pass: "conforming", fail: "non_conforming", na: "not_applicable" };
const FROM_STATUS = { conforming: "pass", non_conforming: "fail", deficient: "fail", not_applicable: "na", neutral: "neutral" };
const FROM_OLD = { yes: "pass", no: "fail", "n/a": "na" }; // the older item.status
const TO_OLD = { pass: "yes", fail: "no", na: "n/a" };
const FROM_CORRESPONDING = { yes: "pass", no: "fail", "n/a": "na", none: "neutral", conforming: "pass", non_conforming: "fail", deficient: "fail", not_applicable: "na", neutral: "neutral" };

const text = (s, max = 2000) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const person = (u) => (u && u.id != null ? { id: String(u.id), name: text(u.name, 120) || text(u.login, 120).split("@")[0] || "Someone" } : null);
const day = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** What kind of answer an item takes: passfail (Pass / Fail / N/A), choice (the template's own options), text, number, date */
export function itemKind(item) {
  const c = `${item?.type?.category ?? item?.item_response?.item_type?.category ?? ""} ${item?.type?.name ?? ""}`.toLowerCase();
  if (/multiple|choice|select/.test(c) && customOptions(item).length) return "choice";
  if (/number|numeric/.test(c)) return "number";
  if (/date/.test(c)) return "date";
  if (/text|open/.test(c)) return "text";
  if (customOptions(item).length) return "choice";
  return "passfail";
}

// A template's own options (not the default Pass / Fail / N/A set), each with what it counts as
function customOptions(item) {
  const set = item?.response_set;
  const list = Array.isArray(set?.responses) ? set.responses : [];
  if (!list.length) return [];
  const opts = list.filter((r) => r?.id != null && r?.name).map((r) => ({ id: Number(r.id), label: text(r.name, 60), counts: FROM_CORRESPONDING[String(r.corresponding_status ?? "").toLowerCase()] ?? "neutral" }));
  // The default set: three options that are exactly conforming / deficient / N/A. Show SiteSnap's Pass / Fail / N/A for those.
  const kinds = opts.map((o) => o.counts).sort().join(",");
  if (opts.length === 3 && kinds === "fail,na,pass" && (set?.global || /default/i.test(String(set?.name ?? "")))) return [];
  return opts;
}

/** The item's current answer, or null: { counts: pass|fail|na|neutral, optionId, value, by, at } */
export function answerOf(item) {
  const r = item?.item_response;
  const p = r?.payload ?? {};
  const value = p.text_value ?? p.number_value ?? p.date_value ?? null;
  const optionId = p.response_option?.id ?? item?.response?.id ?? null;
  let counts = FROM_STATUS[String(r?.status ?? "").toLowerCase()] ?? null;
  if (!counts && item?.response?.corresponding_status) counts = FROM_CORRESPONDING[String(item.response.corresponding_status).toLowerCase()] ?? null;
  if (!counts) counts = FROM_OLD[String(item?.status ?? "").toLowerCase()] ?? null;
  if (!counts && value != null && value !== "") counts = "neutral";
  if (!counts) return null;
  return { counts, optionId: optionId == null ? null : Number(optionId), value: value == null ? null : String(value), by: person(r?.responder), at: r?.responded_at ?? null };
}

const sortByPosition = (list) => [...(Array.isArray(list) ? list : [])].sort((a, b) => (Number(a?.position) || 0) - (Number(b?.position) || 0) || (Number(a?.id) || 0) - (Number(b?.id) || 0));

/** One inspection with its sections and items, numbered the way Procore's web app shows them ("2.3"). */
export function inspectionDetail(raw) {
  const sections = sortByPosition(raw?.sections).map((s, si) => {
    const items = sortByPosition(s?.items).map((it, ii) => {
      const kind = itemKind(it);
      return {
        id: String(it.id),
        sectionId: String(s.id),
        number: `${si + 1}.${ii + 1}`,
        text: text(it.name, 1000) || "(No question text)",
        details: text(it.details, 2000),
        kind,
        options: kind === "choice" ? customOptions(it) : [],
        answer: answerOf(it),
        required: !!(it.required || it.response_required),
        photoRequired: !!(it.photo_required || it.attachment_required),
        noteRequired: !!(it.comment_required || it.note_required),
        photos: (Array.isArray(it.attachments) ? it.attachments.length : 0),
        notes: (Array.isArray(it.comments) ? it.comments : []).map((c) => text(c?.body ?? c?.comment, 500)).filter(Boolean).slice(0, 10),
        observations: (Array.isArray(it.observations) ? it.observations : []).map((o) => ({ id: String(o.id), number: o.number ?? null, title: text(o.title ?? o.name, 120), status: o.status ?? null })),
      };
    });
    // The sandbox's read has no not_applicable on sections (2026-10-16). Setting a section N/A answers every item in
    // it not_applicable (and turning it off clears them), so a section whose items are all N/A is shown as N/A.
    const allNa = items.length > 0 && items.every((i) => i.answer?.counts === "na");
    return { id: String(s.id), number: si + 1, name: text(s.name, 200) || `Section ${si + 1}`, position: Number(s.position) || si, na: typeof s.not_applicable === "boolean" ? s.not_applicable : allNa, naKnown: typeof s.not_applicable === "boolean", allNa, items };
  });
  return { ...inspectionSummary(raw), sections, ...countsOf(sections) };
}

/** Counts from the items themselves (Procore's two calls name their counts differently) */
export function countsOf(sections) {
  const c = { total: 0, answered: 0, pass: 0, fail: 0, na: 0, neutral: 0 };
  for (const s of sections ?? []) {
    for (const it of s.items ?? []) {
      c.total++;
      const a = it.answer?.counts;
      if (a) { c.answered++; c[a]++; } else if (s.na) { c.answered++; c.na++; }
    }
  }
  return { counts: c };
}

/** A row on the Inspections list */
export function inspectionSummary(raw) {
  const total = Number(raw?.item_count) || 0;
  const done = Number(raw?.inspected_item_count ?? (total - (Number(raw?.not_inspected_item_count) || 0))) || 0;
  const closed = /closed/i.test(String(raw?.status ?? ""));
  const status = closed ? "Complete" : /review/i.test(String(raw?.status ?? "")) ? "In review" : done > 0 ? "In progress" : "Open";
  const name = text(raw?.name, 200) || text(raw?.list_template_name, 200) || "Inspection";
  return {
    id: String(raw?.id),
    number: raw?.number ?? null,
    name,
    title: raw?.number != null && !new RegExp(`#\\s*${raw.number}\\b`).test(name) ? `${name} #${raw.number}` : name,
    status,
    closed,
    location: text(raw?.location?.node_name ?? raw?.location?.name, 200) || null,
    due: day(raw?.due_at),
    inspectionDate: day(raw?.inspection_date),
    progress: { done, total },
    inspectors: (Array.isArray(raw?.inspectors) ? raw.inspectors : []).map(person).filter(Boolean),
    responsibleContractor: raw?.responsible_contractor?.id != null ? { id: String(raw.responsible_contractor.id), name: text(raw.responsible_contractor.name, 200) } : null,
    trade: raw?.trade?.id != null ? { id: Number(raw.trade.id), name: text(raw.trade.name, 120) } : null,
    locationId: raw?.location?.id != null ? Number(raw.location.id) : null,
    pointOfContact: person(raw?.point_of_contact),
    description: text(raw?.description, 4000),
    phrasing: phrasingOf(raw),
    template: text(raw?.list_template_name, 200) || null,
  };
}

// Procore lets an inspection rename Conforming / Deficient (for example "At Risk")
function phrasingOf(raw) {
  const p = raw?.default_response_phrasing ?? raw?.response_set ?? {};
  const pass = text(p.conforming_response, 40);
  const fail = text(p.deficient_response ?? p.non_conforming_response, 40);
  return pass || fail ? { pass: pass || null, fail: fail || null } : null;
}

/** The three groups on the list: assigned to me, my company's work, the rest that's open */
export function groupInspections(rows, { myId, myCompanyId }) {
  const mine = [];
  const company = [];
  const open = [];
  for (const r of rows) {
    if (r.inspectors.some((p) => p.id === String(myId))) mine.push(r);
    else if (myCompanyId && r.responsibleContractor?.id === String(myCompanyId)) company.push(r);
    else if (!r.closed) open.push(r);
  }
  // My company's work includes ones I'm also assigned to, so the tab is complete on its own
  for (const r of mine) if (myCompanyId && r.responsibleContractor?.id === String(myCompanyId)) company.push(r);
  const order = (a, b) => Number(a.closed) - Number(b.closed) || String(a.due ?? "9999").localeCompare(String(b.due ?? "9999")) || (Number(a.number) || 0) - (Number(b.number) || 0);
  return { mine: mine.sort(order), company: company.sort(order), open: open.sort(order) };
}

/**
 * The request that saves an answer. answer: { counts: pass|fail|na } for Pass / Fail / N/A items, { optionId } for
 * the template's own options, { value } for text / number / date. Only the field for the item's kind is sent.
 */
export function responseBody(item, answer) {
  if (item.kind === "choice") {
    const opt = item.options.find((o) => o.id === Number(answer?.optionId));
    if (!opt) throw new Error("Pick one of the answers.");
    return { item_response: { response_option_id: opt.id } };
  }
  if (item.kind === "text") {
    const v = text(answer?.value, 4000);
    if (!v) throw new Error("Type an answer.");
    return { item_response: { text_value: v } };
  }
  if (item.kind === "number") {
    const n = Number(String(answer?.value ?? "").replace(/,/g, ""));
    if (answer?.value == null || String(answer.value).trim() === "" || !Number.isFinite(n)) throw new Error("Type a number.");
    return { item_response: { number_value: n } };
  }
  if (item.kind === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(answer?.value ?? ""))) throw new Error("Pick a date.");
    return { item_response: { date_value: String(answer.value) } };
  }
  const status = STATUS[answer?.counts];
  if (!status) throw new Error("Pick Pass, Fail or N/A.");
  return { item_response: { status } };
}

/** The older way to answer (used only when item_response isn't there): PATCH the item's yes / no / n/a */
export function oldAnswerBody(item, answer, projectId) {
  const counts = item.kind === "choice" ? item.options.find((o) => o.id === Number(answer?.optionId))?.counts : answer?.counts;
  const status = TO_OLD[counts];
  if (!status) return null;
  return { project_id: Number(projectId), section_id: Number(item.sectionId), item: { status, ...(item.kind === "choice" ? { response_id: Number(answer.optionId) } : {}) } };
}

/** What an answer counts as (pass / fail / na / neutral) */
export function countsFor(item, answer) {
  if (item.kind === "choice") return item.options.find((o) => o.id === Number(answer?.optionId))?.counts ?? null;
  if (item.kind === "passfail") return STATUS[answer?.counts] ? answer.counts : null;
  return answer?.value != null && String(answer.value).trim() !== "" ? "neutral" : null;
}

/** Is this the same answer as what's in Procore now? */
export function sameAnswer(item, current, answer) {
  if (!current) return false;
  if (item.kind === "choice") return current.optionId === Number(answer?.optionId);
  if (item.kind === "passfail") return current.counts === answer?.counts;
  return String(current.value ?? "") === String(answer?.value ?? "").trim();
}

/** Find an item (and its section) in a read inspection */
export function findItem(detail, itemId) {
  for (const s of detail.sections) {
    const it = s.items.find((i) => i.id === String(itemId));
    if (it) return { section: s, item: it };
  }
  return null;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The lines added to a failed item's Observation description: which inspection, which item, where, who's responsible */
export function failContextHtml({ inspection, item, contractor }) {
  const parts = [
    `<p>Failed inspection item ${esc(item.number)}: ${esc(item.text)}</p>`,
    `<p>Inspection: ${esc(inspection.title)}${inspection.location ? ` · ${esc(inspection.location)}` : ""}</p>`,
  ];
  if (contractor?.name) parts.push(`<p>Responsible contractor: ${esc(contractor.name)}</p>`);
  return parts.join("");
}

/** Plain-language message for a Procore refusal on an inspection. Never a raw code. */
export function friendlyRefusal(r, doing = "save that") {
  if (r.status === 401) return { status: 401, code: "not_connected", message: "Sign in to Procore again." };
  if (r.status === 403) return { status: 403, code: "no_permission", message: `Your Procore role can't ${doing} on this inspection. Ask your project manager for access.` };
  if (r.status === 404) return { status: 404, code: "gone", message: "This inspection isn't in Procore anymore, or it was changed. Go back and open it again." };
  if (r.status === 429) return { status: 429, code: "busy", message: "Procore is busy. Trying again in a moment." };
  if (r.status === 422) return { status: 422, code: "refused", message: `Procore didn't accept that. ${doing === "close it" ? "It may still have items to answer." : "Check the answer and try again."}` };
  return { status: 502, code: "procore_failed", message: "Procore didn't answer. Your answer is kept on this phone and will be sent again." };
}
