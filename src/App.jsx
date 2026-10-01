import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, startSession } from "./firebase";
import {
  queueStop,
  getPendingStops,
  watchStops,
  startAutoSync,
  onQueueChange,
  moveStop,
  deleteStop,
} from "./stopStore";
import {
  watchJobs, startJob, endJob, reopenJob, setJobDetails, touchJob, migrateEarlierStops, jobTitle,
} from "./jobStore";
import { StopList } from "./StopCards";
import JobsScreen from "./JobsScreen";
import JobDetailsFields from "./JobDetailsFields";
import WrapUpNotes from "./WrapUpNotes";
import useWrapUpNotes from "./useWrapUpNotes";
import { startNoteAutoSync } from "./wrapUpStore";
import Sheet from "./Sheet";
import ExportSheet from "./ExportSheet";

// Pick an audio format this phone's browser can record (iPhone uses mp4, Android/Chrome uses webm)
function pickAudioType() {
  const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  if (!window.MediaRecorder) return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function formatTime(total) {
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.3" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1.3" fill="currentColor" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />
    </svg>
  );
}

// Always-visible bar showing which job new stops go into
function JobBar({ job }) {
  return (
    <div className={`job-bar${job ? "" : " is-idle"}`} role="status">
      <span className="job-bar-dot" aria-hidden="true" />
      <div>
        <small>{job ? "Saving to" : "Nothing is being saved"}</small>
        <strong>{job ? jobTitle(job) : "No job open"}</strong>
      </div>
    </div>
  );
}

// Demo limit: keeps storage and transcription costs small while PicTalk is a public demo
const STOP_LIMIT = 10;

// End Job: optional Customer and Location, then finish
function EndJobSheet({ uid, job, hasDraft, online, onFinish, onClose }) {
  const [details, setDetails] = useState({ customer: job.customer || "", location: job.location || "" });
  const notes = useWrapUpNotes(uid, job.id);
  const hasNotes = !!(notes.notes.field || notes.notes.customer || notes.pending.field.length || notes.pending.customer.length);
  // The recorder shows "Customer – Location" as typed so far
  const jobLabel = [details.customer.trim(), details.location.trim()].filter(Boolean).join(" – ") || jobTitle(job);
  return (
    <Sheet title={`Finish ${jobTitle(job)}?`} onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          onFinish(details);
        }}
      >
        <p>Add who and where this job was for. Both are optional.</p>
        <JobDetailsFields customer={details.customer} location={details.location} onChange={setDetails} />
        <WrapUpNotes uid={uid} job={job} jobLabel={jobLabel} data={notes} online={online} />
        <p>
          {hasDraft ? "Your unsaved photo and voice note will be thrown away. " : ""}
          The stops you saved stay saved.{hasNotes ? " Wrap-up notes go into the job summary." : ""}
        </p>
        <button type="submit" className="big-btn danger-btn">
          <FlagIcon />
          Save &amp; Finish Job
        </button>
        <button type="button" className="big-btn plain-btn" onClick={onClose}>
          Keep Going
        </button>
      </form>
    </Sheet>
  );
}

