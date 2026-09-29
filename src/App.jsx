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

    // Live list of stops already in the cloud
    let stopCloudWatch = () => {};
    const stopAuthWatch = onAuthStateChanged(auth, (user) => {
      stopCloudWatch();
      stopCloudWatch = user ? watchStops(user.uid, setSynced) : () => {};
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

  const canSave = (photo || audio) && !recording && !saving;

  const saveStop = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      // Saved to the phone first, then uploaded in the background
      await queueStop({ photoBlob: photo?.file, audioBlob: audio?.blob });
      if (photo) URL.revokeObjectURL(photo.url);
      if (audio) URL.revokeObjectURL(audio.url);
      setPhoto(null);
      setAudio(null);
    } catch (err) {
      console.error("Save failed:", err);
      setError("Couldn't save this stop. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Combine: phone-only stops + cloud stops (skip duplicates mid-upload), newest first
  const syncedIds = new Set(synced.map((s) => s.id));
  const allStops = [
    ...pending.filter((p) => !syncedIds.has(p.id)).map((p) => ({ ...p, isPending: true })),
    ...synced,
  ].sort((a, b) => b.clientCreatedAt - a.clientCreatedAt);

  const savedLabel = `${allStops.length} stop${allStops.length === 1 ? "" : "s"} saved`;

  return (
    <main className="app">
      <header className="header">
        <h1>PicTalk</h1>
        <p className="subtitle">
          {allStops.length === 0 ? "Take a picture, then say what you see." : savedLabel}
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
        onClick={() => fileInput.current.click()}
        disabled={recording}
      >
        <CameraIcon />
        {photo ? "Retake Photo" : "Take Photo"}
      </button>

      <button
        className={`big-btn talk-btn${recording ? " is-recording" : ""}`}
        onClick={recording ? stopRecording : startRecording}
        aria-pressed={recording}
      >
        {recording ? <StopIcon /> : <MicIcon />}
        {recording ? `Stop  ${formatTime(seconds)}` : audio ? "Talk Again" : "Tap to Talk"}
      </button>

      <button className="save-btn" onClick={saveStop} disabled={!canSave}>
        {saving ? "Saving…" : "Save This Stop"}
      </button>

      {allStops.length > 0 && (
        <section className="saved" aria-label="Saved stops">
          <h2>Saved stops</h2>
          {allStops.map((stop, i) => {
            const number = allStops.length - i;
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
        </section>
      )}
    </main>
  );
}
