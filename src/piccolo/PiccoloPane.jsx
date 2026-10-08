import { useEffect, useState } from "react";
import { watchJobs, jobTitle } from "../jobStore";
import { watchStops, getPendingStops, onQueueChange } from "../stopStore";
import PiccoloJob from "./PiccoloJob";
import { watchOrg, createDemoJob, errorText } from "../accountStore";

const day = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const STATUS = { drafted: "AI draft ready", editing: "Being edited", finalized: "Finalized" };
const OPEN_KEY = "piccolo-open-job"; // reopen the same job after a reload (this tab only)

function savedOpenJob() {
  try {
    return sessionStorage.getItem(OPEN_KEY);
  } catch {
    return null;
  }
}

// Piccolo: turns a finished PicTalk job into a work order, parts list (BOM), and quote.
// It reads the same jobs and stops as PicTalk (nothing is copied).
export default function PiccoloPane({ uid, isGuest, orgId, target, onAccount, onOpenInPicTalk, onNotice }) {
  const [jobs, setJobs] = useState({ uid: null, list: [] });
  const [stops, setStops] = useState({ uid: null, list: [] });
  const [pending, setPending] = useState([]);
  const [openId, setOpenId] = useState(() => target?.jobId ?? savedOpenJob());
  const [online, setOnline] = useState(navigator.onLine);
  const [org, setOrg] = useState(null);
  const [demo, setDemo] = useState({ busy: false, jobId: null, error: "" }); // "Try Piccolo"

  useEffect(() => (orgId ? watchOrg(orgId, setOrg) : undefined), [orgId]);

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

  useEffect(() => {
    try {
      if (openId) sessionStorage.setItem(OPEN_KEY, openId);
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // remembered for this visit only
    }
  }, [openId]);

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
          autoDraft={(target?.autoDraft && target.jobId === job.id) || demo.jobId === job.id}
          online={online}
          isGuest={isGuest}
          orgName={orgId && org?.id === orgId ? org.name : null}
          onAccount={onAccount}
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

      <div className="piccolo-callout is-try">
        <p>New here? Try Piccolo on a sample site walk: a dental office with a cracked card reader, two cameras, and a network closet.</p>
        {demo.error && <p className="error" role="alert">{demo.error}</p>}
        <button
          className="big-btn photo-btn"
          disabled={demo.busy || !uid}
          onClick={async () => {
            setDemo({ busy: true, jobId: null, error: "" });
            try {
              const { jobId, created } = await createDemoJob();
              setDemo({ busy: false, jobId: created ? jobId : null, error: "" });
              open(jobId);
            } catch (err) {
              setDemo({ busy: false, jobId: null, error: errorText(err) || "Couldn't open the sample. Please try again." });
            }
          }}
        >
          {demo.busy ? "Opening the sample…" : "Try Piccolo"}
        </button>
      </div>

      <section aria-label="Finished jobs">
        <h2 className="section-title">Finished jobs</h2>
        {finished.length === 0 && <p className="empty">No finished jobs yet. Capture a job in PicTalk and tap End Job.</p>}
        {finished.map((j) => (
          <button key={j.id} className="job-card" onClick={() => open(j.id)}>
            <strong>
              {jobTitle(j)}
              {j.isDemo && <span className="pill is-sample">Sample</span>}
              {STATUS[j.piccoloStatus] && <span className="pill">{STATUS[j.piccoloStatus]}</span>}
            </strong>
            <span>Finished {day(j.endedAt || j.startedAt)}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