export default function App() {
  const [pending, setPending] = useState([]); // saved on this phone, not uploaded yet
  const [synced, setSynced] = useState([]); // safely in the cloud
  const [photo, setPhoto] = useState(null);
  const [audio, setAudio] = useState(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState("");
  const [uid, setUid] = useState(null);
  const [jobs, setJobs] = useState([]); // newest first
  const [sheet, setSheet] = useState(null); // { type: "nojob", next } | { type: "end" }
  const [toast, setToast] = useState(null);
  const [view, setView] = useState("camera"); // "camera" | "jobs"
  const [jobsTarget, setJobsTarget] = useState(null); // { jobId, autoSummary, key } when opening a job directly
  const [deleting, setDeleting] = useState(false);

  const fileInput = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const localUrls = useRef(new Map()); // pending stop id -> { photo, audio } preview links

  useEffect(() => {
    // Sign in quietly in the background (anonymous, no account needed)
    startSession().catch((err) => console.warn("Sign-in failed:", err));

    // Keep retrying uploads (on reconnect, app reopen, every minute)
    const stopAutoSync = startAutoSync();
    const stopNoteSync = startNoteAutoSync(); // wrap-up notes recorded on this phone

    // Reload the "on this phone" list whenever the queue changes
    const refreshPending = async () => {
      const items = await getPendingStops();
      const cache = localUrls.current;
      const ids = new Set(items.map((i) => i.id));
      for (const [id, u] of cache) {
        if (!ids.has(id)) {
          if (u.photo) URL.revokeObjectURL(u.photo);
          if (u.audio) URL.revokeObjectURL(u.audio);
          cache.delete(id);
        }
      }
      setPending(
        items.map((item) => {
          if (!cache.has(item.id)) {
            cache.set(item.id, {
              photo: item.photoBlob ? URL.createObjectURL(item.photoBlob) : null,
              audio: item.audioBlob ? URL.createObjectURL(item.audioBlob) : null,
            });
          }
          return { ...item, urls: cache.get(item.id) };
        })
      );
    };
    const stopQueueWatch = onQueueChange(refreshPending);
    refreshPending();

    // Live lists of jobs and of stops already in the cloud
    let stopCloudWatch = () => {};
    let stopJobsWatch = () => {};
    const stopAuthWatch = onAuthStateChanged(auth, (user) => {
      stopCloudWatch();
      stopJobsWatch();
      setUid(user?.uid ?? null);
      if (user) {
        stopCloudWatch = watchStops(user.uid, setSynced);
        stopJobsWatch = watchJobs(user.uid, setJobs);
        migrateEarlierStops(user.uid);
      } else {
        stopCloudWatch = stopJobsWatch = () => {};
      }
    });

    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    return () => {
      clearInterval(timer.current);
      stopAutoSync();
      stopNoteSync();
      stopQueueWatch();
      stopAuthWatch();
      stopCloudWatch();
      stopJobsWatch();
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto({ file, url: URL.createObjectURL(file) });
    e.target.value = "";
  };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType });
        setAudio({ blob, url: URL.createObjectURL(blob) });
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorder.current = rec;
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("PicTalk needs your microphone. Tap Allow when your phone asks, or turn it on in your browser settings.");
    }
  };

  const stopRecording = () => {
    recorder.current?.stop();
    clearInterval(timer.current);
    setRecording(false);
  };

  // Short confirmation message at the bottom of the screen
  const showToast = (text) => setToast((t) => ({ text, id: (t?.id ?? 0) + 1 }));
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // The job new stops go into (at most one is open)
  const activeJob = jobs.find((j) => j.status === "open") ?? null;

  const clearDraft = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    if (audio) URL.revokeObjectURL(audio.url);
    setPhoto(null);
    setAudio(null);
  };

  const beginJob = () => {
    if (!uid) {
      setError("PicTalk needs to be online the first time you start a job. Connect and try again.");
      return null;
    }
    setError("");
    const job = startJob(uid, jobs.filter((j) => j.status === "open"));
    showToast(`Started ${jobTitle(job)}`);
    return job;
  };

  // Photo and voice both need a job to go into; ask to start one if none is open
  const takePhoto = () => {
    if (!activeJob) return setSheet({ type: "nojob", next: "photo" });
    if (jobFull) return setError(fullMessage);
    fileInput.current.click();
  };

  const talk = () => {
    if (recording) return stopRecording();
    if (!activeJob) return setSheet({ type: "nojob", next: "talk" });
    if (jobFull) return setError(fullMessage);
    startRecording();
  };

  const startFromSheet = () => {
    const next = sheet?.next;
    setSheet(null);
    if (!beginJob()) return;
    // Still inside the tap, so the phone lets us open the camera / mic
    if (next === "photo") fileInput.current.click();
    if (next === "talk") startRecording();
  };

  const finishJob = (details) => {
    endJob(uid, activeJob.id, details);
    clearDraft();
    setSheet(null);
    showToast(`Finished ${jobTitle({ ...activeJob, ...details })}`);
    // Go straight to the finished job's page, where the AI summary gets built
    setJobsTarget((t) => ({ jobId: activeJob.id, autoSummary: true, key: (t?.key ?? 0) + 1 }));
    showView("jobs");
  };

  const canSave = activeJob && (photo || audio) && !recording && !saving;

  const saveStop = async () => {
    if (!canSave) return;
    if (jobFull) return setError(fullMessage);
    setSaving(true);
    setError("");
    try {
      // Saved to the phone first, then uploaded in the background
      await queueStop({ photoBlob: photo?.file, audioBlob: audio?.blob, jobId: activeJob.id });
      touchJob(uid, activeJob.id);
      clearDraft();
      showToast(`Stop saved to ${jobTitle(activeJob)}`);
    } catch (err) {
      console.error("Save failed:", err);
      setError("Couldn't save this stop. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Combine: phone-only stops + cloud stops (skip duplicates mid-upload)
  const syncedIds = new Set(synced.map((s) => s.id));
  const allStops = [
    ...pending.filter((p) => !syncedIds.has(p.id)).map((p) => ({ ...p, isPending: true })),
    ...synced,
  ];
  const jobStops = activeJob ? allStops.filter((s) => s.jobId === activeJob.id) : [];
  const stopsInJob = (id) => allStops.filter((s) => s.jobId === id).length;
  const jobFull = jobStops.length >= STOP_LIMIT;
  const fullMessage = `This demo allows ${STOP_LIMIT} stops per job. End this job to start a new one.`;

  const stopCount = `${jobStops.length} stop${jobStops.length === 1 ? "" : "s"}`;

  const showView = (v) => {
    setView(v);
    window.scrollTo(0, 0);
  };

  // Reopening a job while a different one is open asks first
  const requestReopen = (job) => {
    if (activeJob && activeJob.id !== job.id) return setSheet({ type: "reopen", job });
    doReopen(job);
  };

  const doReopen = (job) => {
    if (!uid) return;
    reopenJob(uid, job.id, jobs.filter((j) => j.status === "open"));
    clearDraft(); // an unsaved photo belonged to the job that was open
    setSheet(null);
    showView("camera");
    showToast(`Reopened ${jobTitle(job)}`);
  };

  const saveDetails = (job, details) => {
    setJobDetails(uid, job.id, details);
    showToast("Customer and location saved");
  };

  // Stop options: move to another job, or delete
  const selectStop = (stop, { number, photoUrl }) => setSheet({ type: "stop", stop, number, photoUrl });

  const moveTo = async (stop, job) => {
    setSheet(null);
    if (stopsInJob(job.id) >= STOP_LIMIT) {
      return setError(`${jobTitle(job)} already has ${STOP_LIMIT} stops, the most this demo allows per job.`);
    }
    try {
      await moveStop(uid, stop, job.id);
      showToast(`Moved to ${jobTitle(job)}`);
    } catch (err) {
      console.error("Move failed:", err);
      setError("Couldn't move this stop. Please try again.");
    }
  };

  const confirmDelete = async (stop) => {
    setDeleting(true);
    try {
      await deleteStop(uid, stop);
      setSheet(null);
      showToast("Stop deleted");
    } catch (err) {
      console.error("Delete failed:", err);
      setSheet(null);
      setError(
        err?.message === "offline"
          ? "You need signal to delete a stop that's already uploaded. Try again when you're online."
          : "Couldn't delete this stop. Please try again."
      );
    } finally {
      setDeleting(false);
    }
  };

  const jobName = (id) => jobTitle(jobs.find((j) => j.id === id)) || "a job";
  const clockOf = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <main className="app">
      <JobBar job={activeJob} />

      {view === "jobs" ? (
        <JobsScreen
          key={jobsTarget?.key ?? 0}
          uid={uid}
          initialJobId={jobsTarget?.jobId}
          autoSummaryJobId={jobsTarget?.autoSummary ? jobsTarget.jobId : null}
          onNotice={showToast}
          jobs={jobs}
          stops={allStops}
          activeJobId={activeJob?.id}
          online={online}
          onClose={() => showView("camera")}
          onReopen={requestReopen}
          onSaveDetails={saveDetails}
          onExport={(job) => setSheet({ type: "export", job })}
          onStopSelect={selectStop}
        />
      ) : (
        <>
          <header className="header">
            <div className="header-row">
              <h1>PicTalk</h1>
              <button
                className="link-btn"
                onClick={() => {
                  setJobsTarget((t) => ({ key: (t?.key ?? 0) + 1 })); // open on the list
                  showView("jobs");
                }}
                disabled={recording}
              >
                <ListIcon />
                My Jobs{jobs.length ? ` (${jobs.length})` : ""}
              </button>
            </div>
            <p className="subtitle">
              {!activeJob
                ? "Start a job, then take a picture and say what you see."
                : jobStops.length === 0
                  ? "Take a picture, then say what you see."
                  : `${stopCount} saved`}
            </p>
            <p className="demo-note">
              Demo app · Up to {STOP_LIMIT} stops per job · Voice notes are deleted after 5 days
            </p>
          </header>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {jobFull ? (
            <p className="limit-note" role="status">
              {fullMessage}
            </p>
          ) : (
            <>
            <section className="current" aria-label="Current stop">
              {photo ? (
                <img src={photo.url} alt="Photo for this stop" className="preview" />
              ) : (
                <div className="placeholder">Your photo will show here</div>
              )}
              {audio && !recording && <audio controls src={audio.url} className="player" />}
            </section>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={handlePhoto}
            />

            <button
              className="big-btn photo-btn"
              onClick={takePhoto}
              disabled={recording}
            >
              <CameraIcon />
              {photo ? "Retake Photo" : "Take Photo"}
            </button>

            <button
              className={`big-btn talk-btn${recording ? " is-recording" : ""}`}
              onClick={talk}
              aria-pressed={recording}
            >
              {recording ? <StopIcon /> : <MicIcon />}
              {recording ? `Stop  ${formatTime(seconds)}` : audio ? "Talk Again" : "Tap to Talk"}
            </button>

            <button className="save-btn" onClick={saveStop} disabled={!canSave}>
              {saving ? "Saving…" : "Save This Stop"}
            </button>
            </>
          )}

          {activeJob ? (
            <section className="saved" aria-label="Saved stops">
              <h2>
                Saved stops <span className="count">{stopCount}</span>
              </h2>
              {jobStops.length === 0 && <p className="empty">No stops yet in this job.</p>}
              <StopList stops={jobStops} online={online} newestFirst onSelect={selectStop} />
              <button className="big-btn end-btn" onClick={() => setSheet({ type: "end" })} disabled={recording}>
                <FlagIcon />
                End Job
              </button>
            </section>
          ) : (
            <button className="big-btn start-btn" onClick={beginJob}>
              <PlusIcon />
              Start New Job
            </button>
          )}
        </>
      )}

      {sheet?.type === "nojob" && (
        <Sheet title="Start a new job?" onClose={() => setSheet(null)}>
          <p>Your stops need a job to go into.</p>
          <button className="big-btn photo-btn" onClick={startFromSheet}>
            <PlusIcon />
            Start New Job
          </button>
          <button className="text-btn" onClick={() => setSheet(null)}>
            Not now
          </button>
        </Sheet>
      )}

      {sheet?.type === "end" && activeJob && (
        <EndJobSheet uid={uid} job={activeJob} hasDraft={!!(photo || audio)} online={online} onFinish={finishJob} onClose={() => setSheet(null)} />
      )}

      {sheet?.type === "reopen" && (
        <Sheet title={`Reopen ${jobTitle(sheet.job)}?`} onClose={() => setSheet(null)}>
          <p>
            {activeJob ? `${jobTitle(activeJob)} is open right now. It will be finished so new stops go to the reopened job.` : ""}
            {photo || audio ? " Your unsaved photo and voice note will be thrown away." : ""}
          </p>
          <button className="big-btn photo-btn" onClick={() => doReopen(sheet.job)}>
            Reopen Job
          </button>
          <button className="big-btn plain-btn" onClick={() => setSheet(null)}>
            Cancel
          </button>
        </Sheet>
      )}

      {sheet?.type === "stop" && (
        <Sheet title={`Stop ${sheet.number}`} onClose={() => setSheet(null)}>
          {sheet.photoUrl && <img src={sheet.photoUrl} alt="" className="sheet-photo" />}
          <p>
            In {jobName(sheet.stop.jobId)}, saved at {clockOf(sheet.stop.clientCreatedAt)}
          </p>
          <button className="big-btn photo-btn" onClick={() => setSheet({ ...sheet, type: "move" })}>
            Move to a Different Job
          </button>
          <button className="big-btn plain-btn is-danger" onClick={() => setSheet({ ...sheet, type: "delete" })}>
            Delete Stop
          </button>
          <button className="text-btn" onClick={() => setSheet(null)}>
            Close
          </button>
        </Sheet>
      )}

      {sheet?.type === "move" && (
        <Sheet title="Move this stop to…" onClose={() => setSheet(null)}>
          {jobs.filter((j) => j.id !== sheet.stop.jobId).length === 0 && <p>There are no other jobs yet.</p>}
          {jobs
            .filter((j) => j.id !== sheet.stop.jobId)
            .map((j) => (
              <button
                key={j.id}
                className="job-card"
                onClick={() => moveTo(sheet.stop, j)}
                disabled={stopsInJob(j.id) >= STOP_LIMIT}
              >
                <strong>{jobTitle(j)}</strong>
                <span>
                  {j.status === "open" ? "Open" : "Finished"}
                  {stopsInJob(j.id) >= STOP_LIMIT ? ` · Full (${STOP_LIMIT} stops)` : ""}
                </span>
              </button>
            ))}
          <button className="text-btn" onClick={() => setSheet(null)}>
            Cancel
          </button>
        </Sheet>
      )}

      {sheet?.type === "delete" && (
        <Sheet title="Delete this stop?" onClose={() => !deleting && setSheet(null)}>
          <p>The photo and voice note will be gone for good.</p>
          <button className="big-btn danger-btn" onClick={() => confirmDelete(sheet.stop)} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete Stop"}
          </button>
          <button className="big-btn plain-btn" onClick={() => setSheet(null)} disabled={deleting}>
            Keep It
          </button>
        </Sheet>
      )}

      {sheet?.type === "export" && (
        <ExportSheet
          job={jobs.find((j) => j.id === sheet.job.id) || sheet.job}
          uid={uid}
          onClose={() => setSheet(null)}
          onDone={(how) => {
            setSheet(null);
            showToast(how === "shared" ? "PDF shared" : "PDF downloaded");
          }}
        />
      )}

      <div className="toast-slot" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            {toast.text}
          </div>
        )}
      </div>
    </main>
  );
}
