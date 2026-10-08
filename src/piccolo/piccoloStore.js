// Piccolo drafts for a job. The draftPiccolo function writes versioned drafts to
// users/{uid}/jobs/{jobId}/drafts and, for the first one, the editable copy at working/current.
// The app reads both and copies a newer draft into working/current only when the user says so.
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { stopText, photoText } from "../stopStore";

const jobDoc = (uid, jobId) => ["users", uid, "jobs", jobId];

/** The newest draft for a job, or null. */
export function watchLatestDraft(uid, jobId, callback) {
  return onSnapshot(
    query(collection(db, ...jobDoc(uid, jobId), "drafts"), orderBy("version", "desc"), limit(1)),
    (snap) => callback(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }),
    (err) => {
      console.warn("Watching Piccolo drafts failed:", err);
      callback(null);
    }
  );
}

/** The user's editable copy, or null before the first draft. */
export function watchWorking(uid, jobId, callback) {
  return onSnapshot(
    doc(db, ...jobDoc(uid, jobId), "working", "current"),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err) => {
      console.warn("Watching Piccolo working copy failed:", err);
      callback(null);
    }
  );
}

/** Replace the editable copy with a draft (the user chose "Use this draft"). Works offline. */
export function applyDraft(uid, jobId, draft, existing) {
  const now = Date.now();
  return setDoc(doc(db, ...jobDoc(uid, jobId), "working", "current"), {
    draftId: draft.id,
    draftVersion: draft.version,
    workOrder: draft.workOrder,
    bom: draft.bom,
    quote: draft.quote,
    questions: draft.questions,
    editedBy: uid,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

const draft = httpsCallable(functions, "draftPiccolo", { timeout: 310000 });

/** Ask the server for a new draft. Throws an Error with a friendly message. */
export async function requestDraft(jobId) {
  if (!navigator.onLine) throw new Error("Drafting needs signal. Try again when you're online.");
  try {
    return (await draft({ jobId })).data;
  } catch (err) {
    const code = String(err?.code || "").replace("functions/", "");
    const message = String(err.message || "").replace(/\s*[[(][^\])]*[\])]\s*$/, "");
    if (["resource-exhausted", "failed-precondition", "not-found"].includes(code)) throw new Error(message, { cause: err });
    if (code === "unavailable" || code === "deadline-exceeded") {
      throw new Error("The draft took too long or the connection dropped. Please try again.", { cause: err });
    }
    console.error("Piccolo draft failed:", err);
    throw new Error("The draft couldn't be built right now. Please try again.", { cause: err });
  }
}

/**
 * Has the capture changed since this draft was made? Compares the same things the
 * function recorded in sourceSnapshot: stop words, photo descriptions, photos, and wrap-up
 * notes. The AI summary isn't capture (it's a digest of the same notes, and often finishes
 * just after a draft started from End Job), so it doesn't count.
 */
export function captureChangedSince(draft, { stops, notes }) {
  const snap = draft?.sourceSnapshot;
  if (!snap) return false;
  const now = Object.fromEntries(stops.map((s) => [s.id, `${stopText(s)}|${photoText(s)}|${s.photoPath || ""}`]));
  const ids = Object.keys(now);
  const before = snap.stopsUsed || {};
  if (ids.length !== Object.keys(before).length || ids.some((id) => before[id] !== now[id])) return true;
  const text = (v) => (v || "").trim() || null;
  return text(notes.field?.text) !== (snap.fieldNotes ?? null) || text(notes.customer?.text) !== (snap.customerNotes ?? null);
}

// ---------- money ----------
export const money = (n) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—";

/** Quote totals from the priced lines; unpriced lines are counted so the UI can say "needs price". */
export function quoteTotals(bom, quote = {}) {
  let subtotal = 0;
  let unpriced = 0;
  for (const ln of bom || []) {
    if (Number.isFinite(ln.unitPrice)) subtotal += ln.unitPrice * (Number(ln.qty) || 0);
    else unpriced += 1;
  }
  // Nothing priced yet: show dashes, not a $0.00 that looks like a real total
  if (unpriced === (bom || []).length) return { subtotal: NaN, markup: NaN, tax: NaN, total: NaN, unpriced };
  const markup = (subtotal * (Number(quote.markupPct) || 0)) / 100;
  const tax = ((subtotal + markup) * (Number(quote.taxPct) || 0)) / 100;
  return { subtotal, markup, tax, total: subtotal + markup + tax, unpriced };
}
