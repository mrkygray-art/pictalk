import { useEffect, useRef, useState } from "react";
import Sheet from "../Sheet";
import JobDetailsFields from "../JobDetailsFields";
import { jobTitle, setJobDetails } from "../jobStore";
import { stopText, photoText, urlFor } from "../stopStore";
import { watchNotes, saveNoteText } from "../wrapUpStore";
import { watchSummary, hasSummary, saveSummaryEdits, isTranscriptPending } from "../summaryStore";
import { watchLatestDraft, watchWorking, applyDraft, requestDraft, captureChangedSince, money, quoteTotals } from "./piccoloStore";

const TABS = [
  ["overview", "Overview"],
  ["workorder", "Work Order"],
  ["bom", "Parts (BOM)"],
  ["quote", "Quote"],
  ["media", "Media"],
];
const NOTE_LABELS = { field_notes: "Field notes", customer_comments: "Customer notes", summary: "Summary" };

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

// One text box, Save or Cancel (summary, field notes, customer notes)
function EditTextSheet({ title, initial, maxLength, onSave, onClose }) {
  const [text, setText] = useState(initial);
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(text.trim());
        }}
      >
        <textarea className="words-field" value={text} rows={8} maxLength={maxLength} aria-label={title} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="save-btn">
          Save
        </button>
        <button type="button" className="big-btn plain-btn" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}

// Where a line came from: tap to see that stop (or note)
function Sources({ ids, stopNumber, onJump }) {
  if (!ids?.length) return null;
  return (
    <div className="src-chips">
      {ids.map((id) => (
        <button key={id} className="src-chip" onClick={() => onJump(id)}>
          {NOTE_LABELS[id] || (stopNumber[id] ? `Stop ${stopNumber[id]}` : "Stop")}
        </button>
      ))}
    </div>
  );
}

