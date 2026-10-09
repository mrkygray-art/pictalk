import { useEffect, useState } from "react";
import { watchJobs, jobTitle } from "../jobStore";
import { watchStops, getPendingStops, onQueueChange } from "../stopStore";
import PiccoloJob from "./PiccoloJob";
import { WorkOrderView, TeamBlock } from "./TeamViews";
import { watchOrg, createDemoJob, errorText } from "../accountStore";
import { watchTeamJobs, watchJobStops, canPrice } from "./piccoloStore";

const day = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const STATUS = { drafted: "AI draft ready", editing: "Being edited", finalized: "Finalized" };
const OPEN_KEY = "piccolo-open-job"; // "{ownerUid}/{jobId}": reopen the same job after a reload (this tab only)

function savedOpenJob() {
  try {
    return sessionStorage.getItem(OPEN_KEY);
  } catch {
    return null;
  }
}

function JobCard({ job, shared, onOpen }) {
  return (
    <button className="job-card" onClick={onOpen}>
      <strong>
        {jobTitle(job)}
        {job.isDemo && <span className="pill is-sample">Sample</span>}
        {STATUS[job.piccoloStatus] && <span className="pill">{STATUS[job.piccoloStatus]}</span>}
      </strong>
      <span>
        Finished {day(job.endedAt || job.startedAt)}
        {shared ? " · Shared with the team" : ""}
      </span>
    </button>
  );
}

