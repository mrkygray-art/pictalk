// Building the Procore record from the confirmed card (Step 3 of SPEC_voice-photo-to-procore-record).
// Plain functions, so tests can check exactly what Procore receives. Field names and values are from
// Procore's reference and the sandbox test (docs/PROCORE_API_NOTES.md):
//   Observation: POST /rest/v1.0/observations/items  { project_id, observation: {...} }  (name + type_id required)
//   Punch Item:  POST /rest/v1.1/punch_items          { project_id, punch_item: {...} }   (name required)
// Every record: not private (the project defaults to private), the description as HTML paragraphs
// (plain line breaks collapse), "Reported by {name} via SiteSnap AI", and the transcript untouched.
export const RECORD_TYPES = ["observation", "punch_item"];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) ? String(s) : null);

/** The card, cleaned: only known keys, sizes capped, ids as numbers. Throws a plain message when unusable. */
export function cleanCard(c = {}) {
  const recordType = RECORD_TYPES.includes(c.recordType) ? c.recordType : null;
  if (!recordType) throw new Error("Pick Observation or Punch Item.");
  const title = text(c.title, 80);
  if (!title) throw new Error("Add a short title.");
  const typeId = Number(c.observationTypeId) || null;
  if (recordType === "observation" && !typeId) throw new Error("Pick what kind of observation it is.");
  return {
    recordType,
    title,
    description: text(c.description, 2000),
    transcript: String(c.transcript ?? "").trim().slice(0, 8000),
    observationTypeId: typeId,
    tradeId: Number(c.tradeId) || null,
    locationId: Number(c.locationId) || null,
    locationText: text(c.locationText, 120) || null,
    priority: ["low", "medium", "high"].includes(c.priority) ? c.priority : null,
    assigneeIds: ids(c.assigneeIds).slice(0, 10),
    dueDate: isoDate(c.dueDate),
    impactMentioned: !!c.impactMentioned,
    captureId: /^[A-Za-z0-9_-]{1,64}$/.test(String(c.captureId ?? "")) ? String(c.captureId) : null,
  };
}

/** The record's description: summary, who reported it, the words as said, and where it came from. */
export function descriptionHtml(card, reporterName, link) {
  const parts = [];
  if (card.description) parts.push(`<p>${esc(card.description)}</p>`);
  // Where, in words, when Procore wouldn't let this person add it as a new location
  if (card.whereText) parts.push(`<p>Where: ${esc(card.whereText)}</p>`);
  parts.push(`<p>Reported by ${esc(reporterName || "a SiteSnap user")} via SiteSnap AI.</p>`);
  if (card.transcript) parts.push(`<p>What was said: "${esc(card.transcript)}"</p>`);
  if (link) parts.push(`<p><a href="${esc(link)}">Open in SiteSnap AI</a></p>`);
  return parts.join("");
}

const location = (card) => (card.locationId ? { location_id: card.locationId } : card.locationText ? { mt_location: [card.locationText] } : {});

export function observationBody(card, projectId, { reporterName, uploadIds = [], link } = {}) {
  return {
    project_id: Number(projectId),
    observation: {
      name: card.title,
      type_id: card.observationTypeId,
      description: descriptionHtml(card, reporterName, link),
      status: "initiated",
      personal: false,
      ...(card.priority ? { priority: card.priority[0].toUpperCase() + card.priority.slice(1) } : {}), // Low / Medium / High
      ...(card.tradeId ? { trade_id: card.tradeId } : {}),
      ...location(card),
      ...(card.dueDate ? { due_date: card.dueDate } : {}),
      ...(card.assigneeIds.length ? { assignee_ids: card.assigneeIds } : {}),
      ...(uploadIds.length ? { upload_ids: uploadIds } : {}),
    },
  };
}

export function punchBody(card, projectId, { reporterName, uploadIds = [], link } = {}) {
  return {
    project_id: Number(projectId),
    punch_item: {
      name: card.title,
      description: descriptionHtml(card, reporterName, link),
      private: false,
      reference: `Reported by ${reporterName || "a SiteSnap user"} via SiteSnap AI`.slice(0, 255),
      ...(card.priority ? { priority: card.priority } : {}),
      ...(card.tradeId ? { trade_id: card.tradeId } : {}),
      ...location(card),
      ...(card.dueDate ? { due: card.dueDate } : {}),
      ...(card.assigneeIds.length ? { login_information_ids: card.assigneeIds } : {}),
      ...(card.impactMentioned ? { cost_impact: "yes_unknown", schedule_impact: "yes_unknown" } : {}),
      ...(uploadIds.length ? { upload_ids: uploadIds } : {}),
    },
  };
}

/** Procore's own page for the record (the address pattern Procore's web app uses). */
export function recordUrl(apiUrl, projectId, recordType, id) {
  const web = String(apiUrl).replace(/\/+$/, "");
  return recordType === "observation" ? `${web}/${projectId}/project/observations/items/${id}` : `${web}/${projectId}/project/punch_list/${id}`;
}

/** The email Procore sends to the assignee (decision C: the assignee only). */
export function assigneeEmail(card, reporterName, number) {
  const kind = card.recordType === "observation" ? "Observation" : "Punch Item";
  return {
    subject: `${kind}${number ? ` #${number}` : ""}: ${card.title}`.slice(0, 200),
    body: `${reporterName || "Someone"} sent you this from the field with SiteSnap AI.\n\n${card.description || card.title}`.slice(0, 2000),
    distribution_ids: card.assigneeIds,
  };
}
