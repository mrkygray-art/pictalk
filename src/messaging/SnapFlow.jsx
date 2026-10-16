import { useCallback, useEffect, useState } from "react";
import { MicIcon, StopIcon } from "./icons";
import { formatTime, useRecorder } from "./useRecorder";
import { transcribeVoice, uploadFile } from "./messagingStore";
import { loadAlbums, dayOf } from "./photosStore";
import { lastSavedPhoto, onPhotoQueueChange, pendingPhotos, queuePhoto, retryPhoto, voicePathForPhoto } from "./photoQueue";

// Snap (docs/sitesnap-project-home-and-photos-spec.md 2.2): the photo is already taken (the Snap button opens the
// camera straight away). Optional voice note or typed words, the album (that day's "Field photos" album unless
// another is picked), Save Photo. The photo is kept on the phone until Procore has it.
export default function SnapFlow({ session, photo, timeZone, onSnapAnother, onDone }) {
  const { project, me } = session;
  const key = `${project.companyId}_${project.projectId}`;
  const [captureId] = useState(() => crypto.randomUUID());
  // Each preview <img> gets its own link to the photo, let go once it has drawn (no copies left in memory)
  const showPhoto = useCallback((el) => {
    if (!el) return;
    const url = URL.createObjectURL(photo);
    el.onload = el.onerror = () => URL.revokeObjectURL(url);
    el.src = url;
  }, [photo]);
  const [voice, setVoice] = useState(null); // { blob, url, path? }
  const [words, setWords] = useState("");
  const [wordsState, setWordsState] = useState(null); // null | working | done | failed | offline
  const [albums, setAlbums] = useState(null); // public albums, for Change
  const [albumId, setAlbumId] = useState(null); // null = that day's album
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("edit"); // edit | saving | saved | waiting | failed
  const [result, setResult] = useState(null); // { albumName } | { error }
  const today = `Field photos ${dayOf(new Date().toISOString(), timeZone)}`;

  useEffect(() => () => { if (voice) URL.revokeObjectURL(voice.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const recorder = useRecorder(async (blob) => {
    if (voice) URL.revokeObjectURL(voice.url);
    const v = { blob, url: URL.createObjectURL(blob) };
    setVoice(v);
    if (!navigator.onLine) return setWordsState("offline");
    setWordsState("working");
    try {
      const path = await uploadFile(voicePathForPhoto(key, captureId, blob.type), blob);
      setVoice({ ...v, path });
      const t = await transcribeVoice(key, path, blob.type);
      setWords((w) => [w.trim(), t].filter(Boolean).join(" "));
      setWordsState(t ? "done" : "failed");
    } catch {
      setWordsState("failed");
    }
  });

  // After Save: follow this photo until Procore has it (or says no)
  useEffect(() => {
    if (stage === "edit") return undefined;
    const check = async () => {
      const saved = lastSavedPhoto();
      if (saved?.captureId === captureId) { setStage("saved"); setResult({ albumName: saved.albumName }); return; }
      const mine = (await pendingPhotos(key)).find((p) => p.captureId === captureId);
      if (!mine) return;
      if (mine.status === "failed") { setStage("failed"); setResult({ error: mine.error }); }
      else if (!navigator.onLine || mine.attempts > 0) setStage("waiting");
    };
    check();
    return onPhotoQueueChange(check);
  }, [stage, captureId, key]);

  const openPicker = () => {
    setPicking(true);
    if (!albums) loadAlbums(project).then((a) => setAlbums(a.filter((x) => !x.private))).catch((e) => { setAlbums([]); setError(e.message); });
  };
  const albumLabel = albumId ? albums?.find((a) => a.id === albumId)?.name ?? "Picked album" : today;

  const save = async () => {
    setError("");
    setStage("saving");
    try {
      await queuePhoto({
        captureId, project, albumId, albumLabel, words, by: me.name, photo,
        voice: voice?.blob ?? null, voicePath: voice?.path ?? null,
        wordsPending: !!voice && !voice.path && wordsState === "offline" && !words.trim(),
      });
    } catch (err) {
      setStage("edit");
      setError(err.message);
    }
  };

  if (stage !== "edit") {
    return (
      <section className="snap" aria-label="Photo saved">
        <img className="snap-preview is-small" ref={showPhoto} alt="The photo" />
        {stage === "saving" && <p className="msg-status" role="status">Saving to Procore…</p>}
        {stage === "saved" && <p className="snap-done" role="status">Saved to {result.albumName}</p>}
        {stage === "waiting" && <p className="snap-done is-waiting" role="status">Saved on this phone. It goes to Procore ({albumLabel}) when you have signal.</p>}
        {stage === "failed" && (
          <>
            <p className="error" role="alert">{result.error}</p>
            <button type="button" className="stop-more" onClick={() => { setStage("saving"); retryPhoto(captureId); }}>Try Again</button>
          </>
        )}
        <button type="button" className="big-btn photo-btn" onClick={onSnapAnother}>Snap Another</button>
        <button type="button" className="text-btn" onClick={onDone}>Done</button>
      </section>
    );
  }

  return (
    <section className="snap" aria-label="Save a photo">
      <h2 className="page-title">Save Photo</h2>
      <img className="snap-preview" ref={showPhoto} alt="The photo you took" />
      <button type="button" className={`big-btn talk-btn${recorder.recording ? " is-recording" : ""}`} onClick={recorder.toggle} aria-pressed={recorder.recording}>
        {recorder.recording ? <StopIcon /> : <MicIcon />}
        {recorder.recording ? `Stop  ${formatTime(recorder.seconds)}` : voice ? "Talk Again" : "Tap to Talk (optional)"}
      </button>
      {recorder.error && <p className="error" role="alert">{recorder.error}</p>}
      {voice && !recorder.recording && <audio controls src={voice.url} className="player" />}
      {wordsState === "working" && <p className="msg-status">Writing it down…</p>}
      {wordsState === "offline" && <p className="msg-status">No signal: the words are written down when it uploads, or type them below.</p>}
      {wordsState === "failed" && <p className="msg-status">Couldn't write down the words. Type them below if you like.</p>}
      <label className="msg-field"><span>What it shows (optional)</span>
        <textarea className="words-field" rows={3} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Or type it here" />
      </label>

      <div className="snap-album">
        <div>
          <small>Album</small>
          <strong>{albumId ? albumLabel : `Today's album (${today})`}</strong>
        </div>
        {!picking && <button type="button" className="stop-more" onClick={openPicker}>Change</button>}
      </div>
      {picking && (
        <ul className="snap-albums" aria-label="Pick an album">
          <li><button type="button" className={albumId === null ? "is-on" : ""} onClick={() => { setAlbumId(null); setPicking(false); }}>Today's album ({today})</button></li>
          {!albums && <li className="ph-muted">Loading albums…</li>}
          {(albums ?? []).filter((a) => a.name !== today).map((a) => (
            <li key={a.id}><button type="button" className={albumId === a.id ? "is-on" : ""} onClick={() => { setAlbumId(a.id); setPicking(false); }}>{a.name} <small>{a.count} photo{a.count === 1 ? "" : "s"}</small></button></li>
          ))}
        </ul>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="save-btn" onClick={save} disabled={recorder.recording || wordsState === "working"}>Save Photo</button>
      <button type="button" className="text-btn" onClick={onDone}>Cancel</button>
    </section>
  );
}
