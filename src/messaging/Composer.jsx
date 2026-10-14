import { useEffect, useRef, useState } from "react";
import { CameraIcon, MicIcon, StopIcon } from "./icons";
import { formatTime, useRecorder } from "./useRecorder";
import RecipientSearch from "./RecipientSearch";
import { DelaySheet, QuickReplyBar } from "./QuickReplyBar";
import { statusOf } from "./quickReplies";
import { SHOW_AI_PHOTO_DESCRIPTION } from "../features";
import {
  describePhoto, newId, photoPathFor, queueMessage, transcribeVoice, uploadFile, voicePathFor,
} from "./messagingStore";

const MAX_PHOTOS = 10;

// New Message (mode "new": To: first, then photos, voice, words, Send) and Reply (mode "reply":
// a quick reply and / or the same capture tools under a conversation). Send needs at least one tagged
// person (new) and a quick reply, a photo, a voice note, or words. Words for a voice note and the AI photo description come first when
// there's signal; neither ever blocks sending (with no signal, the server writes the words down later).
export default function Composer({ mode = "new", session, conversation = null, onSent, onCancel, quickReplies = false }) {
  const { project, me, dir, dirError, loadingDir, refreshDirectory } = session;
  const key = `${project.companyId}_${project.projectId}`;
  const ids = useRef({ cid: conversation?.id ?? newId(), mid: newId() });
  const [tagged, setTagged] = useState([]);
  const [searching, setSearching] = useState(mode === "new");
  const [photos, setPhotos] = useState([]); // [{ blob, url, path? }]
  const [voice, setVoice] = useState(null); // { blob, url, path? }
  const [transcript, setTranscript] = useState("");
  const [words, setWords] = useState(null); // null | "working" | "done" | "offline" | "failed"
  const [text, setText] = useState("");
  const [desc, setDesc] = useState(null); // null | { status: "working" | "done" | "failed", text }
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null); // a quick reply going with this message
  const [askDelay, setAskDelay] = useState(false);
  const pickReply = (r) => {
    if (status?.code === r.code) return setStatus(null);
    if (r.code === "delayed") return setAskDelay(true);
    setStatus(statusOf(r));
  };
  const fileInput = useRef(null);

  useEffect(() => () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    if (voice) URL.revokeObjectURL(voice.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A finished recording: upload it and get the words now if there's signal
  const recorder = useRecorder(async (blob) => {
    if (voice) URL.revokeObjectURL(voice.url);
    const v = { blob, url: URL.createObjectURL(blob) };
    setVoice(v);
    setTranscript("");
    if (!navigator.onLine) return setWords("offline");
    setWords("working");
    try {
      const path = await uploadFile(voicePathFor(key, ids.current.cid, ids.current.mid, blob.type), blob);
      setVoice({ ...v, path });
      const t = await transcribeVoice(key, path, blob.type);
      setTranscript(t);
      setWords(t ? "done" : "failed");
    } catch {
      setWords("failed");
    }
  });

  const addPhotos = (e) => {
    const files = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = "";
    if (files.length) setPhotos((list) => [...list, ...files.map((f) => ({ blob: f, url: URL.createObjectURL(f) }))]);
  };
  const removePhoto = (i) => {
    setPhotos((list) => {
      URL.revokeObjectURL(list[i].url);
      return list.filter((_, j) => j !== i);
    });
    if (i === 0) setDesc(null);
  };

  // Optional: describe the first photo with AI (editable, removable, never required)
  const describe = async () => {
    const first = photos[0];
    if (!first) return;
    setDesc({ status: "working", text: "" });
    try {
      const path = first.path ?? await uploadFile(photoPathFor(key, ids.current.cid, ids.current.mid, 1, first.blob.type), first.blob);
      setPhotos((list) => list.map((p, i) => (i === 0 ? { ...p, path } : p)));
      const t = await describePhoto(key, path, [text, transcript].filter(Boolean).join("\n"));
      setDesc(t ? { status: "done", text: t } : null);
    } catch {
      setDesc({ status: "failed", text: "" });
    }
  };

  const hasContent = photos.length > 0 || !!voice || text.trim() || transcript.trim() || !!status;
  const send = async () => {
    setError("");
    if (mode === "new" && !tagged.length) return setError("Tag at least one person first. Tap To: to pick who it's for.");
    if (!hasContent) return setError(quickReplies ? "Tap a quick reply, or add a photo, a voice note, or a few words." : "Add a photo, a voice note, or a few words.");
    if (recorder.recording) return setError("Stop the recording first.");
    setSending(true);
    try {
      await queueMessage({
        key,
        cid: ids.current.cid,
        mid: ids.current.mid,
        me,
        newConversation: mode === "new" ? { tagged } : null,
        text,
        transcript,
        transcriptDone: words === "done",
        photos: photos.map((p) => ({ blob: p.blob, path: p.path })),
        voice: voice ? { blob: voice.blob, path: voice.path } : null,
        aiDescription: desc?.status === "done" ? desc.text : null,
        status,
      });
      onSent?.(ids.current.cid);
    } catch {
      setError("Couldn't save this message. Please try again.");
      setSending(false);
    }
  };

  if (searching) {
    return (
      <section className="composer" aria-label="Who is this for?">
        <RecipientSearch
          dir={dir} dirError={dirError} loadingDir={loadingDir} onRefresh={refreshDirectory}
          projectName={project.name} selected={tagged} onChange={setTagged} onDone={() => setSearching(false)}
        />
        {!tagged.length && onCancel && <button type="button" className="text-btn" onClick={onCancel}>Cancel</button>}
      </section>
    );
  }

  return (
    <section className={`composer is-${mode}`} aria-label={mode === "new" ? "New message" : "Reply"}>
      {mode === "new" && (
        <button type="button" className="to-line to-btn" onClick={() => setSearching(true)}>
          <p>To: <strong>{tagged.length ? tagged.map((r) => r.name).join(", ") : "pick people"}</strong></p>
          <span className="stop-more">{tagged.length ? "Change" : "Pick"}</span>
        </button>
      )}
      {mode === "new" && tagged.length > 0 && (
        <p className="dir-meta">{tagged.length} {tagged.length === 1 ? "person" : "people"} tagged · <button type="button" className="text-btn inline" onClick={() => setTagged([])}>Clear</button></p>
      )}

      {quickReplies && (
        <>
          <QuickReplyBar onPick={pickReply} selected={status?.code ?? null} />
          {status && <p className="msg-status">Sending with: <strong>{[status.label, status.reason, status.newDate && `new date ${status.newDate}`].filter(Boolean).join(" · ")}</strong></p>}
          {askDelay && (
            <DelaySheet
              onClose={() => setAskDelay(false)}
              onSend={(extra) => { setStatus(statusOf({ code: "delayed", told: "Delayed" }, extra)); setAskDelay(false); }}
            />
          )}
        </>
      )}

      {photos.length > 0 && (
        <ul className="msg-photos">
          {photos.map((p, i) => (
            <li key={p.url}>
              <img src={p.url} alt={`Photo ${i + 1}`} />
              <button type="button" className="msg-photo-x" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={addPhotos} />
      <button type="button" className="big-btn photo-btn" onClick={() => fileInput.current.click()} disabled={photos.length >= MAX_PHOTOS || recorder.recording}>
        <CameraIcon />
        {photos.length ? "Add Photo" : "Take Photo"}
      </button>

      <button type="button" className={`big-btn talk-btn${recorder.recording ? " is-recording" : ""}`} onClick={recorder.toggle} aria-pressed={recorder.recording}>
        {recorder.recording ? <StopIcon /> : <MicIcon />}
        {recorder.recording ? `Stop  ${formatTime(recorder.seconds)}` : voice ? "Talk Again" : "Tap to Talk"}
      </button>
      {recorder.error && <p className="error" role="alert">{recorder.error}</p>}
      {voice && !recorder.recording && <audio controls src={voice.url} className="player" />}
      {words === "working" && <p className="msg-status">Writing it down…</p>}
      {words === "offline" && <p className="msg-status">No signal: the words will be written down after it sends.</p>}
      {words === "failed" && <p className="msg-status">Couldn't write down the words. You can still send the voice note, or type it below.</p>}
      {(words === "done" || (words === "failed" && transcript)) && (
        <label className="msg-field">
          <span>What you said (you can fix it)</span>
          <textarea className="words-field" value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} />
        </label>
      )}

      <label className="msg-field">
        <span>{mode === "new" ? "Add a note (optional)" : "Reply"}</span>
        <textarea className="words-field" value={text} onChange={(e) => setText(e.target.value)} rows={mode === "new" ? 3 : 2} placeholder="Type a message" />
      </label>

      {SHOW_AI_PHOTO_DESCRIPTION && photos.length > 0 && !desc && (
        <button type="button" className="describe-btn" onClick={describe} disabled={!navigator.onLine}>Describe photo with AI</button>
      )}
      {desc?.status === "working" && <p className="msg-status">Describing the photo…</p>}
      {desc?.status === "failed" && <p className="msg-status">Couldn't describe the photo. It sends without a description.</p>}
      {desc?.status === "done" && (
        <div className="stop-box photo-desc">
          <span className="stop-box-label">Photo description (AI)</span>
          <textarea className="words-field" value={desc.text} onChange={(e) => setDesc({ ...desc, text: e.target.value })} rows={3} />
          <button type="button" className="stop-more is-danger" onClick={() => setDesc(null)}>Remove description</button>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="save-btn msg-send" onClick={send} disabled={sending}>
        {sending ? "Sending…" : mode === "new" ? "Send" : "Send Reply"}
      </button>
      {onCancel && <button type="button" className="text-btn" onClick={onCancel}>Cancel</button>}
    </section>
  );
}