// Piccolo: turns a finished PicTalk job into a work order, parts list (BOM), and quote.
// It reads the same jobs and stops as PicTalk (nothing is copied), plus jobs shared with
// the viewer's company. Admins and estimators get the full editor on those; field and
// installer roles get the price-free work order.
export default function PiccoloPane({ uid, isGuest, profile, target, onAccount, onOpenInPicTalk, onNotice }) {
  const orgId = profile?.status === "active" ? profile?.orgId || null : null;
  const [jobs, setJobs] = useState({ uid: null, list: [] });
  const [teamJobs, setTeamJobs] = useState({ key: null, list: [] });
  const [stops, setStops] = useState({ uid: null, list: [] });
  const [teamStops, setTeamStops] = useState({ key: null, list: [] });
  const [pending, setPending] = useState([]);
  const [openKey, setOpenKey] = useState(() => (target?.jobId && uid ? `${target.ownerUid || uid}/${target.jobId}` : savedOpenJob()));
  const [online, setOnline] = useState(navigator.onLine);
  const [org, setOrg] = useState(null);
  const [demo, setDemo] = useState({ busy: false, jobId: null, error: "" }); // "Try Piccolo"

  useEffect(() => (orgId ? watchOrg(orgId, setOrg) : undefined), [orgId]);
  useEffect(() => (uid ? watchJobs(uid, (list) => setJobs({ uid, list })) : undefined), [uid]);
  useEffect(() => (uid ? watchStops(uid, (list) => setStops({ uid, list })) : undefined), [uid]);
  const teamKey = uid && orgId ? `${uid}|${orgId}|${profile.role}` : null;
  useEffect(() => (teamKey ? watchTeamJobs(uid, profile, (list) => setTeamJobs({ key: teamKey, list })) : undefined), [teamKey]); // eslint-disable-line react-hooks/exhaustive-deps
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
      if (openKey) sessionStorage.setItem(OPEN_KEY, openKey);
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // remembered for this visit only
    }
  }, [openKey]);

  const own = (jobs.uid === uid ? jobs.list : []).map((j) => ({ ...j, ownerUid: uid }));
  const team = teamJobs.key === teamKey ? teamJobs.list : [];
  const finished = own.filter((j) => j.status === "finished");
  const teamFinished = team.filter((j) => j.status === "finished");
  const job = openKey && [...own, ...team].find((j) => `${j.ownerUid}/${j.id}` === openKey);
  const isTeamJob = !!job && job.ownerUid !== uid;
  const fullEditor = !!job && canPrice(job, uid, profile);

  // A teammate's stops (admins/estimators in the editor; field sees them in the work order view)
  const stopsKey = isTeamJob && fullEditor ? `${job.ownerUid}/${job.id}` : null;
  useEffect(
    () => (stopsKey ? watchJobStops(job.ownerUid, job.id, job.orgId, (list) => setTeamStops({ key: stopsKey, list })) : undefined),
    [stopsKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const open = (j) => {
    setOpenKey(j ? `${j.ownerUid}/${j.id}` : null);
    window.scrollTo(0, 0);
  };
  const orgName = orgId && org?.id === orgId ? org.name : null;

  // Try Piccolo: open the sample job (a random trade), or swap it for a different one
  const trySample = async (different) => {
    setDemo({ busy: true, jobId: null, error: "" });
    try {
      const { jobId, created } = await createDemoJob(different);
      setDemo({ busy: false, jobId: created ? jobId : null, error: "" });
      open({ id: jobId, ownerUid: uid });
    } catch (err) {
      setDemo({ busy: false, jobId: null, error: errorText(err) || "Couldn't open the sample. Please try again." });
      if (different) onNotice(errorText(err) || "Couldn't open another sample. Please try again.");
    }
  };

  // Piccolo needs an account (the server refuses guests too); PicTalk capture doesn't
  if (isGuest) {
    return (
      <main className="app piccolo">
        <header className="header">
          <h1>Piccolo</h1>
          <p className="subtitle">Turn a finished job into a work order, parts list, and quote.</p>
        </header>
        <div className="piccolo-callout is-try">
          <p>
            Sign in to use Piccolo. Your PicTalk jobs come with you, and Piccolo drafts the work order, parts, and quote from your photos and voice
            notes.
          </p>
          <button className="big-btn photo-btn" onClick={onAccount}>
            Sign In to Use Piccolo
          </button>
        </div>
      </main>
    );
  }

  if (job && !fullEditor) {
    return (
      <main className="app piccolo">
        <WorkOrderView job={job} role={profile?.role} orgName={orgName} onBack={() => open(null)} />
      </main>
    );
  }

  if (job) {
    const jobStops = isTeamJob
      ? teamStops.key === stopsKey ? teamStops.list : []
      : (stops.uid === uid ? stops.list : []).filter((s) => s.jobId === job.id);
    return (
      <main className="app piccolo">
        <PiccoloJob
          key={openKey}
          uid={uid}
          job={job}
          stops={jobStops}
          pendingStops={isTeamJob ? 0 : pending.filter((p) => p.jobId === job.id).length}
          autoDraft={!isTeamJob && ((target?.autoDraft && target.jobId === job.id) || demo.jobId === job.id)}
          online={online}
          isGuest={isGuest}
          orgName={orgName}
          teamControls={<TeamBlock uid={uid} job={job} profile={profile} orgName={orgName} onNotice={onNotice} />}
          onTryAnother={job.isDemo && !isTeamJob ? () => trySample(true) : null}
          tryingAnother={demo.busy}
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
        <p>
          New here? Try Piccolo on a sample site walk with photos and notes, from one of eight jobs: security, electrical, HVAC, plumbing, roofing,
          solar, painting, or a home appraisal.
        </p>
        {demo.error && <p className="error" role="alert">{demo.error}</p>}
        <button className="big-btn photo-btn" disabled={demo.busy || !uid} onClick={() => trySample(false)}>
          {demo.busy ? "Opening the sample…" : "Try Piccolo"}
        </button>
      </div>

      <section aria-label="Your finished jobs">
        <h2 className="section-title">{orgId ? "Your finished jobs" : "Finished jobs"}</h2>
        {finished.length === 0 && <p className="empty">No finished jobs yet. Capture a job in PicTalk and tap End Job.</p>}
        {finished.map((j) => (
          <JobCard key={j.id} job={j} shared={!!j.orgId} onOpen={() => open(j)} />
        ))}
      </section>

      {orgId && (
        <section aria-label="Team jobs">
          <h2 className="section-title">Team jobs{orgName ? ` · ${orgName}` : ""}</h2>
          {teamFinished.length === 0 && (
            <p className="empty">{profile.role === "installer" ? "No jobs are assigned to you yet." : "No finished team jobs yet."}</p>
          )}
          {teamFinished.map((j) => (
            <JobCard key={`${j.ownerUid}/${j.id}`} job={j} onOpen={() => open(j)} />
          ))}
        </section>
      )}
    </main>
  );
}
