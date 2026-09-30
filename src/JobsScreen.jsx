import { useState } from "react";
import { StopList } from "./StopCards";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const day = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function JobCard({ job, stops, isActive, onOpen }) {
  const voiceNotes = stops.filter((s) => s.audioPath || s.audioBlob).length;
  return (
    <button className={`job-card${isActive ? " is-live" : ""}`} onClick={onOpen}>
      <strong>
        {job.name}
        {isActive && <span className="pill">Open now</span>}
      </strong>
      <span>
        {plural(stops.length, "stop")}, {plural(voiceNotes, "voice note")}
      </span>
      <span>
        Started {day(job.startedAt)} at {clock(job.startedAt)}
      </span>
    </button>
  );
}

function JobDetail({ job, stops, isActive, online, onBack, onCamera, onReopen, onRename, onStopSelect }) {
  return (
    <>
      <button className="link-btn" onClick={onBack}>
        <BackIcon />
        My Jobs
      </button>
      <JobName job={job} onRename={onRename} />
      {job.address && <p className="meta">Location: {job.address}</p>}
      <p className="meta">
        Started {day(job.startedAt)} at {clock(job.startedAt)}
        {job.endedAt ? `. Finished ${day(job.endedAt)} at ${clock(job.endedAt)}` : ""}
      </p>
      {isActive && (
        <button className="big-btn photo-btn" onClick={onCamera}>
          Back to Camera
        </button>
      )}
      {job.status !== "open" && (
        <button className="big-btn plain-btn" onClick={() => onReopen(job)}>
          Reopen This Job
        </button>
      )}
      <section className="saved" aria-label="Stops in this job">
        <h2>
          Stops <span className="count">{plural(stops.length, "stop")}</span>
        </h2>
        {stops.length === 0 ? (
          <p className="empty">This job has no stops.</p>
        ) : (
          <>
            <p className="hint">Tap Move or Delete on a stop to put it in a different job.</p>
            <StopList stops={stops} online={online} onSelect={onStopSelect} />
          </>
        )}
      </section>
    </>
  );
}

// Job name as a heading, with an Edit name button that swaps in a text box
function JobName({ job, onRename }) {
  const [draft, setDraft] = useState(null); // null = not editing

  const save = () => {
    const name = draft.trim();
    if (name && name !== job.name) onRename(job, name);
    setDraft(null);
  };

  if (draft === null) {
    return (
      <div className="job-name">
        <h1 className="page-title">{job.name}</h1>
        <button className="link-btn" onClick={() => setDraft(job.name)}>
          Edit name
        </button>
      </div>
    );
  }

  return (
    <form
      className="name-box"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor="job-name-input" className="meta">
        Job name
      </label>
      <input
        id="job-name-input"
        value={draft}
        maxLength={200}
        autoComplete="off"
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
      />
      <div className="name-actions">
        <button type="submit" className="save-btn" disabled={!draft.trim()}>
          Save
        </button>
        <button type="button" className="big-btn plain-btn" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** My Jobs list, and the page for one job. */
export default function JobsScreen({ jobs, stops, activeJobId, online, onClose, onReopen, onRename, onStopSelect }) {
  const [openId, setOpenId] = useState(null);
  const stopsOf = (id) => stops.filter((s) => s.jobId === id);
  const go = (id) => {
    setOpenId(id);
    window.scrollTo(0, 0);
  };

  const job = openId && jobs.find((j) => j.id === openId);
  if (job) {
    return (
      <JobDetail
        job={job}
        stops={stopsOf(job.id)}
        isActive={job.id === activeJobId}
        online={online}
        onBack={() => go(null)}
        onCamera={onClose}
        onReopen={onReopen}
        onRename={onRename}
        onStopSelect={onStopSelect}
      />
    );
  }

  const card = (j) => (
    <JobCard key={j.id} job={j} stops={stopsOf(j.id)} isActive={j.id === activeJobId} onOpen={() => go(j.id)} />
  );
  const open = jobs.filter((j) => j.status === "open");
  const finished = jobs.filter((j) => j.status !== "open");

  return (
    <>
      <button className="link-btn" onClick={onClose}>
        <BackIcon />
        Camera
      </button>
      <h1 className="page-title">My Jobs</h1>
      {jobs.length === 0 && <p className="empty">No jobs yet. Go back and tap Start New Job.</p>}
      {open.length > 0 && (
        <section className="job-group" aria-label="Open jobs">
          <h2>Open</h2>
          {open.map(card)}
        </section>
      )}
      {finished.length > 0 && (
        <section className="job-group" aria-label="Finished jobs">
          <h2>Finished</h2>
          {finished.map(card)}
        </section>
      )}
    </>
  );
}
