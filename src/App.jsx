import { useEffect, useRef, useState } from "react";
import { startSession } from "./firebase";

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

export default function App() {
  const [stops, setStops] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [audio, setAudio] = useState(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");

  const fileInput = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);

  // Sign in quietly in the background (anonymous, no account needed)
  useEffect(() => {
    startSession().catch((err) => console.warn("Sign-in failed:", err));
    return () => clearInterval(timer.current);
  }, []);

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
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

  const saveStop = () => {
    setStops((prev) => [{ id: Date.now(), photo, audio, time: new Date() }, ...prev]);
    setPhoto(null);
    setAudio(null);
  };

  const canSave = (photo || audio) && !recording;
  const savedLabel = `${stops.length} stop${stops.length === 1 ? "" : "s"} saved`;

  return (
    <main className="app">
      <header className="header">
        <h1>PicTalk</h1>
        <p className="subtitle">
          {stops.length === 0 ? "Take a picture, then say what you see." : savedLabel}
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
        Save This Stop
      </button>

      {stops.length > 0 && (
        <section className="saved" aria-label="Saved stops">
          <h2>Saved stops</h2>
          {stops.map((stop, i) => (
            <article className="stop" key={stop.id}>
              {stop.photo && <img src={stop.photo.url} alt="" className="thumb" />}
              <div className="stop-info">
                <strong>Stop {stops.length - i}</strong>
                <span>{stop.time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                {stop.audio && <audio controls src={stop.audio.url} />}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
