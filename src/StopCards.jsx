import { useEffect, useState } from "react";
import { urlFor, stopText } from "./stopStore";
import { StopEngLine } from "./EngineeringPanel";

// "7:24 PM" for today, "Sep 28, 7:24 PM" for other days
function whenLabel(time) {
  const clock = time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (time.toDateString() === new Date().toDateString()) return clock;
  return `${time.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`;
}

// One row in a list of stops
function StopCard({ stop, anchor, number, time, photoUrl, audioUrl, audioExpired, status, statusText, transcript, onSelect, onEdit }) {
  return (
    <article className="stop" id={anchor ? `stop-${anchor}` : undefined}>
      {photoUrl && <img src={photoUrl} alt="" className="thumb" />}
      <div className="stop-info">
        <strong>Stop {number}</strong>
        <span>{whenLabel(time)}</span>
        <span className={`stop-status is-${status}`}>{statusText}</span>
        {transcript && <p className="stop-transcript">{transcript}</p>}
        {audioUrl && <audio controls src={audioUrl} />}
        {audioExpired && <span className="stop-note">Voice note expired</span>}
        {stop && <StopEngLine stop={stop} />}
        {(onEdit || onSelect) && (
          <div className="stop-actions">
            {onEdit && (
              <button className="stop-more" onClick={onEdit}>
                Edit words
              </button>
            )}
            {onSelect && (
              <button className="stop-more" onClick={() => onSelect({ number, photoUrl })}>
                Move or Delete
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
function CloudStop({ stop, number, onSelect, onEdit }) {
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
      stop={stop}
      anchor={stop.id}
      number={number}
      time={new Date(stop.clientCreatedAt)}
      photoUrl={urls.photo}
      audioUrl={urls.audio}
      audioExpired={urls.loaded && stop.audioPath && !urls.audio}
      status={s.status}
      statusText={s.text}
      transcript={stopText(stop)}
      onSelect={onSelect}
      onEdit={onEdit}
    />
  );
}

// Phone-only and cloud stops together. Stops are numbered in the order they were
// taken (Stop 1 is the first); newestFirst only changes the display order.
// onSelect(stop, { number, photoUrl }) adds a "Move or Delete" button to each card.
export function StopList({ stops, online, newestFirst = false, onSelect, onEdit }) {
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
        onSelect={select}
      />
    ) : (
      <CloudStop
        key={stop.id}
        stop={stop}
        number={numberOf.get(stop.id)}
        onSelect={select}
        // Words can be corrected once there's a transcript
        onEdit={onEdit && (stop.transcript || stop.editedTranscript != null) ? () => onEdit(stop, numberOf.get(stop.id)) : undefined}
      />
    );
  });
}
