import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NOTE_TYPES, formatDuration } from "./wrapUpStore";

// Same format choice as stops: iPhone records mp4, Android/Chrome records webm/opus
function pickAudioType() {
  const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  if (!window.MediaRecorder) return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

const Icon = {
  mic: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
};

/**
 * Full-screen recorder for one wrap-up note.
 * mode "record": consent card first (customer comments, first time), then recording.
 * mode "edit": opens on the text editor; "Continue recording" starts a new audio piece.
 * onDone({ blob, durationSec, text, textChanged, consentShown }) / onDiscard().
 * M1: no live transcript yet; the words are written down after Done.
 */
export default function WrapUpRecorder({ type, jobLabel, mode, initialText, consentNeeded, onDone, onDiscard }) {
  const info = NOTE_TYPES[type];
  const [phase, setPhase] = useState(mode === "edit" ? "editing" : consentNeeded ? "consent" : "starting");
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState(initialText || "");
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [consentShown, setConsentShown] = useState(false);
  const [hasRecording, setHasRecording] = useState(false); // a recording was started this session
  const recorder = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const wakeLock = useRef(null);
  const textArea = useRef(null);

  const recording = phase === "recording";

  // Count recorded time only (not paused time)
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Keep the screen awake while recording
  useEffect(() => {
    if (!recording || !("wakeLock" in navigator)) return;
    let released = false;
    navigator.wakeLock.request("screen").then((lock) => {
      if (released) lock.release();
      else wakeLock.current = lock;
    }).catch(() => {});
    return () => {
      released = true;
      wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
    };
  }, [recording]);

  // Escape shouldn't reach the End Job sheet underneath
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setConfirmDiscard(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Release the mic if the screen goes away mid-recording
  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const startNew = async () => {
    setError("");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioType();
      const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(250); // small chunks, ready for live streaming later
      recorder.current = rec;
      setHasRecording(true);
      setPhase("recording");
    } catch {
      setError("PicTalk needs your microphone. Tap Allow when your phone asks, or turn it on in your browser settings.");
      setPhase(mode === "edit" ? "editing" : "paused");
    }
  };

  // First start (after consent, if needed)
  useEffect(() => {
    if (phase === "starting") Promise.resolve().then(startNew);
  });

  const pause = () => {
    if (recorder.current?.state === "recording") recorder.current.pause();
    setPhase("paused");
  };
  const resume = () => {
    if (!recorder.current) return startNew();
    if (recorder.current.state === "paused") recorder.current.resume();
    setPhase("recording");
  };
  const openEditor = () => {
    pause();
    setPhase("editing");
    setTimeout(() => textArea.current?.focus(), 50);
  };

  /** Stop the recorder and hand back the audio (or null if nothing was recorded). */
  const finishAudio = () =>
    new Promise((resolve) => {
      const rec = recorder.current;
      if (!rec || rec.state === "inactive") return resolve(null);
      rec.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        resolve(chunks.current.length ? new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }) : null);
      };
      rec.stop();
    });

  const done = async () => {
    setPhase("saving");
    const blob = await finishAudio();
    recorder.current = null;
    onDone({
      blob: seconds > 0 ? blob : null,
      durationSec: seconds,
      text,
      textChanged: text.trim() !== (initialText || "").trim(),
      consentShown,
    });
  };

  const discard = async () => {
    await finishAudio();
    recorder.current = null;
    onDiscard();
  };
  const askDiscard = () => {
    // Nothing recorded or changed yet: just close
    if (!hasRecording && seconds === 0 && text.trim() === (initialText || "").trim()) return onDiscard();
    setConfirmDiscard(true);
  };

  const pill =
    phase === "editing"
      ? { cls: "is-amber", text: "Paused · editing" }
      : recording
        ? { cls: "is-rec", text: "Recording" }
        : { cls: "is-gray", text: "Paused" };

  let body;
  if (phase === "consent") {
    body = (
      <div className="rec-consent">
        <p>Let the customer know this will be recorded and transcribed.</p>
        <button
          className="big-btn photo-btn"
          onClick={() => {
            setConsentShown(true);
            setPhase("starting");
          }}
        >
          Start recording
        </button>
        <button className="big-btn plain-btn" onClick={onDiscard}>
          Cancel
        </button>
      </div>
    );
  } else if (phase === "editing") {
    body = (
      <>
        <textarea
          ref={textArea}
          className="rec-editor"
          value={text}
          placeholder={hasRecording ? "Your recorded words are added here after you tap Done. You can type too." : "Type your notes here."}
          aria-label={`${info.label} text`}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="rec-help">Your text edits are saved. The original audio is kept.</p>
        <div className="rec-edit-actions">
          <button className="big-btn plain-btn" onClick={resume}>
            {Icon.mic}
            Continue recording
          </button>
          <button className="big-btn rec-done-btn" onClick={done}>
            Done – attach to job
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="rec-transcript" aria-live="polite">
          {text.trim() && <p className="rec-final">{text}</p>}
          <p className="rec-waiting">
            {recording
              ? "Listening… your words are written down after you tap Done."
              : phase === "saving"
                ? "Saving…"
                : "Paused. Tap Continue to keep recording."}
          </p>
        </div>
        <div className="rec-controls">
          <div className="rec-control">
            <button className="rec-btn is-edit" onClick={openEditor} disabled={phase === "saving"} aria-label="Edit">
              {Icon.edit}
            </button>
            <span>Edit</span>
          </div>
          <div className="rec-control">
            <button
              className={`rec-btn is-main${recording ? "" : " is-paused"}`}
              onClick={recording ? pause : resume}
              disabled={phase === "saving" || phase === "starting"}
              aria-label={recording ? "Pause" : "Continue"}
            >
              {recording ? Icon.pause : Icon.mic}
            </button>
            <span>{recording ? "Pause" : "Continue"}</span>
          </div>
          <div className="rec-control">
            <button className="rec-btn is-done" onClick={done} disabled={phase === "saving" || phase === "starting"} aria-label="Done">
              {Icon.check}
            </button>
            <span>Done</span>
          </div>
        </div>
      </>
    );
  }

  return createPortal(
    <div className="recorder" role="dialog" aria-modal="true" aria-label={info.label}>
      <header className="rec-head">
        <button className="rec-discard" onClick={phase === "consent" ? onDiscard : askDiscard}>
          Discard
        </button>
        <strong>{info.label}</strong>
        <span className="rec-timer" aria-label={`Recorded ${formatDuration(seconds)}`}>
          {recording && <span className="rec-dot" aria-hidden="true" />}
          {formatDuration(seconds)}
        </span>
      </header>
      <div className="rec-sub">
        <span className="rec-job">{jobLabel}</span>
        {phase !== "consent" && <span className={`rec-pill ${pill.cls}`}>{pill.text}</span>}
      </div>
      {error && <p className="summary-error" role="alert">{error}</p>}
      {body}
      {confirmDiscard && (
        <div className="rec-confirm" role="alertdialog" aria-label="Discard these notes?">
          <div className="rec-confirm-card">
            <h2>Discard these notes?</h2>
            <p>The recording will be deleted.</p>
            <button className="big-btn danger-btn" onClick={discard}>
              Discard
            </button>
            <button className="big-btn plain-btn" onClick={() => setConfirmDiscard(false)}>
              Keep Recording
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
