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

// Piccolo: AI draft of a work order, BOM, and quote from a finished job
exports.draftPiccolo = require("./piccolo").draftPiccolo;
exports.finalizePiccolo = require("./finalize").finalizePiccolo;
exports.piccoloMediaLinks = require("./finalize").piccoloMediaLinks;

// Teams: share jobs with the company, keep stops in step, price-free work order view, assign
const teams = require("./teams");
exports.shareNewJobWithTeam = teams.shareNewJobWithTeam;
exports.syncStopOrg = teams.syncStopOrg;
exports.workOrderView = teams.workOrderView;
exports.setJobSharing = teams.setJobSharing;
exports.assignJob = teams.assignJob;

// Admin console: sales status and customer on team jobs, storage used
exports.updateTeamJob = require("./admin").updateTeamJob;
exports.orgStorageUsage = require("./admin").orgStorageUsage;
exports.auditOrgSettings = require("./admin").auditOrgSettings;
exports.recordExport = require("./admin").recordExport;

// Guests: 7-day expiry, daily cleanup, merging into an existing account, sample job
const guests = require("./guests");
exports.setGuestExpiry = guests.setGuestExpiry;
exports.cleanupGuestJobs = guests.cleanupGuestJobs;
exports.mergeGuestIntoAccount = guests.mergeGuestIntoAccount;
exports.createDemoJob = guests.createDemoJob;

// Piccolo accounts: profiles, companies, team invites, roles
const accounts = require("./accounts");
exports.ensureProfile = accounts.ensureProfile;
exports.acceptInvite = accounts.acceptInvite;
exports.createOrg = accounts.createOrg;
exports.createInvite = accounts.createInvite;
exports.revokeInvite = accounts.revokeInvite;
exports.updateMember = accounts.updateMember;

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
    // Already written down (e.g. a guest's stop moved into their account): don't pay twice
    if (["transcribed", "no_speech"].includes(stop.status)) {
      logger.info("Already transcribed, skipping", { uid, stopId });
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