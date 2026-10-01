// transcribeWrapUpNote: batch-transcribes new audio pieces of a wrap-up note.
// A note lives at users/{uid}/jobs/{jobId}/wrapUpNotes/{field|customer} and holds a list
// of audio pieces (segments). Each piece the app uploads arrives with status "uploaded";
// this function transcribes it and appends its words to the note.
// It never overwrites what the user typed: once the note is edited, new words are only
// appended after the user's text.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { DEEPGRAM_API_KEY, transcribeAudio } = require("./deepgram");

const joinTranscripts = (segments) =>
  [...segments]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map((s) => (s.transcript || "").trim())
    .filter(Boolean)
    .join("\n\n");

exports.transcribeWrapUpNote = onDocumentWritten(
  {
    document: "users/{uid}/jobs/{jobId}/wrapUpNotes/{noteType}",
    secrets: [DEEPGRAM_API_KEY],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // note deleted
    const { uid, jobId, noteType } = event.params;
    const ref = after.ref;
    const db = getFirestore();
    const todo = (after.get("segments") || []).filter((s) => s.status === "uploaded").map((s) => s.id);

    for (const segId of todo) {
      // Claim the piece so a second trigger (our own writes re-trigger) doesn't redo it
      const piece = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const segments = snap.exists ? snap.get("segments") || [] : [];
        const seg = segments.find((s) => s.id === segId);
        if (!seg || seg.status !== "uploaded") return null;
        tx.update(ref, { segments: segments.map((s) => (s.id === segId ? { ...s, status: "transcribing" } : s)) });
        return seg;
      });
      if (!piece) continue;

      let result = null;
      let error = null;
      try {
        const [audio] = await getStorage().bucket().file(piece.audioPath).download();
        result = await transcribeAudio(audio, piece.audioType);
      } catch (err) {
        error = err;
        logger.error("Wrap-up transcription failed", { uid, jobId, noteType, segId, error: err.message });
      }

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return; // deleted meanwhile
        const note = snap.data();
        const status = error ? "transcription_failed" : result.text ? "transcribed" : "no_speech";
        const segments = (note.segments || []).map((s) =>
          s.id === segId ? { ...s, status, transcript: result ? result.text : null } : s
        );
        const batchTranscript = joinTranscripts(segments);
        const update = { segments, batchTranscript: batchTranscript || null, transcriptSource: "batch", updatedAt: Date.now() };
        if (note.edited) {
          // Keep the user's text; add the new words after it
          if (result?.text) update.text = note.text ? `${note.text.trimEnd()}\n\n${result.text}` : result.text;
        } else {
          update.text = batchTranscript;
        }
        tx.update(ref, update);
      });
      if (result) logger.info("Wrap-up note transcribed", { uid, jobId, noteType, segId, chars: result.text.length });
    }
  }
);
