import { useEffect, useRef, useState } from "react";
import { openMic } from "../micChoice";

// Tap to Talk: one recording at a time, the same audio formats as the capture screen
// (iPhone records mp4, Android / Chrome webm/opus).
function pickAudioType() {
  const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  if (!window.MediaRecorder) return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

export const formatTime = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

export function useRecorder(onDone) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const rec = useRef(null);
  const timer = useRef(null);
  const chunks = useRef([]);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => () => { clearInterval(timer.current); rec.current?.stream?.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    setError("");
    try {
      const stream = await openMic();
      const mimeType = pickAudioType();
      const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType });
        if (blob.size) done.current?.(blob);
      };
      r.start();
      rec.current = r;
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("SiteSnap AI needs your microphone. Tap Allow when your phone asks, or turn it on in your browser settings.");
    }
  };

  const stop = () => {
    rec.current?.stop();
    clearInterval(timer.current);
    setRecording(false);
  };

  return { recording, seconds, error, toggle: () => (recording ? stop() : start()) };
}
