// Learning from edits (Phase 7). When a job is finalized, compare the AI's original draft
// with what was finalized (lines kept, changed, removed, added) and remember the finalized
// lines: wording, part number, unit, and price. New drafts get these as examples, and a
// matching line reuses its past part number and price ("history"), so a parts list builds up
// from real quotes without a setup screen.
//
// Kept per company (learning/org_{orgId}) or per personal account (learning/user_{uid}),
// never mixed. Function-only; a company's admin can read and clear theirs. A company can
// turn it off (defaults.learnFromEdits === false): nothing is remembered or used.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { piccoloCallable } = require("./budget");

const MAX_LEARNED = 80; // remembered lines per company or account
const MAX_EXAMPLES = 40; // sent with each draft
const MAX_LIST = 50;
const CONTENT = ["description", "qty", "unit", "partNumber", "category"];
const FIELDS = [...CONTENT, "unitPrice", "location", "notes"];

const db = () => getFirestore();
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const squash = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const same = (a, b) => (a ?? null) === (b ?? null) || (typeof a === "string" && typeof b === "string" && a.trim() === b.trim());

/** Where a job's learning lives: its company's, else its owner's. */
const learningKey = (orgId, ownerUid) => (orgId ? `org_${orgId}` : `user_${ownerUid}`);
const learningOn = (orgId, defaults) => !orgId || defaults?.learnFromEdits !== false;

/**
 * What changed between the AI's draft and the final. Lines are matched by id (edits keep it).
 * "Kept" means the line's content (description, qty, unit, part number, category) is unchanged;
 * filling in a price is counted separately, since drafts usually leave prices blank.
 */
function diffDraft(original, final) {
  const before = original?.bom || [];
  const after = final?.bom || [];
  const byId = new Map(before.map((l) => [l.id, l]));
  const afterIds = new Set(after.map((l) => l.id));
  const changedFields = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const changes = [];
  let kept = 0;
  let pricesFilled = 0;
  for (const l of after) {
    const o = byId.get(l.id);
    if (!o) continue;
    const fields = FIELDS.filter((f) => !same(o[f], l[f]));
    for (const f of fields) changedFields[f]++;
    if (!Number.isFinite(o.unitPrice) && Number.isFinite(l.unitPrice)) pricesFilled++;
    if (fields.some((f) => CONTENT.includes(f))) changes.push({ description: l.description, was: o.description, fields });
    else kept++;
  }
  const removed = before.filter((l) => !afterIds.has(l.id)).map((l) => l.description);
  const added = after.filter((l) => !byId.has(l.id)).map((l) => l.description);
  const questions = final?.questions || [];
  return {
    linesDrafted: before.length,
    linesKept: kept,
    linesChanged: changes.length,
    linesRemoved: removed.length,
    linesAdded: added.length,
    pricesFilled,
    changedFields,
    changes: changes.slice(0, MAX_LIST),
    removed: removed.slice(0, MAX_LIST),
    added: added.slice(0, MAX_LIST),
    scopeEdited: !same(original?.workOrder?.scope, final?.workOrder?.scope),
    questionsAnswered: questions.filter((q) => q.answered).length,
    questionsTotal: questions.length,
  };
}

/** A final's lines as remembered lines. AI price estimates nobody confirmed aren't kept. */
function toLearned(bom, at) {
  return (bom || [])
    .filter((l) => norm(l.description))
    .map((l) => ({
      description: String(l.description).slice(0, 200),
      partNumber: String(l.partNumber || "").slice(0, 60),
      unit: String(l.unit || "ea").slice(0, 20),
      category: l.category || "misc",
      unitPrice: Number.isFinite(l.unitPrice) && l.priceSource !== "ai_estimate" ? l.unitPrice : null,
      at,
    }));
}

const sameItem = (a, b) => (a.partNumber && b.partNumber ? squash(a.partNumber) === squash(b.partNumber) : norm(a.description) === norm(b.description));

/** Newest first, one entry per item (same part number, or same wording when there's none). */
function mergeLearned(existing, incoming) {
  const out = [];
  for (const l of [...incoming, ...(existing || [])]) {
    if (!out.some((o) => sameItem(o, l))) out.push(l);
  }
  return out.slice(0, MAX_LEARNED);
}

/** The remembered line a drafted line matches: same part number, else the same wording. */
function findLearned(learned, partNumber, description) {
  if (!learned?.length) return null;
  const p = squash(partNumber);
  if (p.length >= 3) {
    const hit = learned.find((l) => squash(l.partNumber) === p);
    if (hit) return hit;
  }
  const d = norm(description);
  return d ? learned.find((l) => norm(l.description) === d) || null : null;
}

/** Remembered lines for a draft, or [] when learning is off. */
async function learnedFor(orgId, ownerUid, defaults) {
  if (!learningOn(orgId, defaults)) return [];
  const doc = (await db().doc(`learning/${learningKey(orgId, ownerUid)}`).get()).data();
  return (doc?.lines || []).slice(0, MAX_EXAMPLES);
}

/** After a final is saved: add its lines and edit counts. Demo jobs and opted-out companies are skipped. */
async function learnFromFinal({ orgId, ownerUid, job, defaults, bom, diff, at }) {
  if (job?.isDemo || !learningOn(orgId, defaults)) return false;
  const ref = db().doc(`learning/${learningKey(orgId, ownerUid)}`);
  await db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() || {};
    const s = cur.stats || {};
    const add = (k) => (s[k] || 0) + (diff?.[k] || 0);
    tx.set(ref, {
      orgId: orgId || null,
      uid: orgId ? null : ownerUid,
      lines: mergeLearned(cur.lines, toLearned(bom, at)),
      stats: {
        finals: (s.finals || 0) + 1,
        withDraft: (s.withDraft || 0) + (diff ? 1 : 0),
        linesDrafted: add("linesDrafted"),
        linesKept: add("linesKept"),
        linesChanged: add("linesChanged"),
        linesRemoved: add("linesRemoved"),
        linesAdded: add("linesAdded"),
        pricesFilled: add("pricesFilled"),
      },
      updatedAt: at,
    });
  });
  return true;
}

exports.diffDraft = diffDraft;
exports.mergeLearned = mergeLearned;
exports.findLearned = findLearned;
exports.learnedFor = learnedFor;
exports.learnFromFinal = learnFromFinal;
exports.learningKey = learningKey;

/** Forget the company's remembered lines and counts. Admins only. */
exports.clearLearning = onCall(piccoloCallable({ timeoutSeconds: 30 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");
  const p = (await db().doc(`users/${uid}`).get()).data();
  if (!p?.orgId || p.status !== "active" || p.tier !== "team" || p.role !== "admin") {
    throw new HttpsError("permission-denied", "Only your company's admin can do that.");
  }
  const ref = db().doc(`learning/${learningKey(p.orgId)}`);
  const had = ((await ref.get()).get("lines") || []).length;
  await ref.delete();
  await db().collection("auditLog").add({ uid, orgId: p.orgId, action: "learning.clear", after: { lines: had }, at: Date.now() });
  logger.info("Piccolo learning cleared", { uid, orgId: p.orgId, lines: had });
  return { cleared: had };
});
