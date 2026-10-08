import { useEffect, useState } from "react";
import { watchJobs, jobTitle } from "../jobStore";

const day = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

// Piccolo: turns a finished PicTalk job into a work order, parts list (BOM), and quote.
// Phase 1 is the shell: it reads the same jobs as PicTalk (nothing is copied).
export default function PiccoloPane({ uid, isGuest, onAccount }) {
  const [jobs, setJobs] = useState({ uid: null, list: [] });
  useEffect(() => (uid ? watchJobs(uid, (list) => setJobs({ uid, list })) : undefined), [uid]);
  const finished = (jobs.uid === uid ? jobs.list : []).filter((j) => j.status === "finished");

  return (
    <main className="app piccolo">
      <header className="header">
        <h1>Piccolo</h1>
        <p className="subtitle">Turn a finished job into a work order, parts list, and quote.</p>
      </header>

      {isGuest && (
        <div className="piccolo-callout">
          <p>You're a guest. Save your work to keep your jobs and quotes in your account.</p>
          <button className="link-btn" onClick={onAccount}>
            Save my work
          </button>
        </div>
      )}

      <section aria-label="Finished jobs">
        <h2 className="section-title">Finished jobs</h2>
        {finished.length === 0 && <p className="empty">No finished jobs yet. Capture a job in PicTalk and tap End Job.</p>}
        {finished.map((j) => (
          <div key={j.id} className="job-card is-static">
            <strong>{jobTitle(j)}</strong>
            <span>Finished {day(j.endedAt || j.startedAt)}</span>
          </div>
        ))}
      </section>
      <p className="demo-note">Drafting work orders and quotes with AI is coming next.</p>
    </main>
  );
}
