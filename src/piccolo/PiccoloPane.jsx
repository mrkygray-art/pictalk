import { useEffect, useState } from "react";
import { watchJobs, jobTitle } from "../jobStore";
import { watchStops, getPendingStops, onQueueChange } from "../stopStore";
import PiccoloJob from "./PiccoloJob";

const day = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const STATUS = { drafted: "AI draft ready", editing: "Being edited", finalized: "Finalized" };

// Piccolo: turns a finished PicTalk job into a work order, parts list (BOM), and quote.
// It reads the same jobs and stops as PicTalk (nothing is copied).
export default function PiccoloPane({ uid, isGuest, target, onAccount, onOpenInPicTalk, onNotice }) {
  const [jobs, setJobs] = useState({ uid: null, list: [] });
  const [stops, setStops] = useState({ uid: null, list: [] });
  const [pending, setPending] = useState([]);
  const [openId, setOpenId] = useState(target?.jobId ?? null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => (uid ? watchJobs(uid, (list) => setJobs({ uid, list })) : undefined), [uid]);
  useEffect(() => (uid ? watchStops(uid, (list) => setStops({ uid, list })) : undefined), [uid]);
  useEffect(() => {
    const refresh = () => getPendingStops().then(setPending);
    refresh();
    return onQueueChange(refresh);
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const list = jobs.uid === uid ? jobs.list : [];
  const finished = list.filter((j) => j.status === "finished");
  const job = openId && list.find((j) => j.id === openId);
  const open = (id) => {
    setOpenId(id);
    window.scrollTo(0, 0);
  };

  if (job) {
    return (
      <main className="app piccolo">
        <PiccoloJob
          key={job.id}
          uid={uid}
          job={job}
          stops={(stops.uid === uid ? stops.list : []).filter((s) => s.jobId === job.id)}
          pendingStops={pending.filter((p) => p.jobId === job.id).length}
          autoDraft={target?.autoDraft && target.jobId === job.id}
          online={online}
          onBack={() => open(null)}
          onOpenInPicTalk={onOpenInPicTalk}
          onNotice={onNotice}
        />
      </main>
    );
  }

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
          <button key={j.id} className="job-card" onClick={() => open(j.id)}>
            <strong>
              {jobTitle(j)}
              {STATUS[j.piccoloStatus] && <span className="pill">{STATUS[j.piccoloStatus]}</span>}
            </strong>
            <span>Finished {day(j.endedAt || j.startedAt)}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
