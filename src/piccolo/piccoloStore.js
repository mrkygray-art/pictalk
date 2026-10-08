// Piccolo drafts for a job. The draftPiccolo function writes versioned drafts to
// users/{uid}/jobs/{jobId}/drafts and, for the first one, the editable copy at working/current.
// The app reads both and copies a newer draft into working/current only when the user says so.
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
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

/** The parts of a draft that become the editable copy ("Use Draft n"). */
export const draftToWorking = (draft) => ({
  draftId: draft.id,
  draftVersion: draft.version,
  reviewedDraftVersion: draft.version,
  workOrder: draft.workOrder,
  bom: draft.bom,
  quote: draft.quote,
  questions: draft.questions,
});

const WORKING_KEYS = ["draftId", "draftVersion", "reviewedDraftVersion", "workOrder", "bom", "quote", "questions", "editedBy", "createdAt", "updatedAt"];

/** Save the editable copy (only the fields the rules allow). Works offline (syncs later). */
export function saveWorking(uid, jobId, data) {
  const out = Object.fromEntries(WORKING_KEYS.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]));
  return setDoc(doc(db, ...jobDoc(uid, jobId), "working", "current"), out);
}

/** First edit after a draft: the job shows "Being edited". */
export function markEditing(uid, jobId) {
  return updateDoc(doc(db, ...jobDoc(uid, jobId)), { piccoloStatus: "editing" }).catch((err) =>
    console.warn("Marking job as being edited failed:", err)
  );
}

// ---------- lines ----------
export const newId = () => crypto.randomUUID();

/** A blank line the user adds (no AI source). */
export const blankLine = (category = "equipment") => ({
  id: newId(),
  description: "",
  qty: 1,
  unit: category === "labor" ? "hr" : "ea",
  partNumber: "",
  partNumberStatus: "none",
  unitCost: null,
  unitPrice: null,
  priceSource: "none",
  location: "",
  notes: "",
  source: { stopIds: [], basis: "user", quote: "" },
  category,
  checked: true,
  sortOrder: 0,
});

/** Renumber sortOrder after adding, removing, or moving lines. */
export const renumber = (lines) => lines.map((l, i) => ({ ...l, sortOrder: i }));

const squash = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const lineKey = (l) => `${squash(l.description)}|${squash(l.location)}`;

/**
 * What a newer draft has that the user's copy doesn't (and the reverse), matched by
 * description + location. Used by the compare sheet to merge line by line.
 */
export function compareDraft(mine, draft) {
  const mineKeys = new Map((mine.bom || []).map((l) => [lineKey(l), l]));
  const theirKeys = new Map((draft.bom || []).map((l) => [lineKey(l), l]));
  const added = (draft.bom || []).filter((l) => !mineKeys.has(lineKey(l)));
  const changed = (draft.bom || []).filter((l) => {
    const m = mineKeys.get(lineKey(l));
    return m && (m.qty !== l.qty || squash(m.partNumber) !== squash(l.partNumber));
  });
  const missing = (mine.bom || []).filter((l) => l.source?.basis !== "user" && !theirKeys.has(lineKey(l)));
  const myQuestions = new Set((mine.questions || []).map((q) => squash(q.text)));
  const questions = (draft.questions || []).filter((q) => !myQuestions.has(squash(q.text)));
  return { added, changed, missing, questions };
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

// ---------- finalize ----------
const WARNING_TEXT = {
  unpriced: (n) => `${n} line${n === 1 ? " has" : "s have"} no price`,
  verify: (n) => `${n} part number${n === 1 ? " is" : "s are"} marked Verify`,
  estimate: (n) => `${n} price${n === 1 ? " is an AI estimate" : "s are AI estimates"}`,
  inferred: (n) => `${n} inferred line${n === 1 ? " hasn't" : "s haven't"} been checked`,
  questions: (n) => `${n} open question${n === 1 ? " isn't" : "s aren't"} answered`,
};

/** Things to double-check before finalizing (same rules as functions/finalize.js). */
export function finalizeWarnings(working) {
  const bom = working?.bom || [];
  const count = (fn) => bom.filter(fn).length;
  const list = [
    ["unpriced", count((l) => !Number.isFinite(l.unitPrice))],
    ["verify", count((l) => l.partNumberStatus === "ai_suggested")],
    ["estimate", count((l) => l.priceSource === "ai_estimate")],
    ["inferred", count((l) => l.source?.basis === "inferred" && !l.checked)],
    ["questions", (working?.questions || []).filter((q) => !q.answered).length],
  ];
  return list.filter(([, n]) => n > 0).map(([kind, n]) => ({ kind, count: n, text: WARNING_TEXT[kind](n) }));
}

/** Finalized versions of a job, newest first. */
export function watchFinals(uid, jobId, callback) {
  return onSnapshot(
    query(collection(db, ...jobDoc(uid, jobId), "finals"), orderBy("version", "desc")),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn("Watching Piccolo finals failed:", err);
      callback([]);
    }
  );
}

const finalize = httpsCallable(functions, "finalizePiccolo", { timeout: 310000 });
const mediaLinks = httpsCallable(functions, "piccoloMediaLinks", { timeout: 70000 });

/** Save the current version as the next final (v1, v2, …). Throws an Error with a friendly message. */
export async function requestFinalize(jobId) {
  if (!navigator.onLine) throw new Error("Finalizing needs signal, so the photos and audio can be saved with it.");
  try {
    return (await finalize({ jobId, acknowledged: true })).data;
  } catch (err) {
    const code = String(err?.code || "").replace("functions/", "");
    const message = String(err.message || "").replace(/\s*[[(][^\])]*[\])]\s*$/, "");
    if (["permission-denied", "failed-precondition", "not-found"].includes(code)) throw new Error(message, { cause: err });
    console.error("Finalize failed:", err);
    throw new Error("Couldn't finalize right now. Please try again.", { cause: err });
  }
}

/** Signed, expiring links to a final's media (empty when the server can't sign them). */
export async function finalMediaLinks(jobId, versionId) {
  try {
    return (await mediaLinks({ jobId, versionId })).data;
  } catch (err) {
    console.warn("Media links failed:", err);
    return { links: {}, expiresAt: null };
  }
}
