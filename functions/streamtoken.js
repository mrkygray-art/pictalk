// getDeepgramStreamToken: gives a signed-in phone a short-lived Deepgram token so it can
// open a live transcription connection directly. The real Deepgram key stays here.
// Deepgram's /v1/auth/grant needs a key with Member (or higher) permission; the token
// only has to be valid while the connection opens (default 30 s).
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { DEEPGRAM_API_KEY, KEYTERMS, MODEL } = require("./deepgram");
const { piccoloCallable } = require("./budget");

const PER_HOUR_LIMIT = 60; // each Continue opens a new connection

exports.getDeepgramStreamToken = onCall(piccoloCallable({ secrets: [DEEPGRAM_API_KEY], timeoutSeconds: 30 }), async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in is required.");

  // Basic abuse protection: tokens per account per hour (function-only counter)
  const hour = new Date().toISOString().slice(0, 13);
  const usageRef = getFirestore().doc(`users/${uid}/streamUsage/${hour}`);
  await getFirestore().runTransaction(async (tx) => {
    const count = (await tx.get(usageRef)).get("count") || 0;
    if (count >= PER_HOUR_LIMIT) {
      throw new HttpsError("resource-exhausted", "Live transcription is resting for a bit. Your recording still works.");
    }
    tx.set(usageRef, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  const settings = { model: MODEL, keyterms: KEYTERMS };

  // Emulator-only stand-in: the app plays a pretend live transcript (no Deepgram, no cost)
  if (process.env.FUNCTIONS_EMULATOR === "true" && process.env.PICTALK_FAKE_STT === "1") {
    return { token: "emulator", fake: true, ...settings };
  }

  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY.value()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }),
  });
  if (!res.ok) {
    logger.error("Deepgram token grant failed", { uid, status: res.status, body: (await res.text()).slice(0, 300) });
    throw new HttpsError("unavailable", "Live transcription isn't available right now. Your recording still works.");
  }
  const { access_token: token } = await res.json();
  return { token, ...settings };
});
