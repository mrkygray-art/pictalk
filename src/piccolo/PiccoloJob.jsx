import { useEffect, useRef, useState } from "react";
import Sheet from "../Sheet";
import JobDetailsFields from "../JobDetailsFields";
import { jobTitle, setJobDetails } from "../jobStore";
import { stopText, photoText, urlFor } from "../stopStore";
import { watchNotes, saveNoteText } from "../wrapUpStore";
import { watchSummary, hasSummary, saveSummaryEdits, isTranscriptPending } from "../summaryStore";
import {
  watchLatestDraft, requestDraft, captureChangedSince, money, quoteTotals, draftToWorking, blankLine, renumber, newId,
  watchFinals, requestFinalize, finalizeWarnings,
} from "./piccoloStore";
import useWorkingCopy from "./useWorkingCopy";
import LineSheet from "./LineSheet";
import { ItemSheet, CompareSheet } from "./EditSheets";
import { FinalizeSheet, ExportSheet } from "./FinalSheets";

const TABS = [
  ["overview", "Overview"],
  ["workorder", "Work Order"],
  ["bom", "Parts (BOM)"],
  ["quote", "Quote"],
  ["media", "Media"],
];
const NOTE_LABELS = { field_notes: "Field notes", customer_comments: "Customer notes", summary: "Summary" };
const SAVE_TEXT = {
  waiting: "Saving…",
  saving: "Saving…",
  saved: "Saved ✓",
  offline: "Saved on this device. It syncs when you're back online.",
  error: "Couldn't save. Check your connection and try again.",
};

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
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

// A list of short items; tap one to edit it
function EditableList({ title, items, empty, addLabel, onEditTitle, onEditItem, onAdd, stopNumber, onJump }) {
  return (
    <section className="pc-block">
      <div className="pc-block-head">
        <h3>{title}</h3>
        {onEditTitle && (
          <button className="link-btn" onClick={onEditTitle}>
            Edit
          </button>
        )}
      </div>
      {!items?.length && empty && <p className="pc-empty">{empty}</p>}
      {items?.length > 0 && (
        <ul className="pc-items">
          {items.map((it, i) => (
            <li key={it.id || i}>
              <button className="pc-item-btn" onClick={() => onEditItem(i)}>
                {it.answer !== undefined && it.answered ? "✓ " : ""}
                {it.text}
              </button>
              {it.answered && it.answer && <p className="pc-answer">Answer: {it.answer}</p>}
              <Sources ids={it.sourceIds} stopNumber={stopNumber} onJump={onJump} />
            </li>
          ))}
        </ul>
      )}
      <button className="pc-add" onClick={onAdd}>
        + {addLabel}
      </button>
    </section>
  );
}

