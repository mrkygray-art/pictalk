import { useEffect, useState } from "react";
import { urlFor, stopText } from "./stopStore";
import { StopEngLine } from "./EngineeringPanel";

// "7:24 PM" for today, "Sep 28, 7:24 PM" for other days
function whenLabel(time) {
  const clock = time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (time.toDateString() === new Date().toDateString()) return clock;
  return `${time.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`;
}

// Where a stop's photo description is: "none" | "queued" | "offline" | "working" | "stuck" | "failed" | "described"
function photoDescState(stop, online) {
  if (stop.isPending) return stop.describePhoto ? "queued" : "none";
  switch (stop.photoDescStatus) {
    case "described":
    case "failed":
      return stop.photoDescStatus;
    case "requested":
    case "describing":
      if (!online) return "offline";
      // Normally takes seconds; after 5 minutes, offer to try again
      return Date.now() - (stop.photoDescRequestedAt || 0) > 5 * 60 * 1000 ? "stuck" : "working";
    default:
      return "none";
  }
}

// The AI's description of the photo, under the voice note. Before there is one,
// a dashed Describe photo button sits where it will appear.
function PhotoDescription({ stop, number, online, hasPhoto, actions }) {
  const state = photoDescState(stop, online);
  if (state === "none") {
    return hasPhoto ? (
      <button className="describe-btn" onClick={() => actions.onDescribe(stop)}>
        <SparkleIcon />
        Describe photo
      </button>
    ) : null;
  }
  if (state === "described") {
    return (
      <div className="stop-box photo-desc">
        <span className="stop-box-label">Photo description</span>
        <p>{stop.photoDescription}</p>
        <div className="stop-actions">
          <button className="stop-more" onClick={() => actions.onEdit(stop, number)}>
            Edit description
          </button>
          <button className="stop-more is-danger" onClick={() => actions.onDelete(stop, number)}>
            Delete
          </button>
        </div>
      </div>
    );
  }
  const problem = state === "failed" || state === "stuck";
  const text = {
    queued: "PicTalk will describe the photo once this stop uploads.",
    offline: "No signal right now. PicTalk will describe the photo when you're back online.",
    working: "Describing the photo…",
    stuck: "Couldn't describe the photo.",
    failed: stop.photoDescError || "Couldn't describe the photo.",
  }[state];
  return (
    <div className={`stop-box photo-desc is-${problem ? "problem" : "waiting"}`} role="status">
      <span className="stop-box-label">Photo description</span>
      <p>{text}</p>
      {problem && (
        <div className="stop-actions">
          <button className="stop-more" onClick={() => actions.onDescribe(stop)}>
            Try again
          </button>
          <button className="stop-more is-danger" onClick={() => actions.onDelete(stop, number)}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
    </svg>
  );
}

// One row in a list of stops. Each box holds the buttons for what's in it:
// the voice note (words, audio, Edit words), then the photo description;
// actions for the whole stop sit at the bottom.
// photoWaiting: a new photo is still on this phone (no Describe photo until it uploads)
function StopCard({ stop, anchor, number, time, photoUrl, photoWaiting, audioUrl, audioExpired, status, statusText, transcript, online, photoDesc, onSelect, onEdit }) {
  const hasVoice = transcript || audioUrl || audioExpired;
  const onPhoto = photoDesc?.onPhoto && stop ? () => photoDesc.onPhoto(stop, number, !!photoUrl) : null;
  return (
    <article className="stop" id={anchor ? `stop-${anchor}` : undefined}>
      {photoUrl && <img src={photoUrl} alt="" className="thumb" />}
      <div className="stop-info">
        <strong>Stop {number}</strong>
        <span>{whenLabel(time)}</span>
        <span className={`stop-status is-${status}`}>{statusText}</span>
        {hasVoice && (
          <div className="stop-box voice-box">
            <span className="stop-box-label">Voice note</span>
            {transcript && <p>{transcript}</p>}
            {audioUrl && <audio controls src={audioUrl} />}
            {audioExpired && <span className="stop-note">Recording expired</span>}
            {onEdit && (
              <div className="stop-actions">
                <button className="stop-more" onClick={onEdit}>
                  Edit words
                </button>
              </div>
            )}
          </div>
        )}
        {photoDesc && stop && (
          <PhotoDescription stop={stop} number={number} online={online} hasPhoto={!!photoUrl && !photoWaiting} actions={photoDesc} />
        )}
        {stop && <StopEngLine stop={stop} />}
        {(onSelect || onPhoto) && (
          <div className="stop-footer">
            {onPhoto && (
              <button className="stop-more stop-photo" onClick={onPhoto}>
                {photoUrl ? "Replace photo" : "Add photo"}
              </button>
            )}
            {onSelect && (
              <button className="stop-more stop-move" onClick={() => onSelect({ number, photoUrl })}>
                Move or delete this stop
              </button>
            )}
          </div>
        )}
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
function CloudStop({ stop, number, online, photoDesc, onSelect, onEdit }) {
  const localPhoto = photoDesc?.localPhotos?.get(stop.id) || null; // a new photo waiting on this phone
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
  if (localPhoto) {
    s.status = s.status === "problem" ? s.status : "pending";
    s.text = `${s.text} · ${online ? "New photo uploading…" : "New photo saved on this phone. Will upload when you're online."}`;
  }

  return (
    <StopCard
      stop={stop}
      anchor={stop.id}
      number={number}
      time={new Date(stop.clientCreatedAt)}
      photoUrl={localPhoto || urls.photo}
      photoWaiting={!!localPhoto}
      audioUrl={urls.audio}
      audioExpired={urls.loaded && stop.audioPath && !urls.audio}
      status={s.status}
      statusText={s.text}
      transcript={stopText(stop)}
      online={online}
      photoDesc={photoDesc}
      onSelect={onSelect}
      onEdit={onEdit}
    />
  );
}

// Phone-only and cloud stops together. Stops are numbered in the order they were
// taken (Stop 1 is the first); newestFirst only changes the display order.
// onSelect(stop, { number, photoUrl }) adds a "Move or delete this stop" button to each card.
// photoDesc { onDescribe(stop), onEdit(stop, number), onDelete(stop, number) } adds
// Describe photo and shows the photo description with its Edit and Delete buttons;
// its onPhoto(stop, number, hasPhoto) adds Add photo / Replace photo, and localPhotos
// (Map stop id -> preview link) shows new photos still waiting on this phone.
export function StopList({ stops, online, newestFirst = false, onSelect, onEdit, photoDesc }) {
  const inOrder = [...stops].sort((a, b) => a.clientCreatedAt - b.clientCreatedAt);
  const shown = newestFirst ? [...inOrder].reverse() : inOrder;
  const numberOf = new Map(inOrder.map((s, i) => [s.id, i + 1]));

  return shown.map((stop) => {
    const select = onSelect && ((info) => onSelect(stop, info));
    return stop.isPending ? (
      <StopCard
        key={stop.id}
        stop={stop}
        anchor={stop.id}
        number={numberOf.get(stop.id)}
        time={new Date(stop.clientCreatedAt)}
        photoUrl={stop.urls?.photo}
        audioUrl={stop.urls?.audio}
        status="pending"
        statusText={online ? "Uploading…" : "Saved on this phone. Will upload when you're online."}
        online={online}
        photoDesc={photoDesc}
        onSelect={select}
      />
    ) : (
      <CloudStop
        key={stop.id}
        stop={stop}
        number={numberOf.get(stop.id)}
        online={online}
        photoDesc={photoDesc}
        onSelect={select}
        // Words can be corrected once there's a transcript
        onEdit={onEdit && (stop.transcript || stop.editedTranscript != null) ? () => onEdit(stop, numberOf.get(stop.id)) : undefined}
      />
    );
  });
}
