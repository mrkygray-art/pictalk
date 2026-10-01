import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NOTE_TYPES, formatDuration } from "./wrapUpStore";
import { openLiveStream } from "./liveTranscribe";

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
 * While recording, words appear live (Deepgram streaming): finished words in white,
 * words still being worked out in gray. The full audio is always recorded on the phone,
 * so if the live connection fails or drops, the words are written down after Done.
 * onDone({ blob, durationSec, text, userEdited, liveTranscript, streamOk, consentShown }) / onDiscard().
 */
export default function WrapUpRecorder({ type, jobLabel, mode, initialText, consentNeeded, onDone, onDiscard }) {
  const info = NOTE_TYPES[type];
  const [phase, setPhase] = useState(mode === "edit" ? "editing" : consentNeeded ? "consent" : "starting");
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState(initialText || "");
  const [interim, setInterim] = useState("");
  const [live, setLive] = useState("idle"); // idle | connecting | live | offline
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [consentShown, setConsentShown] = useState(false);
  const [hasRecording, setHasRecording] = useState(false); // a recording was started this session
  const [userEdited, setUserEdited] = useState(false);
  const recorder = useRef(null); // the full recording (kept and uploaded)
  const chunks = useRef([]);
  const stream = useRef(null);
  const wakeLock = useRef(null);
  const textArea = useRef(null);
  const transcriptBox = useRef(null);
  // Live transcription
  const textRef = useRef(initialText || "");
  const liveWords = useRef(""); // this session's finished live words
  const newParagraph = useRef(false);
  const liveConn = useRef(null);
  const streamRec = useRef(null); // one per live connection, so each starts with a full audio header
  const everLive = useRef(false);
  const streamBroken = useRef(false);
  const phaseRef = useRef(phase);
  const startedOnce = useRef(false); // the first start must run exactly once
  useEffect(() => {
    phaseRef.current = phase;
  });

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

  // Keep the newest words in view
  useEffect(() => {
    const box = transcriptBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [text, interim]);

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

  // Release the mic and the live connection if the screen goes away mid-recording
  useEffect(() => () => {
    if (streamRec.current && streamRec.current.state !== "inactive") streamRec.current.stop();
    liveConn.current?.finish();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const appendFinal = (words) => {
    const base = textRef.current.trimEnd();
    const sep = !base ? "" : newParagraph.current ? "\n\n" : " ";
    newParagraph.current = false;
    textRef.current = base + sep + words;
    setText(textRef.current);
    liveWords.current = liveWords.current ? liveWords.current + (sep || " ") + words : words;
  };

  const stopStreamRecorder = () => {
    if (streamRec.current && streamRec.current.state !== "inactive") streamRec.current.stop();
    streamRec.current = null;
  };

  const startLive = async () => {
    setLive("connecting");
    try {
      const conn = await openLiveStream({
        onInterim: setInterim,
        onFinal: appendFinal,
        onUtteranceEnd: () => {
          newParagraph.current = true;
        },
        onDrop: () => {
          streamBroken.current = true;
          stopStreamRecorder();
          liveConn.current = null;
          setInterim("");
          setLive("offline");
        },
      });
      if (phaseRef.current !== "recording" || !stream.current) {
        await conn.finish(); // paused or finished while connecting
        return;
      }
      liveConn.current = conn;
      const mimeType = pickAudioType();
      const sr = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      sr.ondataavailable = (e) => conn.send(e.data);
      sr.start(250); // ~250 ms chunks
      streamRec.current = sr;
      everLive.current = true;
      setLive("live");
    } catch (err) {
      console.warn("Live transcription unavailable; recording continues:", err?.message || err);
      streamBroken.current = true;
      setLive("offline");
    }
  };

  const stopLive = async () => {
    stopStreamRecorder();
    const conn = liveConn.current;
    liveConn.current = null;
    if (conn) await conn.finish(); // waits briefly for the last finished words
    setInterim("");
    setLive((l) => (l === "offline" ? "offline" : "idle"));
  };

  const startNew = async () => {
    setError("");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioType();
      const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(250);
      recorder.current = rec;
      setHasRecording(true);
      phaseRef.current = "recording";
      setPhase("recording");
      startLive();
    } catch {
      setError("PicTalk needs your microphone. Tap Allow when your phone asks, or turn it on in your browser settings.");
      setPhase(mode === "edit" ? "editing" : "paused");
    }
  };

  // First start (after consent, if needed). Guarded: effects can run more than once,
  // and a second start would open a second mic recorder and live connection.
  useEffect(() => {
    if (phase !== "starting" || startedOnce.current) return;
    startedOnce.current = true;
    Promise.resolve().then(startNew);
  });

  const pause = () => {
    if (recorder.current?.state === "recording") recorder.current.pause();
    phaseRef.current = "paused";
    setPhase("paused");
    stopLive(); // no open connection while paused: no charge for silence
  };
  const resume = () => {
    if (!recorder.current) return startNew();
    if (recorder.current.state === "paused") recorder.current.resume();
    phaseRef.current = "recording";
    setPhase("recording");
    startLive(); // new token, new connection; new words go after the existing text
  };
  const openEditor = () => {
    if (recording) pause();
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
    phaseRef.current = "saving";
    setPhase("saving");
    await stopLive();
    const blob = await finishAudio();
    recorder.current = null;
    onDone({
      blob: seconds > 0 ? blob : null,
      durationSec: seconds,
      text: textRef.current,
      userEdited,
      liveTranscript: liveWords.current,
      // Use the live words only if every live stretch stayed connected
      streamOk: everLive.current && !streamBroken.current,
      consentShown,
    });
  };

  const discard = async () => {
    phaseRef.current = "saving";
    await stopLive();
    await finishAudio();
    recorder.current = null;
    onDiscard();
  };
  const askDiscard = () => {
    // Nothing recorded or changed yet: just close
    if (!hasRecording && seconds === 0 && !userEdited) return onDiscard();
    setConfirmDiscard(true);
  };

  let pill;
  if (phase === "editing") pill = { cls: "is-amber", text: "Paused · editing" };
  else if (!recording) pill = { cls: "is-gray", text: "Paused" };
  else if (live === "live") pill = { cls: "is-live", text: "Live · listening" };
  else if (live === "connecting") pill = { cls: "is-gray", text: "Connecting…" };
  else pill = { cls: "is-gray", text: "Recording · offline" };

  let placeholder = "";
  if (!text.trim() && !interim) {
    if (phase === "saving") placeholder = "Saving…";
    else if (!recording) placeholder = "Paused. Tap Continue to keep recording.";
    else if (live === "live") placeholder = "Listening… start talking.";
    else if (live === "connecting") placeholder = "Listening…";
    else placeholder = "Recording. Your words will be written down after you tap Done.";
  }

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
          placeholder={hasRecording ? "Type to fix or add to your notes." : "Type your notes here."}
          aria-label={`${info.label} text`}
          onChange={(e) => {
            textRef.current = e.target.value;
            setText(e.target.value);
            setUserEdited(true);
          }}
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
        <div className="rec-transcript" ref={transcriptBox} aria-live="polite">
          {(text.trim() || interim) && (
            <p className="rec-final">
              {text}
              {interim && <span className="rec-interim">{text.trim() ? " " : ""}{interim}</span>}
              {recording && live === "live" && <span className="rec-caret" aria-hidden="true" />}
            </p>
          )}
          {placeholder && <p className="rec-waiting">{placeholder}</p>}
          {recording && live === "offline" && text.trim() && (
            <p className="rec-waiting">Live words paused. Recording continues; the rest is written down after you tap Done.</p>
          )}
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