function LineCard({ line, stopNumber, onJump, showPrice, onEdit }) {
  const priced = Number.isFinite(line.unitPrice);
  const inferred = line.source?.basis === "inferred" && !line.checked;
  return (
    <div className={`pc-line${inferred ? " is-inferred" : ""}`}>
      <button className="pc-line-main" onClick={onEdit} aria-label={`Edit ${line.description}`}>
        <span className="pc-line-top">
          <strong>{line.description}</strong>
          <span className="pc-qty">
            {line.qty} {line.unit}
          </span>
        </span>
        <span className="pc-badges">
          {inferred && <span className="badge is-warn">Inferred · check</span>}
          {line.source?.basis === "seen_in_photo" && <span className="badge">Seen in photo</span>}
          {line.partNumberStatus === "ai_suggested" && <span className="badge is-warn">Verify part #</span>}
          {line.priceSource === "ai_estimate" && <span className="badge is-warn">ESTIMATE</span>}
          {line.partNumberStatus === "history" && <span className="badge">Part # from a past quote</span>}
          {showPrice && line.priceSource === "history" && <span className="badge">Last quoted price</span>}
          {showPrice && line.priceSource === "sample" && <span className="badge">Sample price</span>}
          {!priced && <span className="badge is-muted">Needs price</span>}
        </span>
        {line.partNumber && <span className="pc-meta">Part #: {line.partNumber}</span>}
        {line.location && <span className="pc-meta">Where: {line.location}</span>}
        {line.notes && <span className="pc-meta">{line.notes}</span>}
        {line.source?.quote && <span className="pc-quote">“{line.source.quote}”</span>}
        {showPrice && priced && (
          <span className="pc-meta">
            {money(line.unitPrice)} each · {money(line.unitPrice * line.qty)}
            {Number.isFinite(line.unitCost) ? ` · cost ${money(line.unitCost)}` : ""}
          </span>
        )}
        <span className="pc-edit-hint">Tap to edit</span>
      </button>
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
        <strong>
          Stop {number}
          {stop.place ? ` · ${stop.place}` : ""}
        </strong>
        <p>{words || (stop.audioPath ? "No words in this voice note." : "No voice note.")}</p>
        {seen && <p className="pc-seen">Photo: {seen}</p>}
      </div>
    </div>
  );
}

// Markup, tax, and terms for the quote (one Save = one undo step)
function QuoteSettings({ quote, onSave }) {
  const [f, setF] = useState({ markupPct: String(quote?.markupPct ?? 0), taxPct: String(quote?.taxPct ?? 0), terms: quote?.terms || "" });
  const [error, setError] = useState("");
  const dirty = f.markupPct !== String(quote?.markupPct ?? 0) || f.taxPct !== String(quote?.taxPct ?? 0) || f.terms !== (quote?.terms || "");
  return (
    <form
      className="pc-block"
      onSubmit={(e) => {
        e.preventDefault();
        const markupPct = Number(f.markupPct || 0);
        const taxPct = Number(f.taxPct || 0);
        if (!Number.isFinite(markupPct) || !Number.isFinite(taxPct) || markupPct < 0 || taxPct < 0 || markupPct > 1000 || taxPct > 100) {
          return setError("Markup and tax need to be numbers (tax up to 100).");
        }
        setError("");
        onSave({ markupPct, taxPct, terms: f.terms.trim() });
      }}
    >
      <h3>Markup, tax, and terms</h3>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="detail-fields">
        <div className="pc-field-row">
          <label>
            Markup %
            <input value={f.markupPct} inputMode="decimal" maxLength={6} onChange={(e) => setF({ ...f, markupPct: e.target.value })} />
          </label>
          <label>
            Tax %
            <input value={f.taxPct} inputMode="decimal" maxLength={6} onChange={(e) => setF({ ...f, taxPct: e.target.value })} />
          </label>
        </div>
        <label>
          Terms
          <textarea className="words-field" rows={3} maxLength={2000} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
        </label>
      </div>
      <button type="submit" className="save-btn" disabled={!dirty}>
        Save Quote Settings
      </button>
    </form>
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

/** One job in Piccolo: draft with AI, then edit the work order, BOM, and quote. */
export default function PiccoloJob({ uid, job, stops, pendingStops, autoDraft, online, isGuest, orgName, teamControls, onTryAnother, tryingAnother, onBack, onAccount, onOpenInPicTalk, onNotice }) {
  const ownerUid = job.ownerUid || uid; // a teammate's job lives under its owner
  const isOwner = ownerUid === uid;
  const [tab, setTab] = useState("overview");
  const { working, loaded: workingLoaded, status, edit, undo, canUndo, replace, saveNow } = useWorkingCopy(ownerUid, uid, job);
  const [finals, setFinals] = useState([]);
  const [latest, setLatest] = useState(undefined);
  const [notes, setNotes] = useState({});
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const autoTried = useRef(false);

  useEffect(() => watchLatestDraft(ownerUid, job.id, setLatest), [ownerUid, job.id]);
  useEffect(() => watchFinals(ownerUid, job.id, setFinals), [ownerUid, job.id]);
  useEffect(() => watchNotes(ownerUid, job.id, setNotes), [ownerUid, job.id]);
  useEffect(() => watchSummary(ownerUid, job.id, setSummary), [ownerUid, job.id]);

  const sorted = [...stops].sort((a, b) => (a.clientCreatedAt || 0) - (b.clientCreatedAt || 0));
  const stopNumber = Object.fromEntries(sorted.map((s, i) => [s.id, i + 1]));
  const waiting = pendingStops + sorted.filter((s) => isTranscriptPending(s)).length;
  const loaded = workingLoaded && latest !== undefined;

  const draft = async () => {
    setBusy(true);
    setError("");
    try {
      const { version } = await requestDraft(job.id, ownerUid);
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

  // ---------- edits (each is one undo step) ----------
  const bom = working?.bom || [];
  const saveLine = (line, isNew) =>
    edit((w) => {
      w.bom = isNew ? renumber([...w.bom, line]) : w.bom.map((l) => (l.id === line.id ? line : l));
    });
  const deleteLine = (id) => edit((w) => void (w.bom = renumber(w.bom.filter((l) => l.id !== id))));
  const duplicateLine = (line) =>
    edit((w) => {
      const i = w.bom.findIndex((l) => l.id === line.id);
      w.bom.splice(i + 1, 0, { ...structuredClone(line), id: newId() });
      w.bom = renumber(w.bom);
    });
  // Move among the lines on screen (the BOM tab hides labor), swapping with the neighbor there
  const moveLine = (id, dir, visibleIds) =>
    edit((w) => {
      const v = visibleIds.indexOf(id);
      const otherId = visibleIds[v + dir];
      if (!otherId) return;
      const a = w.bom.findIndex((l) => l.id === id);
      const b = w.bom.findIndex((l) => l.id === otherId);
      [w.bom[a], w.bom[b]] = [w.bom[b], w.bom[a]];
      w.bom = renumber(w.bom);
    });
  const openLine = (line, visible) => setSheet({ type: "line", line, visibleIds: visible.map((l) => l.id) });

  // Text items: scope, location names, tasks, requirements, installation notes, questions
  const itemSheet = (title, initial, apply, remove, extra = {}) => setSheet({ type: "item", title, initial, apply, remove, ...extra });
  const wo = working?.workOrder;
  const listEditor = (key, title) => ({
    items: wo?.[key],
    onEditItem: (i) =>
      itemSheet(
        title,
        wo[key][i].text,
        (w, text) => void (w.workOrder[key][i].text = text),
        (w) => void w.workOrder[key].splice(i, 1)
      ),
    onAdd: () => itemSheet(title, "", (w, text) => void w.workOrder[key].push({ text, sourceIds: [] })),
  });

  const newer = working && latest && latest.version > Math.max(working.draftVersion || 0, working.reviewedDraftVersion || 0);
  const changed = latest && captureChangedSince(latest, { stops: sorted, notes });
  const parts = bom.filter((l) => l.category !== "labor");
  const totals = quoteTotals(bom, working?.quote);
  const questions = working?.questions || [];
  const openQuestions = questions.filter((q) => !q.answered).length;
  const lastFinal = finals[0] || null;
  const changedSinceFinal = !!lastFinal && !!working && (working.updatedAt || 0) > lastFinal.finalizedAt;
  const when = (t, year) => new Date(t).toLocaleString([], { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit" });
  const exportBase = {
    job,
    working,
    summary: hasSummary(summary) ? summary.summary : null,
    notes,
    stops: sorted.map((s) => ({ id: s.id, words: stopText(s) || null, photoDescription: photoText(s) || null })),
    orgName,
  };

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
          <p>Draft {latest.version} is ready. Compare it with your version, or replace yours with it.</p>
          <div className="pc-banner-actions">
            <button className="save-btn" onClick={() => setSheet({ type: "compare" })}>
              Compare
            </button>
            <button className="text-btn" onClick={() => edit((w) => void (w.reviewedDraftVersion = latest.version))}>
              Keep mine
            </button>
          </div>
        </div>
      )}
      {working && !newer && changed && !busy && (
        <div className="pc-banner" role="status">
          <p>New photos or notes since this draft. Re-draft to include them? Your version stays until you choose.</p>
          <button className="big-btn plain-btn" onClick={draft} disabled={waiting > 0 || !online}>
            Re-draft
          </button>
        </div>
      )}

      {onTryAnother && (
        <div className="pc-sample-bar">
          <span>Made-up sample job</span>
          <button className="link-btn" onClick={onTryAnother} disabled={tryingAnother}>
            {tryingAnother ? "Opening another…" : "Try a different sample ›"}
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
          <div className="pc-savebar">
            <span className={`pc-save is-${status}`} role="status">
              {SAVE_TEXT[status] || `AI draft ${working.draftVersion ? `v${working.draftVersion}` : ""} · Check everything before you send it.`}
            </span>
            {canUndo && (
              <button className="link-btn" onClick={undo}>
                Undo
              </button>
            )}
            {!canUndo && !newer && !changed && (
              <button className="text-btn pc-inline" onClick={draft} disabled={busy || waiting > 0 || !online}>
                Re-draft
              </button>
            )}
          </div>
          {lastFinal && (
            <p className={`pc-final-note${changedSinceFinal ? " is-changed" : ""}`}>
              Final v{lastFinal.version} saved {when(lastFinal.finalizedAt)}.
              {changedSinceFinal ? ` You've made changes since. Finalize again to save v${lastFinal.version + 1}.` : ""}
            </p>
          )}
          <div className="pc-actions">
            <button className="big-btn photo-btn" onClick={() => setSheet({ type: "finalize" })} disabled={!!lastFinal && !changedSinceFinal}>
              {lastFinal && !changedSinceFinal ? `Finalized v${lastFinal.version}` : "Finalize"}
            </button>
            <button className="big-btn plain-btn" onClick={() => setSheet({ type: "export" })}>
              Export
            </button>
          </div>
        </>
      )}

      {(tab === "overview" || !working) && (
        <>
          <section className="pc-block">
            <div className="pc-block-head">
              <h3>Customer &amp; location</h3>
              {isOwner && (
                <button className="link-btn" onClick={() => setSheet({ type: "details" })}>
                  Edit
                </button>
              )}
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
            onEdit={isOwner && hasSummary(summary) ? () => setSheet({ type: "summary" }) : null}
          />
          <TextBlock id="pc-note-field_notes" label="Field notes" text={notes.field?.text} empty="No field notes." onEdit={isOwner ? () => setSheet({ type: "note", note: "field" }) : null} />
          <TextBlock
            id="pc-note-customer_comments"
            label="Customer notes"
            text={notes.customer?.text}
            empty="No customer notes."
            onEdit={isOwner ? () => setSheet({ type: "note", note: "customer" }) : null}
          />
          {working && (
            <EditableList
              title={`Open questions${openQuestions ? ` (${openQuestions})` : ""}`}
              items={questions}
              empty="No questions."
              addLabel="Add a question"
              stopNumber={stopNumber}
              onJump={jump}
              onEditItem={(i) =>
                itemSheet(
                  "Open question",
                  questions[i].text,
                  (w, text, answer) => void Object.assign(w.questions[i], { text, answer, answered: !!answer }),
                  (w) => void w.questions.splice(i, 1),
                  { answer: questions[i].answer || "" }
                )
              }
              onAdd={() =>
                itemSheet("Open question", "", (w, text, answer) => void w.questions.push({ id: newId(), text, sourceIds: [], answer, answered: !!answer }), null, { answer: "" })
              }
            />
          )}
          {finals.length > 0 && (
            <section className="pc-block">
              <h3>Finalized versions</h3>
              {finals.map((f) => (
                <div key={f.id} className="pc-compare-row">
                  <span>
                    v{f.version} · {when(f.finalizedAt, true)}
                    {f.finalizedByName ? ` · ${f.finalizedByName}` : ""}
                    {f.editDiff && (
                      <span className="pc-meta">
                        From the AI draft: {f.editDiff.linesKept} kept, {f.editDiff.linesChanged} changed, {f.editDiff.linesRemoved} removed,{" "}
                        {f.editDiff.linesAdded} added
                      </span>
                    )}
                  </span>
                  <button className="link-btn" onClick={() => setSheet({ type: "export", choice: f.id })}>
                    Export
                  </button>
                </div>
              ))}
              <p className="pc-hint">Each final keeps its own copy of the photos and audio.</p>
            </section>
          )}
          {teamControls}
          {isOwner && (
            <button className="text-btn" onClick={() => onOpenInPicTalk(job.id)}>
              Add photos or notes in PicTalk
            </button>
          )}
        </>
      )}

      {working && tab === "workorder" && wo && (
        <>
          <TextBlock
            label="Scope of work"
            text={wo.scope}
            empty="No scope yet."
            onEdit={() => itemSheet("Scope of work", wo.scope, (w, text) => void (w.workOrder.scope = text), null, { multiline: true, maxLength: 4000 })}
          />
          {wo.locations.map((loc, li) => (
            <EditableList
              key={li}
              title={loc.name}
              items={loc.tasks}
              empty="No tasks here."
              addLabel="Add a task"
              stopNumber={stopNumber}
              onJump={jump}
              onEditTitle={() =>
                itemSheet("Location name", loc.name, (w, text) => void (w.workOrder.locations[li].name = text), (w) => void w.workOrder.locations.splice(li, 1))
              }
              onEditItem={(ti) =>
                itemSheet(
                  `Task at ${loc.name}`,
                  loc.tasks[ti].text,
                  (w, text) => void (w.workOrder.locations[li].tasks[ti].text = text),
                  (w) => void w.workOrder.locations[li].tasks.splice(ti, 1)
                )
              }
              onAdd={() => itemSheet(`Task at ${loc.name}`, "", (w, text) => void w.workOrder.locations[li].tasks.push({ text, sourceIds: [] }))}
            />
          ))}
          <button
            className="pc-add pc-add-block"
            onClick={() => itemSheet("New location", "", (w, text) => void w.workOrder.locations.push({ name: text, tasks: [] }))}
          >
            + Add a location
          </button>
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
              <p className="pc-hint">Edit these on the Parts tab.</p>
            </section>
          )}
          <EditableList title="Installation notes" empty="None yet." addLabel="Add a note" stopNumber={stopNumber} onJump={jump} {...listEditor("installNotes", "Installation note")} />
          <EditableList title="Customer requirements" empty="None yet." addLabel="Add a requirement" stopNumber={stopNumber} onJump={jump} {...listEditor("constraints", "Customer requirement")} />
        </>
      )}

      {working && tab === "bom" && (
        <section aria-label="Parts list">
          {parts.length === 0 && <p className="empty">No parts yet.</p>}
          {parts.map((l) => (
            <LineCard key={l.id} line={l} stopNumber={stopNumber} onJump={jump} onEdit={() => openLine(l, parts)} />
          ))}
          <button className="pc-add pc-add-block" onClick={() => setSheet({ type: "line", line: blankLine("equipment"), isNew: true })}>
            + Add a part
          </button>
          <p className="demo-note">Verify means nobody said that part number in the job. Tap the line to check it.</p>
        </section>
      )}

      {working && tab === "quote" && (
        <section aria-label="Quote">
          {bom.map((l) => (
            <LineCard key={l.id} line={l} stopNumber={stopNumber} onJump={jump} showPrice onEdit={() => openLine(l, bom)} />
          ))}
          <div className="pc-add-row">
            <button className="pc-add pc-add-block" onClick={() => setSheet({ type: "line", line: blankLine("labor"), isNew: true })}>
              + Add labor
            </button>
            <button className="pc-add pc-add-block" onClick={() => setSheet({ type: "line", line: blankLine("equipment"), isNew: true })}>
              + Add a line
            </button>
          </div>
          <div className="pc-totals">
            <p>
              <span>Parts &amp; materials</span>
              <span>{money(totals.materials)}</span>
            </p>
            <p>
              <span>Labor</span>
              <span>{totals.laborLines ? money(totals.labor) : "None yet"}</span>
            </p>
            <p className="pc-subtotal">
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
            {totals.laborLines === 0 && <p className="pc-empty">No labor lines yet. Tap + Add labor to add some.</p>}
            {totals.unpriced > 0 && (
              <p className="pc-empty">
                {totals.unpriced} line{totals.unpriced === 1 ? " needs a price" : "s need prices"}. Tap a line to add one.
              </p>
            )}
          </div>
          <QuoteSettings
            key={working.updatedAt}
            quote={working.quote}
            onSave={(q) => {
              edit((w) => void (w.quote = { ...w.quote, ...q }));
              onNotice("Quote settings saved");
            }}
          />
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

      {sheet?.type === "line" && (
        <LineSheet
          key={sheet.line.id}
          line={sheet.line}
          isNew={!!sheet.isNew}
          showPrices
          position={sheet.visibleIds?.indexOf(sheet.line.id) ?? 0}
          count={sheet.visibleIds?.length ?? 1}
          onClose={() => setSheet(null)}
          onSave={(line) => {
            saveLine(line, sheet.isNew);
            setSheet(null);
          }}
          onDelete={() => {
            deleteLine(sheet.line.id);
            setSheet(null);
            onNotice("Line deleted. Tap Undo to bring it back.");
          }}
          onDuplicate={() => {
            duplicateLine(sheet.line);
            setSheet(null);
          }}
          onMove={(dir) => {
            moveLine(sheet.line.id, dir, sheet.visibleIds);
            setSheet(null);
          }}
        />
      )}
      {sheet?.type === "item" && (
        <ItemSheet
          title={sheet.title}
          initial={sheet.initial}
          answer={sheet.answer}
          multiline={sheet.multiline}
          maxLength={sheet.maxLength}
          onClose={() => setSheet(null)}
          onSave={(text, answer) => {
            edit((w) => sheet.apply(w, text, answer));
            setSheet(null);
          }}
          onDelete={
            sheet.remove
              ? () => {
                  edit((w) => sheet.remove(w));
                  setSheet(null);
                }
              : null
          }
        />
      )}
      {sheet?.type === "compare" && newer && (
        <CompareSheet
          mine={working}
          draft={latest}
          onAddLine={(l) => edit((w) => void (w.bom = renumber([...w.bom, { ...structuredClone(l), id: newId() }])))}
          onAddQuestion={(q) => edit((w) => void w.questions.push({ ...q, id: newId() }))}
          onReplace={() => {
            replace(draftToWorking(latest));
            setSheet(null);
            onNotice(`Now using draft ${latest.version}. Tap Undo to go back.`);
          }}
          onClose={() => {
            edit((w) => void (w.reviewedDraftVersion = latest.version));
            setSheet(null);
          }}
        />
      )}
      {sheet?.type === "finalize" && working && (
        <FinalizeSheet
          warnings={finalizeWarnings(working)}
          nextVersion={(job.latestFinalVersion || 0) + 1}
          isGuest={isGuest}
          onAccount={() => {
            setSheet(null);
            onAccount();
          }}
          onClose={() => setSheet(null)}
          onFinalize={async () => {
            await saveNow(); // the server finalizes what's in the cloud
            const { version, missing } = await requestFinalize(job.id, ownerUid);
            setSheet(null);
            onNotice(`Saved final v${version}${missing ? `. ${missing} expired recording${missing === 1 ? " wasn't" : "s weren't"} included` : ""}`);
          }}
        />
      )}
      {sheet?.type === "export" && working && (
        <ExportSheet
          jobId={job.id}
          ownerUid={ownerUid}
          base={exportBase}
          finals={finals}
          isGuest={isGuest}
          initialChoice={sheet.choice || (changedSinceFinal ? "current" : null)}
          onClose={() => setSheet(null)}
          onDone={(how) => {
            setSheet(null);
            onNotice(how === "shared" ? "Shared" : "Downloaded");
          }}
        />
      )}
      {sheet?.type === "details" && (
        <DetailsSheet
          job={job}
          onClose={() => setSheet(null)}
          onSave={(details) => {
            setJobDetails(uid, job.id, details);
            setSheet(null);
            onNotice("Customer and location saved");
          }}
        />
      )}
      {sheet?.type === "summary" && (
        <ItemSheet
          title="Summary"
          initial={summary.summary}
          multiline
          maxLength={4000}
          onClose={() => setSheet(null)}
          onSave={(text) => {
            saveSummaryEdits(uid, job.id, { summary: text, action_items: summary.action_items || [], open_questions: summary.open_questions || [] });
            setSheet(null);
            onNotice("Summary saved");
          }}
        />
      )}
      {sheet?.type === "note" && (
        <ItemSheet
          title={sheet.note === "field" ? "Field notes" : "Customer notes"}
          initial={notes[sheet.note]?.text || ""}
          multiline
          allowEmpty
          maxLength={20000}
          onClose={() => setSheet(null)}
          onSave={(text) => {
            saveNoteText(uid, job.id, sheet.note, text);
            setSheet(null);
            onNotice("Notes saved");
          }}
        />
      )}
    </>
  );
}
