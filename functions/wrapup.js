// transcribeWrapUpNote: finishes new audio pieces of a wrap-up note.
// A note lives at users/{uid}/jobs/{jobId}/wrapUpNotes/{field|customer} and holds a list
// of audio pieces (segments), one per recording session. The app uploads each piece as:
//   status "live"     — the live stream stayed connected; liveTranscript is the transcript
//                        (no second transcription, no second charge)
//   status "uploaded" — no complete live transcript (stream unavailable or dropped);
//                        this function batch-transcribes the full audio
// It never overwrites what the user typed: once the note is edited, new words are only
// appended after the user's text, and not at all when the user's text already holds them.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { DEEPGRAM_API_KEY, transcribeAudio } = require("./deepgram");

const joinTranscripts = (segments, source) =>
  [...segments]
    .filter((s) => !source || s.source === source)
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
    const todo = (after.get("segments") || []).filter((s) => s.status === "uploaded" || s.status === "live").map((s) => s.id);

    for (const segId of todo) {
      // Claim the piece so a second trigger (our own writes re-trigger) doesn't redo it
      const piece = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const segments = snap.exists ? snap.get("segments") || [] : [];
        const seg = segments.find((s) => s.id === segId);
        if (!seg || (seg.status !== "uploaded" && seg.status !== "live")) return null;
        tx.update(ref, { segments: segments.map((s) => (s.id === segId ? { ...s, status: "transcribing" } : s)) });
        return seg;
      });
      if (!piece) continue;

      const isLive = piece.status === "live";
      let words = null;
      let error = null;
      if (isLive) {
        words = (piece.liveTranscript || "").trim();
      } else {
        try {
          const [audio] = await getStorage().bucket().file(piece.audioPath).download();
          words = (await transcribeAudio(audio, piece.audioType)).text;
        } catch (err) {
          error = err;
          logger.error("Wrap-up transcription failed", { uid, jobId, noteType, segId, error: err.message });
        }
      }

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return; // deleted meanwhile
        const note = snap.data();
        const status = error ? "transcription_failed" : words ? "transcribed" : "no_speech";
        const segments = (note.segments || []).map((s) =>
          s.id === segId ? { ...s, status, source: isLive ? "live" : "batch", transcript: error ? null : words } : s
        );
        const update = {
          segments,
          liveTranscript: joinTranscripts(segments, "live") || "",
          batchTranscript: joinTranscripts(segments, "batch") || null,
          transcriptSource: segments.every((s) => s.source === "live") ? "live" : "batch",
          updatedAt: Date.now(),
        };
        if (note.edited) {
          // The user's text wins. Add the new words after it, unless the user saved this
          // session's text themselves and it already holds live words from it.
          const alreadyInText = piece.textIncluded && (piece.liveTranscript || "").trim();
          if (words && !alreadyInText) update.text = note.text ? `${note.text.trimEnd()}\n\n${words}` : words;
        } else {
          update.text = joinTranscripts(segments);
        }
        tx.update(ref, update);
      });
      logger.info("Wrap-up note piece finished", { uid, jobId, noteType, segId, live: isLive, chars: (words || "").length });
    }
  }
);
