import { useEffect, useRef, useState } from "react";
import WrapUpRecorder from "./WrapUpRecorder";
import {
  NOTE_TYPES, describeNote, formatDuration, queuePiece, saveNoteText, deleteNote, noteAudioUrls,
} from "./wrapUpStore";

const TypeIcon = ({ type }) =>
  type === "field" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );

const STATUS_TEXT = {
  "waiting-upload": "Waiting to upload",
  transcribing: "Writing it down…",
  "no-speech": "No speech heard",
  failed: "Couldn't write out the recording",
};

function NoteCard({ type, view, uid, jobId, note, pending, online, onReview }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const player = useRef(null);
  const queue = useRef([]);

  useEffect(() => () => player.current?.pause(), []);

  const stopPlaying = () => {
    player.current?.pause();
    queue.current.forEach((u) => u.local && URL.revokeObjectURL(u.url));
    queue.current = [];
    setPlaying(false);
  };

  const play = async () => {
    if (playing) return stopPlaying();
    setMessage("");
    const urls = await noteAudioUrls(note, pending);
    const playable = urls.filter((u) => u.url);
    if (!playable.length) return setMessage(online ? "The recording has expired. The text is kept." : "Playing needs signal.");
    queue.current = urls;
    let i = 0;
    const next = () => {
      if (i >= playable.length) return stopPlaying();
      const audio = new Audio(playable[i++].url); // pieces play one after another
      player.current = audio;
      audio.addEventListener("ended", next);
      audio.play().catch(() => stopPlaying());
    };
    setPlaying(true);
    next();
  };

  const remove = async () => {
    setBusy(true);
    try {
      stopPlaying();
      await deleteNote(uid, jobId, type);
    } catch (err) {
      setMessage(err?.message === "offline" ? "Deleting needs signal. Try again when you're online." : "Couldn't delete. Please try again.");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className={`note-card is-${type}`} id={`wrapup-${type}`}>
      <div className="note-card-head">
        <span className={`note-icon is-${type}`}><TypeIcon type={type} /></span>
        <strong>
          {NOTE_TYPES[type].label} · {formatDuration(view.durationSec)}
        </strong>
        {view.status === "ready" && (
          <span className="note-check" aria-label="Attached">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        )}
      </div>
      {view.text ? <p className="note-preview">{view.text}</p> : null}
      {STATUS_TEXT[view.status] && <p className="note-status">{STATUS_TEXT[view.status]}</p>}
      {message && <p className="note-status is-problem">{message}</p>}
      {confirmDelete ? (
        <div className="note-confirm">
          <p>Delete these notes? The recording and text will be gone for good.</p>
          <div className="note-actions">
            <button type="button" className="note-btn is-danger" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button type="button" className="note-btn" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="note-actions">
          <button type="button" className="note-btn" onClick={onReview}>
            Review / edit
          </button>
          <button type="button" className="note-btn" onClick={play}>
            {playing ? "Stop" : "Play audio"}
          </button>
          <button type="button" className="note-btn is-icon" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${NOTE_TYPES[type].label}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "Wrap-up notes" section: an Add button per type, or a card once that note exists.
 * data comes from useWrapUpNotes(uid, job.id).
 */
export default function WrapUpNotes({ uid, job, jobLabel, data, online, helper }) {
  const [recorder, setRecorder] = useState(null); // { type, mode }

  const finish = async (type, result) => {
    setRecorder(null);
    // If the user typed, their text (which already holds this session's live words) is
    // saved first; otherwise the server builds the text from the transcripts.
    if (result.userEdited) await saveNoteText(uid, job.id, type, result.text);
    if (result.blob) {
      await queuePiece({
        jobId: job.id,
        type,
        blob: result.blob,
        durationSec: result.durationSec,
        consentShown: result.consentShown,
        liveTranscript: result.liveTranscript,
        streamOk: result.streamOk,
        textIncluded: result.userEdited,
      });
    }
  };

  return (
    <section className="wrapup" aria-label="Wrap-up notes">
      <div className="wrapup-head">
        <h3>Wrap-up notes</h3>
        <span>Optional · while it's fresh</span>
      </div>
      {["field", "customer"].map((type) => {
        const note = data.notes[type];
        const pending = data.pending[type];
        const view = describeNote(note, pending);
        if (!view.exists) {
          return (
            <button key={type} type="button" className={`add-note is-${type}`} onClick={() => setRecorder({ type, mode: "record" })}>
              <span className={`note-icon is-${type}`}><TypeIcon type={type} /></span>
              <span className="add-note-label">{NOTE_TYPES[type].add}</span>
              <span className="add-note-plus" aria-hidden="true">+</span>
            </button>
          );
        }
        return (
          <NoteCard
            key={type}
            type={type}
            view={view}
            uid={uid}
            jobId={job.id}
            note={note}
            pending={pending}
            online={online}
            onReview={() => setRecorder({ type, mode: "edit" })}
          />
        );
      })}
      {helper && <p className="wrapup-help">{helper}</p>}

      {recorder && (
        <WrapUpRecorder
          type={recorder.type}
          jobLabel={jobLabel}
          mode={recorder.mode}
          initialText={describeNote(data.notes[recorder.type], data.pending[recorder.type]).text}
          consentNeeded={
            NOTE_TYPES[recorder.type].consent &&
            !data.notes[recorder.type]?.consentShown &&
            !data.pending[recorder.type].some((p) => p.consentShown)
          }
          onDone={(result) => finish(recorder.type, result)}
          onDiscard={() => setRecorder(null)}
        />
      )}
    </section>
  );
}
