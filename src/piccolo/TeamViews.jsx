import { useEffect, useState } from "react";
import Sheet from "../Sheet";
import { jobTitle } from "../jobStore";
import { stopText, photoText, urlFor } from "../stopStore";
import { canShareFile, deliverFile } from "../exportJob";
import { watchTeam, roleLabel, errorText } from "../accountStore";
import { watchWorkOrderView, watchJobStops, setJobSharing, assignJob } from "./piccoloStore";
import { exportSource, piccoloFileName } from "./piccoloExport";

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function Items({ title, items, answers }) {
  if (!items?.length) return null;
  return (
    <section className="pc-block">
      <h3>{title}</h3>
      <ul className="pc-items">
        {items.map((it, i) => (
          <li key={it.id || i}>
            {it.text}
            {answers && it.answered && it.answer && <p className="pc-answer">Answer: {it.answer}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Photo({ stop, number }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    if (stop.photoPath) urlFor(stop.photoPath).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [stop.photoPath]);
  return (
    <div className="pc-media">
      {url && <img src={url} alt={`Stop ${number}`} className="pc-photo" />}
      <div className="pc-media-text">
        <strong>Stop {number}</strong>
        {stopText(stop) && <p>{stopText(stop)}</p>}
        {photoText(stop) && <p className="pc-seen">Photo: {photoText(stop)}</p>}
      </div>
    </div>
  );
}

/**
 * Field and installer roles: the work order for a teammate's job, read-only and without
 * prices (it's a separate price-free copy, so prices never reach this phone). Field also
 * sees the photos and words; installers only the work order.
 */
export function WorkOrderView({ job, role, orgName, onBack }) {
  const [view, setView] = useState(undefined);
  const [stops, setStops] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const seesMedia = role === "field";
  useEffect(() => watchWorkOrderView(job.ownerUid, job.id, setView), [job.ownerUid, job.id]);
  useEffect(() => (seesMedia ? watchJobStops(job.ownerUid, job.id, job.orgId, setStops) : undefined), [seesMedia, job.ownerUid, job.id, job.orgId]);

  const sorted = [...stops].sort((a, b) => (a.clientCreatedAt || 0) - (b.clientCreatedAt || 0));
  const wo = view?.workOrder;
  const parts = (view?.bom || []).filter((l) => l.category !== "labor");

  const buildPdf = async () => {
    setBusy(true);
    try {
      const src = exportSource({ job, working: { workOrder: wo, bom: view.bom, quote: {}, questions: view.questions }, notes: {}, stops: [], orgName });
      src.watermark = job.piccoloStatus === "finalized" ? null : "DRAFT";
      const { renderPiccoloPdf } = await import("./renderPiccoloPdf");
      const blob = await renderPiccoloPdf(src, { workorder: true });
      setFile(new File([blob], piccoloFileName(src, "Work-Order", "pdf"), { type: "application/pdf" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="link-btn" onClick={onBack}>
        <BackIcon />
        Jobs
      </button>
      <h1 className="page-title">{jobTitle(job)}</h1>
      <p className="pc-hint">
        Work order · {roleLabel(role)} view · no prices
      </p>
      {view === undefined && <p className="pc-status">Loading…</p>}
      {view === null && <p className="empty">This job doesn't have a work order yet.</p>}
      {wo && (
        <>
          {wo.scope && (
            <section className="pc-block">
              <h3>Scope of work</h3>
              <p className="pc-text">{wo.scope}</p>
            </section>
          )}
          {(wo.locations || []).map((loc, i) => (
            <Items key={i} title={loc.name} items={loc.tasks} />
          ))}
          {parts.length > 0 && (
            <section className="pc-block">
              <h3>Devices and materials</h3>
              <ul className="pc-items">
                {parts.map((l) => (
                  <li key={l.id}>
                    {l.qty} {l.unit} · {l.description}
                    {l.partNumber ? ` · ${l.partNumber}` : ""}
                    {l.location ? ` (${l.location})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Items title="Installation notes" items={wo.installNotes} />
          <Items title="Customer requirements" items={wo.constraints} />
          <Items title="Open questions" items={view.questions} answers />
          {file ? (
            <button className="big-btn photo-btn" onClick={() => deliverFile(file, file.name, null, { download: !canShareFile(file) }).then(() => setFile(null))}>
              {canShareFile(file) ? "Share Work Order PDF" : "Download Work Order PDF"}
            </button>
          ) : (
            <button className="big-btn plain-btn" onClick={buildPdf} disabled={busy}>
              {busy ? "Building PDF…" : "Work Order PDF"}
            </button>
          )}
        </>
      )}
      {seesMedia && sorted.length > 0 && (
        <section aria-label="Photos and voice notes">
          <h2 className="section-title">Photos and notes</h2>
          {sorted.map((s, i) => (
            <Photo key={s.id} stop={s} number={i + 1} />
          ))}
        </section>
      )}
    </>
  );
}

/** Owner: share with the company or stop. Admin: who's assigned. Shown on the Overview tab. */
export function TeamBlock({ uid, job, profile, orgName, onNotice }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const isOwner = (job.ownerUid || uid) === uid;
  const onTeam = profile?.tier === "team" && profile?.status === "active" && !!profile?.orgId;
  if (!onTeam || job.isDemo) return null;
  const shared = !!job.orgId;
  const isAdmin = profile.role === "admin" && job.orgId === profile.orgId;

  const toggle = async () => {
    setBusy(true);
    try {
      await setJobSharing(job.id, !shared);
      onNotice(shared ? "Only you can see this job now" : `Shared with ${orgName || "your team"}`);
    } catch (err) {
      onNotice(errorText(err) || "Couldn't change sharing. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pc-block">
      <h3>Team</h3>
      <p className="pc-text">{shared ? `Shared with ${orgName || "your team"}.` : "Only you can see this job."}</p>
      {shared && <p className="pc-hint">Field techs see the work order without prices; installers only see jobs assigned to them.</p>}
      {isAdmin && (
        <p className="pc-text">
          {job.assignedTo?.length ? `Assigned to ${job.assignedTo.length} ${job.assignedTo.length === 1 ? "person" : "people"}.` : "Not assigned to anyone."}{" "}
          <button className="link-btn" onClick={() => setPicking(true)}>
            Assign
          </button>
        </p>
      )}
      {isOwner && (
        <button className="big-btn plain-btn" onClick={toggle} disabled={busy}>
          {shared ? "Stop Sharing" : `Share with ${orgName || "Your Team"}`}
        </button>
      )}
      {picking && <AssignSheet job={job} orgId={profile.orgId} onNotice={onNotice} onClose={() => setPicking(false)} />}
    </section>
  );
}

function AssignSheet({ job, orgId, onNotice, onClose }) {
  const [team, setTeam] = useState([]);
  const [chosen, setChosen] = useState(() => new Set(job.assignedTo || []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => watchTeam(orgId, setTeam), [orgId]);
  const people = team.filter((p) => p.status === "active");
  return (
    <Sheet title="Assign this job" onClose={() => !busy && onClose()}>
      <p>Installers only see jobs assigned to them. Everyone else on the team already sees shared jobs.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <fieldset className="pc-checks">
        <legend>Team</legend>
        {people.map((p) => (
          <label key={p.uid}>
            <input
              type="checkbox"
              checked={chosen.has(p.uid)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(p.uid);
                else next.delete(p.uid);
                setChosen(next);
              }}
            />
            {p.displayName || p.email} · {roleLabel(p.role)}
          </label>
        ))}
      </fieldset>
      <button
        className="save-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await assignJob(job.ownerUid, job.id, [...chosen]);
            onNotice("Assignments saved");
            onClose();
          } catch (err) {
            setError(errorText(err) || "Couldn't save. Please try again.");
            setBusy(false);
          }
        }}
      >
        Save
      </button>
      <button className="text-btn" onClick={onClose} disabled={busy}>
        Cancel
      </button>
    </Sheet>
  );
}
