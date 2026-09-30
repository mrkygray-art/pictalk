const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

initializeApp();
setGlobalOptions({ region: "us-west2", maxInstances: 10 });

const DEEPGRAM_API_KEY = defineSecret("DEEPGRAM_API_KEY");

// AI summary and action items for a finished job (callable from the app)
exports.generateJobSummary = require("./summary").generateJobSummary;

exports.transcribeStop = onDocumentCreated(
  {
    document: "users/{uid}/stops/{stopId}",
    secrets: [DEEPGRAM_API_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const stop = snap.data();
    const { uid, stopId } = event.params;

    if (!stop.audioPath) {
      logger.info("No audio on this stop, skipping", { uid, stopId });
      return;
    }

    const docRef = snap.ref;
    await docRef.update({ status: "transcribing" });

    try {
      // Pull the recording out of Storage
      const [audio] = await getStorage().bucket().file(stop.audioPath).download();

      // Send it to Deepgram
           const params = new URLSearchParams({ model: "nova-3", smart_format: "true" });
      const KEYTERMS = [
        "Verkada", "Avigilon", "Axis", "Hanwha", "Genetec", "Milestone",
        "Brivo", "Openpath", "Lenel", "HID", "Aiphone", "Ubiquiti", "Meraki",
        "Cat6", "IDF", "MDF", "PoE", "PoE switch", "NVR", "VMS",
        "mag lock", "REX", "door contact", "card reader", "conduit", "J-hook",
      ];
      KEYTERMS.forEach((t) => params.append("keyterm", t));
      const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY.value()}`,
          "Content-Type": stop.audioType || "audio/webm",
        },
        body: audio,
      });

      if (!res.ok) {
        throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
      }

      const result = await res.json();
      const alt = result?.results?.channels?.[0]?.alternatives?.[0] || {};
      const text = (alt.transcript || "").trim();

      // Save the transcript back onto the stop
      await docRef.update({
        transcript: text,
        transcriptConfidence: alt.confidence ?? null,
        audioSeconds: result?.metadata?.duration ?? null,
        transcriptModel: "nova-3",
        transcribedAt: FieldValue.serverTimestamp(),
        status: text ? "transcribed" : "no_speech",
      });
      logger.info("Transcribed", { uid, stopId, chars: text.length });
    } catch (err) {
      logger.error("Transcription failed", { uid, stopId, error: err.message });
      await docRef.update({
        status: "transcription_failed",
        transcriptError: String(err.message).slice(0, 500),
      });
    }
  }
);