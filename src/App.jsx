import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, startSession } from "./firebase";
import {
  queueStop,
  getPendingStops,
  watchStops,
  startAutoSync,
  onQueueChange,
  urlFor,
} from "./stopStore";
import { watchJobs, startJob, endJob, touchJob, migrateEarlierStops } from "./jobStore";

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
        <strong>{job ? job.name : "No job open"}</strong>
      </div>
    </div>
  );
}

// Bottom sheet for questions. Tap outside or press Escape to close.
function Sheet({ title, onClose, children }) {
  const sheet = useRef(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    sheet.current?.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
    const onKey = (e) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="sheet-shade" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// One row in the Saved stops list
function StopCard({ number, time, photoUrl, audioUrl, audioExpired, status, statusText, transcript }) {
  return (
    <article className="stop">
      {photoUrl && <img src={photoUrl} alt="" className="thumb" />}
      <div className="stop-info">
        <strong>Stop {number}</strong>
        <span>{time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        <span className={`stop-status is-${status}`}>{statusText}</span>
        {transcript && <p className="stop-transcript">{transcript}</p>}
        {audioUrl && <audio controls src={audioUrl} />}
        {audioExpired && <span className="stop-note">Voice note expired</span>}
      </div>
    </article>
  );
}

// Turn the stop's cloud status into what the user sees
function describeStatus(stop) {
  switch (stop.status) {
    case "transcribed":
      return { status: "saved", text: "Saved ✓" };
    case "transcribing":
      return { status: "working", text: "Writing it down…" };
    case "no_speech":
      return { status: "saved", text: "Saved ✓ · No speech heard" };
    case "transcription_failed":
      return { status: "problem", text: "Saved ✓ · Couldn't write out the voice note" };
    default: {
      // "uploaded": a brand-new stop is about to be transcribed;
      // older ones were saved before transcription existed
      const createdMs = stop.createdAt?.toMillis?.() ?? stop.clientCreatedAt;
      const isFresh = stop.audioPath && Date.now() - createdMs < 2 * 60 * 1000;
      return isFresh
        ? { status: "working", text: "Writing it down…" }
        : { status: "saved", text: "Saved ✓" };
    }
  }
}

// A stop that's already in the cloud: look up its photo/voice download links
function CloudStop({ stop, number }) {
  const [urls, setUrls] = useState({ photo: null, audio: null, loaded: false });

  useEffect(() => {
    let alive = true;
    Promise.all([urlFor(stop.photoPath), urlFor(stop.audioPath)]).then(([photo, audio]) => {
      if (alive) setUrls({ photo, audio, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [stop.photoPath, stop.audioPath]);

  const s = describeStatus(stop);

  return (
    <StopCard
      number={number}
      time={new Date(stop.clientCreatedAt)}
      photoUrl={urls.photo}
      audioUrl={urls.audio}
      audioExpired={urls.loaded && stop.audioPath && !urls.audio}
      status={s.status}
      statusText={s.text}
      transcript={stop.transcript}
    />
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
    showToast(`Started ${job.name}`);
    return job;
  };

  // Photo and voice both need a job to go into; ask to start one if none is open
  const takePhoto = () => {
    if (!activeJob) return setSheet({ type: "nojob", next: "photo" });
    fileInput.current.click();
  };

  const talk = () => {
    if (recording) return stopRecording();
    if (!activeJob) return setSheet({ type: "nojob", next: "talk" });
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

  const finishJob = () => {
    endJob(uid, activeJob.id);
    clearDraft();
    setSheet(null);
    showToast(`Finished ${activeJob.name}`);
  };

  const canSave = activeJob && (photo || audio) && !recording && !saving;

  const saveStop = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      // Saved to the phone first, then uploaded in the background
      await queueStop({ photoBlob: photo?.file, audioBlob: audio?.blob, jobId: activeJob.id });
      touchJob(uid, activeJob.id);
      clearDraft();
      showToast(`Stop saved to ${activeJob.name}`);
    } catch (err) {
      console.error("Save failed:", err);
      setError("Couldn't save this stop. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Combine: phone-only stops + cloud stops (skip duplicates mid-upload), newest first,
  // then keep only the open job's stops
  const syncedIds = new Set(synced.map((s) => s.id));
  const jobStops = [
    ...pending.filter((p) => !syncedIds.has(p.id)).map((p) => ({ ...p, isPending: true })),
    ...synced,
  ]
    .filter((s) => activeJob && s.jobId === activeJob.id)
    .sort((a, b) => b.clientCreatedAt - a.clientCreatedAt);

  const stopCount = `${jobStops.length} stop${jobStops.length === 1 ? "" : "s"}`;

  return (
    <main className="app">
      <JobBar job={activeJob} />

      <header className="header">
        <h1>PicTalk</h1>
        <p className="subtitle">
          {!activeJob
            ? "Start a job, then take a picture and say what you see."
            : jobStops.length === 0
              ? "Take a picture, then say what you see."
              : `${stopCount} saved`}
        </p>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

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

      {activeJob ? (
        <section className="saved" aria-label="Saved stops">
          <h2>
            Saved stops <span className="count">{stopCount}</span>
          </h2>
          {jobStops.length === 0 && <p className="empty">No stops yet in this job.</p>}
          {jobStops.map((stop, i) => {
            const number = jobStops.length - i;
            return stop.isPending ? (
              <StopCard
                key={stop.id}
                number={number}
                time={new Date(stop.clientCreatedAt)}
                photoUrl={stop.urls?.photo}
                audioUrl={stop.urls?.audio}
                status="pending"
                statusText={online ? "Uploading…" : "Saved on this phone. Will upload when you're online."}
              />
            ) : (
              <CloudStop key={stop.id} stop={stop} number={number} />
            );
          })}
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
        <Sheet title={`Finish ${activeJob.name}?`} onClose={() => setSheet(null)}>
          <p>
            {photo || audio ? "Your unsaved photo and voice note will be thrown away. " : ""}
            The stops you saved stay saved.
          </p>
          <button className="big-btn danger-btn" onClick={finishJob}>
            <FlagIcon />
            Yes, Finish Job
          </button>
          <button className="big-btn plain-btn" onClick={() => setSheet(null)}>
            Keep Going
          </button>
        </Sheet>
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
