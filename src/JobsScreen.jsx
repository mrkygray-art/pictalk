import { useState } from "react";
import { StopList } from "./StopCards";
import JobDetailsFields from "./JobDetailsFields";
import { jobTitle } from "./jobStore";
import JobSummary from "./JobSummary";
import WrapUpNotes from "./WrapUpNotes";
import useWrapUpNotes from "./useWrapUpNotes";

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

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 12v6M9.5 15.5 12 18l2.5-2.5" />
    </svg>
  );
}

function JobCard({ job, stops, isActive, onOpen }) {
  const voiceNotes = stops.filter((s) => s.audioPath || s.audioBlob).length;
  return (
    <button className={`job-card${isActive ? " is-live" : ""}`} onClick={onOpen}>
      <strong>
        {jobTitle(job)}
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

// Summary items can cite a wrap-up note instead of a stop
const NOTE_SOURCES = { field_notes: "wrapup-field", customer_comments: "wrapup-customer" };

// Scroll to a stop card (or wrap-up note card) and flash it (used by summary items)
function jumpToStop(id) {
  const el = document.getElementById(NOTE_SOURCES[id] || `stop-${id}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("is-flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("is-flash");
  return true;
}

function JobDetail({ uid, job, stops, isActive, online, autoSummary, onBack, onCamera, onReopen, onSaveDetails, onStopSelect, onStopEdit, photoDesc, onExport, onNotice, onSendToPiccolo }) {
  const notes = useWrapUpNotes(uid, job.id);
  const hasNotes = !!(notes.notes.field || notes.notes.customer || notes.pending.field.length || notes.pending.customer.length);
  return (
    <>
      <button className="link-btn" onClick={onBack}>
        <BackIcon />
        My Jobs
      </button>
      <JobHeading job={job} onSaveDetails={onSaveDetails} />
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
      <button className="big-btn plain-btn" onClick={() => onExport(job)} disabled={stops.length === 0 && !hasNotes}>
        <PdfIcon />
        Export PDF
      </button>
      {job.status !== "open" && onSendToPiccolo && (
        <button className="big-btn piccolo-send-btn" onClick={() => onSendToPiccolo(job.id)}>
          Open in Piccolo
        </button>
      )}
      {job.status !== "open" && (
        <JobSummary
          uid={uid}
          job={job}
          stops={[...stops].sort((a, b) => a.clientCreatedAt - b.clientCreatedAt)}
          online={online}
          autoStart={autoSummary}
          notes={notes}
          onJumpToStop={(id) => jumpToStop(id) || onNotice("That stop or note is no longer in this job.")}
        />
      )}
      <WrapUpNotes
        uid={uid}
        job={job}
        jobLabel={jobTitle(job)}
        data={notes}
        online={online}
        helper={hasNotes ? "Wrap-up notes go into the job summary." : null}
      />
      <section className="saved" aria-label="Stops in this job">
        <h2>
          Stops <span className="count">{plural(stops.length, "stop")}</span>
        </h2>
        {stops.length === 0 ? (
          <p className="empty">This job has no stops.</p>
        ) : (
          <>
            <p className="hint">Tap Move or delete this stop to put it in a different job.</p>
            <StopList stops={stops} online={online} onSelect={onStopSelect} onEdit={onStopEdit} photoDesc={photoDesc} />
          </>
        )}
      </section>
    </>
  );
}

// Job name, its Customer and Location, and an "Edit customer & location" form
function JobHeading({ job, onSaveDetails }) {
  const [draft, setDraft] = useState(null); // null = not editing

  if (draft === null) {
    return (
      <div className="job-name">
        <h1 className="page-title">{jobTitle(job)}</h1>
        {job.customer && <p className="meta">Customer: {job.customer}</p>}
        {job.location && <p className="meta">Location: {job.location}</p>}
        <button
          className="link-btn"
          onClick={() => setDraft({ customer: job.customer || "", location: job.location || "" })}
        >
          Edit customer &amp; location
        </button>
      </div>
    );
  }

  return (
    <form
      className="name-box"
      onSubmit={(e) => {
        e.preventDefault();
        onSaveDetails(job, draft);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
    >
      <h1 className="page-title">{jobTitle(job)}</h1>
      <JobDetailsFields customer={draft.customer} location={draft.location} onChange={setDraft} />
      <div className="name-actions">
        <button type="submit" className="save-btn">
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
export default function JobsScreen({
  uid, jobs, stops, activeJobId, online, initialJobId, autoSummaryJobId,
  onClose, onReopen, onSaveDetails, onStopSelect, onStopEdit, photoDesc, onExport, onNotice, onSendToPiccolo,
}) {
  const [openId, setOpenId] = useState(initialJobId ?? null);
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
        onSaveDetails={onSaveDetails}
        onStopSelect={onStopSelect}
        onStopEdit={onStopEdit}
        photoDesc={photoDesc}
        onExport={onExport}
        onNotice={onNotice}
        onSendToPiccolo={onSendToPiccolo}
        uid={uid}
        autoSummary={job.id === autoSummaryJobId}
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
