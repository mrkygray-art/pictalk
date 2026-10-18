// One Report capture = at most one Procore record (full-loop demo spec, step D: idempotent, plus the mapping
// row). The phone's capture id (ReportFlow's thread id, sent as card.captureId) is the key:
//   procoreProjects/{companyId}_{projectId}/recordCaptures/{captureId}   (server only: no client rule matches)
//     state "creating" (a lock, while Procore is asked) → "done" with the answer, or removed if it failed
//     siteSnapItemId, procoreProjectId, procoreObservationId (or procoreRecordId), recordType, number, url,
//     createdByActor (Procore user id), createdAt, demoTag (title starts with [SS-DEMO])
// A double tap or a network retry with the same id gets the first answer back; a second request while the first
// is still running is told to wait. A lock older than LOCK_MS (the first request died) can be taken again.
// The classification log for the Evaluation Lab (spec step B) is next to it:
//   procoreProjects/{key}/classifications/{captureId}: runs[] (written by classifyCapture), then final
//   (what was sent), edits (fields changed from the AI's last run), record, sentAt (written here).
// No Firestore (FIREBASE_SERVICE_ACCOUNT_B64 missing): records are still created, without either.
import { HttpError } from "./_procore.js";
import { firestore } from "./_firestore.js";

export const LOCK_MS = 2 * 60 * 1000;
const EDIT_FIELDS = ["recordType", "title", "description", "observationTypeId", "tradeId", "locationText", "priority", "assigneeIds", "dueDate"];

// The card's fields as the log keeps them (the [SS-DEMO] tag left out of the title, assignees sorted)
const tagless = (t) => String(t ?? "").replace(/^\[SS-DEMO\]\s*/, "").trim();
export function cardFields(c = {}) {
  const ids = (l) => [...new Set((Array.isArray(l) ? l : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const text = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || null;
  return {
    recordType: c.recordType ?? null, title: text(tagless(c.title), 80), description: text(c.description, 2000),
    observationTypeId: Number(c.observationTypeId) || null, tradeId: Number(c.tradeId) || null,
    locationText: text(c.locationText ?? c.whereText, 120), priority: c.priority ?? null,
    assigneeIds: ids(c.assigneeIds), dueDate: c.dueDate || null,
  };
}

async function refs(key, captureId) {
  try {
    const db = await firestore();
    const p = db.collection("procoreProjects").doc(key);
    return { db, capture: p.collection("recordCaptures").doc(captureId), log: p.collection("classifications").doc(captureId) };
  } catch (err) {
    console.log("SiteSnap records: no capture log", err.message);
    return null;
  }
}

/**
 * Before creating: { repeat: answer } when this capture already made its record, else { ref } holding the lock
 * (null ref = no Firestore, go ahead without). Throws 409 while another request for it is still running.
 */
export async function claimCapture(key, captureId, actor, now = Date.now()) {
  if (!captureId) return { ref: null };
  const r = await refs(key, captureId);
  if (!r) return { ref: null };
  const got = await r.db.runTransaction(async (tx) => {
    const snap = await tx.get(r.capture);
    const d = snap.exists ? snap.data() : null;
    if (d?.state === "done") return { repeat: d.answer };
    if (d?.state === "creating" && now - Number(d.at) < LOCK_MS) return { busy: true };
    tx.set(r.capture, { state: "creating", at: now, siteSnapItemId: captureId, createdByActor: actor ?? null });
    return { mine: true };
  });
  if (got.busy) throw new HttpError(409, "already_sending", "This one is already being sent. Give it a moment.");
  return got.repeat ? { repeat: got.repeat } : { ref: r };
}

/** After Procore created it: the mapping row (and the lock becomes "done"), then the classification log's end. */
export async function finishCapture(r, { projectId, answer, actor, demoTag, card, proposed = null }, now = Date.now()) {
  if (!r) return;
  try {
    await r.capture.set({
      state: "done", at: now, siteSnapItemId: r.capture.id, procoreProjectId: String(projectId),
      ...(answer.recordType === "observation" ? { procoreObservationId: String(answer.id) } : { procoreRecordId: String(answer.id) }),
      recordType: answer.recordType, number: answer.number ?? null, url: answer.url ?? null,
      createdByActor: actor ?? null, createdAt: now, demoTag: !!demoTag, answer,
    });
  } catch (err) {
    console.error("SiteSnap records: mapping row not saved", err?.code ?? err?.name ?? "Error");
  }
  try {
    const final = cardFields(card);
    const first = proposed ? cardFields(proposed) : null;
    const edits = first ? EDIT_FIELDS.filter((k) => JSON.stringify(first[k]) !== JSON.stringify(final[k])) : null;
    await r.log.set({ proposed: first, final, edits, record: { recordType: answer.recordType, id: String(answer.id), number: answer.number ?? null }, sentAt: now }, { merge: true });
  } catch (err) {
    console.error("SiteSnap records: classification log not saved", err?.code ?? err?.name ?? "Error");
  }
}

/** Procore refused or the call failed: let a retry try again straight away. */
export async function releaseCapture(r) {
  if (!r) return;
  try { await r.capture.delete(); } catch { /* the lock times out by itself */ }
}