function TextBlock({ label, text, empty, onEdit, id }) {
  return (
    <section className="pc-block" id={id}>
      <div className="pc-block-head">
        <h3>{label}</h3>
        {onEdit && (
          <button className="link-btn" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      {text ? <p className="pc-text">{text}</p> : <p className="pc-empty">{empty}</p>}
    </section>
  );
}

function ItemList({ title, items, stopNumber, onJump }) {
  if (!items?.length) return null;
  return (
    <section className="pc-block">
      <h3>{title}</h3>
      <ul className="pc-items">
        {items.map((it, i) => (
          <li key={i}>
            {it.text}
            <Sources ids={it.sourceIds} stopNumber={stopNumber} onJump={onJump} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LineCard({ line, stopNumber, onJump, showPrice }) {
  const priced = Number.isFinite(line.unitPrice);
  return (
    <div className={`pc-line${line.source?.basis === "inferred" ? " is-inferred" : ""}`}>
      <div className="pc-line-top">
        <strong>{line.description}</strong>
        <span className="pc-qty">
          {line.qty} {line.unit}
        </span>
      </div>
      <div className="pc-badges">
        {line.source?.basis === "inferred" && <span className="badge is-warn">Inferred · check</span>}
        {line.source?.basis === "seen_in_photo" && <span className="badge">Seen in photo</span>}
        {line.partNumberStatus === "ai_suggested" && <span className="badge is-warn">Verify part #</span>}
        {line.priceSource === "ai_estimate" && <span className="badge is-warn">ESTIMATE</span>}
        {!priced && <span className="badge is-muted">Needs price</span>}
      </div>
      {line.partNumber && <p className="pc-meta">Part #: {line.partNumber}</p>}
      {line.location && <p className="pc-meta">Where: {line.location}</p>}
      {line.notes && <p className="pc-meta">{line.notes}</p>}
      {line.source?.quote && <p className="pc-quote">“{line.source.quote}”</p>}
      {showPrice && priced && (
        <p className="pc-meta">
          {money(line.unitPrice)} each · {money(line.unitPrice * line.qty)}
        </p>
      )}
      <Sources ids={line.source?.stopIds} stopNumber={stopNumber} onJump={onJump} />
    </div>
  );
}

function MediaStop({ stop, number }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    if (stop.photoPath) urlFor(stop.photoPath).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [stop.photoPath]);
  const words = stopText(stop);
  const seen = photoText(stop);
  return (
    <div className="pc-media" id={`pc-stop-${stop.id}`}>
      {url && <img src={url} alt={`Stop ${number}`} className="pc-photo" />}
      <div className="pc-media-text">
        <strong>Stop {number}</strong>
        <p>{words || (stop.audioPath ? "No words in this voice note." : "No voice note.")}</p>
        {seen && <p className="pc-seen">Photo: {seen}</p>}
      </div>
    </div>
  );
}

/** One job in Piccolo: draft with AI, then the work order, BOM, quote, and media. */
export default function PiccoloJob({ uid, job, stops, pendingStops, autoDraft, online, onBack, onOpenInPicTalk, onNotice }) {
  const [tab, setTab] = useState("overview");
  const [working, setWorking] = useState(undefined); // undefined = loading, null = none yet
  const [latest, setLatest] = useState(undefined);
  const [notes, setNotes] = useState({});
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // "details" | "summary" | "field" | "customer"
  const [keptVersion, setKeptVersion] = useState(null); // "Keep current" for this newer draft
  const autoTried = useRef(false);

  useEffect(() => watchWorking(uid, job.id, setWorking), [uid, job.id]);
  useEffect(() => watchLatestDraft(uid, job.id, setLatest), [uid, job.id]);
  useEffect(() => watchNotes(uid, job.id, setNotes), [uid, job.id]);
  useEffect(() => watchSummary(uid, job.id, setSummary), [uid, job.id]);

  const sorted = [...stops].sort((a, b) => (a.clientCreatedAt || 0) - (b.clientCreatedAt || 0));
  const stopNumber = Object.fromEntries(sorted.map((s, i) => [s.id, i + 1]));
  const waiting = pendingStops + sorted.filter((s) => isTranscriptPending(s)).length;
  const loaded = working !== undefined && latest !== undefined;

  const draft = async () => {
    setBusy(true);
    setError("");
    try {
      const { version } = await requestDraft(job.id);
      onNotice(version > 1 ? `Draft ${version} is ready` : "Draft is ready");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Sent from End Job: draft once everything has uploaded and been written down
  useEffect(() => {
    if (!autoDraft || autoTried.current || !loaded || working || latest || waiting || !online) return;
    autoTried.current = true;
    draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraft, loaded, working, latest, waiting, online]);

  const jump = (id) => {
    const target = NOTE_LABELS[id] ? `pc-note-${id}` : `pc-stop-${id}`;
    setTab(NOTE_LABELS[id] ? "overview" : "media");
    setTimeout(() => {
      const el = document.getElementById(target);
      if (!el) return onNotice("That stop or note is no longer in this job.");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("is-flash");
      void el.offsetWidth; // restart the animation
      el.classList.add("is-flash");
    }, 60);
  };

  const newer = working && latest && latest.id !== working.draftId && latest.version > (working.draftVersion || 0) && keptVersion !== latest.version;
  const changed = latest && captureChangedSince(latest, { stops: sorted, notes });
  const bom = working?.bom || [];
  const parts = bom.filter((l) => l.category !== "labor");
  const totals = quoteTotals(bom, working?.quote);
  const wo = working?.workOrder;

  return (
    <>
      <button className="link-btn" onClick={onBack}>
        <BackIcon />
        Jobs
      </button>
      <h1 className="page-title">{jobTitle(job)}</h1>

      {error && <p className="error" role="alert">{error}</p>}
      {busy && (
        <p className="pc-status" role="status">
          Drafting the work order, parts list, and quote… this can take a minute.
        </p>
      )}
      {!busy && waiting > 0 && (
        <p className="pc-status" role="status">
          Waiting for {waiting} stop{waiting === 1 ? "" : "s"} to upload and be written down…
        </p>
      )}

      {loaded && !working && !busy && (
        <div className="piccolo-callout">
          <p>Piccolo reads this job's notes, voice notes, and photos, and drafts a work order, parts list, and quote. You can change everything.</p>
          <button className="big-btn photo-btn" onClick={draft} disabled={waiting > 0 || !online}>
            Draft with AI
          </button>
          {!online && <p className="pc-empty">Drafting needs signal.</p>}
        </div>
      )}

      {newer && (
        <div className="pc-banner" role="status">
          <p>Draft {latest.version} is ready. Using it replaces the version you have now.</p>
          <div className="pc-banner-actions">
            <button
              className="save-btn"
              onClick={() => applyDraft(uid, job.id, latest, working).then(() => onNotice(`Now using draft ${latest.version}`))}
            >
              Use Draft {latest.version}
            </button>
            <button className="text-btn" onClick={() => setKeptVersion(latest.version)}>
              Keep the current one
            </button>
          </div>
        </div>
      )}
      {working && !newer && changed && !busy && (
        <div className="pc-banner" role="status">
          <p>New photos or notes since this draft. Re-draft to include them? Your current version stays until you choose.</p>
          <button className="big-btn plain-btn" onClick={draft} disabled={waiting > 0 || !online}>
            Re-draft
          </button>
        </div>
      )}

      {working && (
        <>
          <div className="pc-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <p className="pc-draft-note">
            AI draft {working.draftVersion ? `v${working.draftVersion}` : ""} · Check everything before you send it.
            {!newer && !changed && (
              <button className="text-btn pc-inline" onClick={draft} disabled={busy || waiting > 0 || !online}>
                Re-draft
              </button>
            )}
          </p>
        </>
      )}

      {(tab === "overview" || !working) && (
        <>
          <section className="pc-block">
            <div className="pc-block-head">
              <h3>Customer &amp; location</h3>
              <button className="link-btn" onClick={() => setEditing("details")}>
                Edit
              </button>
            </div>
            <p className="pc-text">
              {job.customer || "No customer yet"}
              {job.location ? ` · ${job.location}` : ""}
            </p>
          </section>
          <TextBlock
            id="pc-note-summary"
            label="Summary"
            text={hasSummary(summary) ? summary.summary : ""}
            empty="No AI summary yet. It's built on the job page in PicTalk."
            onEdit={hasSummary(summary) ? () => setEditing("summary") : null}
          />
          <TextBlock id="pc-note-field_notes" label="Field notes" text={notes.field?.text} empty="No field notes." onEdit={() => setEditing("field")} />
          <TextBlock
            id="pc-note-customer_comments"
            label="Customer notes"
            text={notes.customer?.text}
            empty="No customer notes."
            onEdit={() => setEditing("customer")}
          />
          {working && (
            <ItemList title="Open questions" items={working.questions} stopNumber={stopNumber} onJump={jump} />
          )}
          <button className="text-btn" onClick={() => onOpenInPicTalk(job.id)}>
            Add photos or notes in PicTalk
          </button>
        </>
      )}

      {working && tab === "workorder" && wo && (
        <>
          <TextBlock label="Scope of work" text={wo.scope} empty="" />
          {wo.locations.map((loc, i) => (
            <ItemList key={i} title={loc.name} items={loc.tasks} stopNumber={stopNumber} onJump={jump} />
          ))}
          {parts.length > 0 && (
            <section className="pc-block">
              <h3>Devices and materials</h3>
              <ul className="pc-items">
                {parts.map((l) => (
                  <li key={l.id}>
                    {l.qty} {l.unit} · {l.description}
                    {l.location ? ` (${l.location})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ItemList title="Installation notes" items={wo.installNotes} stopNumber={stopNumber} onJump={jump} />
          <ItemList title="Customer requirements" items={wo.constraints} stopNumber={stopNumber} onJump={jump} />
          <ItemList title="Open questions" items={working.questions} stopNumber={stopNumber} onJump={jump} />
        </>
      )}

      {working && tab === "bom" && (
        <section aria-label="Parts list">
          {parts.length === 0 && <p className="empty">No parts in this draft.</p>}
          {parts.map((l) => (
            <LineCard key={l.id} line={l} stopNumber={stopNumber} onJump={jump} />
          ))}
          <p className="demo-note">Editing lines comes next. Part numbers marked Verify weren't said in the job; check them.</p>
        </section>
      )}

      {working && tab === "quote" && (
        <section aria-label="Quote">
          {bom.map((l) => (
            <LineCard key={l.id} line={l} stopNumber={stopNumber} onJump={jump} showPrice />
          ))}
          <div className="pc-totals">
            <p>
              <span>Subtotal</span>
              <span>{money(totals.subtotal)}</span>
            </p>
            <p>
              <span>Markup ({working.quote?.markupPct || 0}%)</span>
              <span>{money(totals.markup)}</span>
            </p>
            <p>
              <span>Tax ({working.quote?.taxPct || 0}%)</span>
              <span>{money(totals.tax)}</span>
            </p>
            <p className="pc-total">
              <span>Total</span>
              <span>{money(totals.total)}</span>
            </p>
            {totals.unpriced > 0 && (
              <p className="pc-empty">
                {totals.unpriced} line{totals.unpriced === 1 ? " needs a price" : "s need prices"}. Prices are left blank on purpose; adding them comes next.
              </p>
            )}
          </div>
          {working.quote?.terms && <TextBlock label="Terms" text={working.quote.terms} empty="" />}
        </section>
      )}

      {working && tab === "media" && (
        <section aria-label="Photos and voice notes">
          {sorted.length === 0 && <p className="empty">This job has no stops.</p>}
          {sorted.map((s) => (
            <MediaStop key={s.id} stop={s} number={stopNumber[s.id]} />
          ))}
          <p className="demo-note">To change photos or words, use PicTalk.</p>
        </section>
      )}

      {editing === "details" && (
        <DetailsSheet
          job={job}
          onClose={() => setEditing(null)}
          onSave={(details) => {
            setJobDetails(uid, job.id, details);
            setEditing(null);
            onNotice("Customer and location saved");
          }}
        />
      )}
      {editing === "summary" && (
        <EditTextSheet
          title="Summary"
          initial={summary.summary}
          maxLength={4000}
          onClose={() => setEditing(null)}
          onSave={(text) => {
            saveSummaryEdits(uid, job.id, { summary: text, action_items: summary.action_items || [], open_questions: summary.open_questions || [] });
            setEditing(null);
            onNotice("Summary saved");
          }}
        />
      )}
      {(editing === "field" || editing === "customer") && (
        <EditTextSheet
          title={editing === "field" ? "Field notes" : "Customer notes"}
          initial={notes[editing]?.text || ""}
          maxLength={20000}
          onClose={() => setEditing(null)}
          onSave={(text) => {
            saveNoteText(uid, job.id, editing, text);
            setEditing(null);
            onNotice("Notes saved");
          }}
        />
      )}
    </>
  );
}

function DetailsSheet({ job, onSave, onClose }) {
  const [details, setDetails] = useState({ customer: job.customer || "", location: job.location || "" });
  return (
    <Sheet title="Customer & location" onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(details);
        }}
      >
        <JobDetailsFields customer={details.customer} location={details.location} onChange={setDetails} />
        <button type="submit" className="save-btn">
          Save
        </button>
        <button type="button" className="big-btn plain-btn" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}
