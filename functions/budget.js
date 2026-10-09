// Cost guardrails shared by the AI functions.
// - A global daily cap on AI calls (all users together), so an open demo can't run up an
//   unbounded bill. Counted in usage/global/days/{yyyy-mm-dd} (function-only). Hitting it
//   logs an error with alert: "ai-daily-cap" (set a Cloud Logging alert on that).
// - Piccolo callables enforce App Check when PICCOLO_ENFORCE_APP_CHECK=1 (set it in the
//   real project once the app has an App Check site key; the emulator never enforces).
const { HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const DAILY_CAP = Number(process.env.GLOBAL_AI_DAILY_CAP) || 1000;

const today = () => new Date().toISOString().slice(0, 10);
const globalRef = () => getFirestore().doc(`usage/global/days/${today()}`);

/**
 * Count one AI call against today's global cap, or refuse. kind is for the breakdown
 * ("draft", "summary", "photo").
 */
async function reserveGlobalAi(kind) {
  const ref = globalRef();
  await getFirestore().runTransaction(async (tx) => {
    const count = (await tx.get(ref)).get("count") || 0;
    if (count >= DAILY_CAP) {
      logger.error("Global AI daily cap reached", { alert: "ai-daily-cap", cap: DAILY_CAP, kind });
      throw new HttpsError("resource-exhausted", "PicTalk's AI has reached its limit for today. Please try again tomorrow.");
    }
    tx.set(ref, { count: count + 1, [kind]: FieldValue.increment(1), updatedAt: Date.now() }, { merge: true });
  });
}

/** Options for Piccolo's callable functions. */
const piccoloCallable = (opts = {}) => ({
  ...opts,
  enforceAppCheck: process.env.PICCOLO_ENFORCE_APP_CHECK === "1" && process.env.FUNCTIONS_EMULATOR !== "true",
});

module.exports = { reserveGlobalAi, piccoloCallable, DAILY_CAP };
