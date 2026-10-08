const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

initializeApp();
setGlobalOptions({ region: "us-west2", maxInstances: 10 });

const { DEEPGRAM_API_KEY, transcribeAudio } = require("./deepgram");

// AI summary and action items for a finished job (callable from the app)
exports.generateJobSummary = require("./summary").generateJobSummary;

// Batch transcription of wrap-up notes (field notes / customer comments)
exports.transcribeWrapUpNote = require("./wrapup").transcribeWrapUpNote;

// AI description of a stop's photo (when the user taps Describe photo)
exports.describeStopPhoto = require("./photo").describeStopPhoto;

// Short-lived Deepgram token for live transcription in the browser
exports.getDeepgramStreamToken = require("./streamtoken").getDeepgramStreamToken;

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
      const started = Date.now();
      const [audio] = await getStorage().bucket().file(stop.audioPath).download();
      const downloaded = Date.now();

      // Send it to Deepgram
      const result = await transcribeAudio(audio, stop.audioType);
      const text = result.text;
      // Engineering Mode: where the time went inside this function
      const transcribeTimings = {
        downloadMs: downloaded - started,
        deepgramMs: Date.now() - downloaded,
        audioBytes: audio.length,
      };

      // Save the transcript back onto the stop
      await docRef.update({
        transcript: text,
        transcriptConfidence: result.confidence,
        audioSeconds: result.duration,
        transcriptModel: result.model,
        transcribeTimings,
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