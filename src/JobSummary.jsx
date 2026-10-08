import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import {
  watchSummary, hasSummary, requestSummary, saveSummaryEdits, approveSummary,
  isTranscriptPending, PRIORITIES,
} from "./summaryStore";
import { describeNote } from "./wrapUpStore";
import { stopText, photoText } from "./stopStore";

// Summary items can cite a wrap-up note instead of a stop
const NOTE_LABEL = { field_notes: "Field notes", customer_comments: "Customer comments" };
import { getSavedInitials, ANONYMOUS_NAME } from "./exportJob";
import { SummaryEngLine } from "./EngineeringPanel";

const PER_JOB_LIMIT = 5; // matches the Cloud Function
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };
const when = (t) =>
  new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const toDraft = (s) => ({
  summary: s.summary || "",
  action_items: (s.action_items || []).map((i) => ({ ...i, source_stop_ids: i.source_stop_ids || [] })),
  open_questions: (s.open_questions || []).map((i) => ({ ...i, source_stop_ids: i.source_stop_ids || [] })),
});
// Blank items (e.g. one added but never filled in) aren't saved
const tidy = (d) => ({
  summary: d.summary.trim(),
  action_items: d.action_items.filter((i) => i.text.trim()).map((i) => ({ ...i, text: i.text.trim() })),
  open_questions: d.open_questions.filter((i) => i.text.trim()).map((i) => ({ ...i, text: i.text.trim() })),
});
function StopLinks({ ids, numberOf, onJump }) {
  if (!ids.length) return null;
  return (
    <div className="stop-links">
      {ids.map((id) => (
        <button key={id} type="button" className="stop-link" onClick={() => onJump(id)}>
          {NOTE_LABEL[id] || (numberOf.has(id) ? `Stop ${numberOf.get(id)}` : "Stop removed")} ›
        </button>
      ))}
    </div>
  );
}

// One action item as plain text, with an Edit button
function ItemRow({ item, numberOf, onEdit, onJump }) {
  return (
    <li className="summary-item">
      <p className="item-text">
        <span className={`priority-tag is-${item.priority}`}>{PRIORITY_LABEL[item.priority] || "Medium"}</span>
        {item.text}
      </p>
      <div className="item-foot">
        <StopLinks ids={item.source_stop_ids} numberOf={numberOf} onJump={onJump} />
        <button type="button" className="stop-more item-edit" onClick={onEdit}>
          Edit
        </button>
      </div>
    </li>
  );
}

// Edit the summary paragraph: one text box, Save or Cancel
function SummarySheet({ text, onSave, onClose }) {
  const [value, setValue] = useState(text);
  return (
    <Sheet title="Edit summary" onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        <textarea
          className="words-field"
          value={value}
          rows={8}
          maxLength={2000}
          aria-label="Summary"
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="save-btn" disabled={!value.trim()}>
          Save
        </button>
        <button type="button" className="big-btn plain-btn" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}

// Edit or add an action item: priority, text, Save / Cancel (and Remove for an existing one)
function ItemSheet({ item, onSave, onRemove, onClose }) {
  const [text, setText] = useState(item?.text || "");
  const [priority, setPriority] = useState(item?.priority || "medium");
  return (
    <Sheet title={item ? "Edit action item" : "New action item"} onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ text, priority });
        }}
      >
        <div className="priority-row" role="group" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={`priority-btn is-${p}${priority === p ? " is-on" : ""}`}
              aria-pressed={priority === p}
              onClick={() => setPriority(p)}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
        <textarea
          className="words-field"
          value={text}
          rows={4}
          maxLength={300}
          placeholder="What needs to be done"
          aria-label="Action item"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="save-btn" disabled={!text.trim()}>
          Save
        </button>
        <button type="button" className="big-btn plain-btn" onClick={onClose}>
          Cancel
        </button>
        {item && (
          <button type="button" className="big-btn plain-btn is-danger" onClick={onRemove}>
            Remove This Item
          </button>
        )}
      </form>
    </Sheet>
  );
}

/**
 * Summary section on a finished job's page: builds the AI draft (automatically right
 * after End Job, otherwise with a button), then lets the user edit and approve it.
 */
export default function JobSummary({ uid, job, stops, online, autoStart, notes, onJumpToStop }) {
  const [summaryDoc, setSummaryDoc] = useState(undefined); // undefined = loading, null = none
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [removed, setRemoved] = useState(null); // { list, index, item } for Undo
  const [editor, setEditor] = useState(null); // "summary" | { index } (index -1 = new item)
  const [now, setNow] = useState(() => Date.now());
  const autoTried = useRef(false);

  useEffect(() => {
    if (!uid) return;
    return watchSummary(uid, job.id, (data) => {
      setSummaryDoc(data);
      if (hasSummary(data)) setDraft(toDraft(data));
    });
  }, [uid, job.id]);

  const numberOf = new Map(stops.map((s, i) => [s.id, i + 1]));
  // Wrap-up notes count as input too (their words, or still being written down)
  const noteViews = {
    field: describeNote(notes?.notes.field, notes?.pending.field),
    customer: describeNote(notes?.notes.customer, notes?.pending.customer),
  };
  const notesWaiting = Object.values(noteViews).filter((v) => v.status === "waiting-upload" || v.status === "transcribing").length;
  const waiting = stops.filter((s) => isTranscriptPending(s, now)).length + notesWaiting;
  // The summary is written from speech; stops without it (photo only, no speech heard) add nothing
  const hasSpeech = stops.some((s) => stopText(s) || photoText(s)) || !!noteViews.field.text || !!noteViews.customer.text;
  const used = summaryDoc?.generationCount || 0;
  const left = Math.max(0, PER_JOB_LIMIT - used);

  // While waiting on transcripts, re-check now and then (stuck uploads time out after 5 min)
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [waiting]);

  const build = async () => {
    setError("");
    setBusy(true);
    try {
      await requestSummary(job.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Right after End Job: build automatically once everything is ready
  useEffect(() => {
    if (!autoStart || autoTried.current || summaryDoc !== null || busy) return;
    if (waiting || !online || !hasSpeech) return;
    autoTried.current = true;
    Promise.resolve().then(build);
  });

  const commit = (next) => {
    const clean = tidy(next);
    setDraft(clean);
    saveSummaryEdits(uid, job.id, clean);
  };
  const saveItem = (index, { text, priority }) => {
    const items =
      index < 0
        ? [...draft.action_items, { id: `u${Date.now()}`, text, priority, source_stop_ids: [] }]
        : draft.action_items.map((it, i) => (i === index ? { ...it, text, priority } : it));
    commit({ ...draft, action_items: items });
  };
  const removeItem = (list, index) => {
    setRemoved({ list, index, item: draft[list][index] });
    commit({ ...draft, [list]: draft[list].filter((_, i) => i !== index) });
  };
  const undoRemove = () => {
    const { list, index, item } = removed;
    const items = [...draft[list]];
    items.splice(Math.min(index, items.length), 0, item);
    setRemoved(null);
    commit({ ...draft, [list]: items });
  };
  const approve = () => {
    // Edits are saved as they're made, so approving never adds new ones
    approveSummary(uid, job.id, tidy(draft), getSavedInitials() || ANONYMOUS_NAME);
  };

  if (summaryDoc === undefined) return null;

  // ---------- no summary yet ----------
  if (!hasSummary(summaryDoc)) {
    let status = null;
    if (busy) status = "Building summary… this can take up to a minute.";
    else if (waiting) status = `Waiting for ${waiting} voice note${waiting === 1 ? "" : "s"} to upload and be written down…`;
    else if (!hasSpeech) {
      status = "No summary for this job: the AI summary is written from what you say at each stop, photo descriptions, or wrap-up notes, and this job has none.";
    } else if (!online) status = "Building a summary needs signal.";
    return (
      <section className="summary-card" aria-label="AI summary">
        <h2>AI summary</h2>
        {status && (
          <p className={busy ? "summary-status is-busy" : "summary-status"} role="status">
            {status}
          </p>
        )}
        {error && <p className="summary-error" role="alert">{error}</p>}
        {!busy && hasSpeech && !waiting && (
          <button className="big-btn photo-btn" onClick={build} disabled={!online || left === 0}>
            Build Summary
          </button>
        )}
      </section>
    );
  }

  // ---------- review and edit ----------
  const approved = summaryDoc.status === "approved";
  // Out of date: the wrap-up notes changed since this summary was written
  const notesUsed = summaryDoc.notesUsed || {};
  // ...or a stop's words were corrected (summaries written before this was tracked skip it)
  const stopsUsed = summaryDoc.stopsUsed;
  const stopsChanged =
    !!stopsUsed &&
    stops.some((s) => !s.isPending && Object.hasOwn(stopsUsed, s.id) && (stopsUsed[s.id] || "") !== stopText(s));
  // ...or a photo description was added, corrected, or deleted
  const photosUsed = summaryDoc.photosUsed;
  const photosChanged =
    !!photosUsed &&
    stops.some((s) => !s.isPending && Object.hasOwn(photosUsed, s.id) && (photosUsed[s.id] || "") !== photoText(s));
  const outOfDate =
    !notesWaiting &&
    ((notesUsed.field || "") !== noteViews.field.text ||
      (notesUsed.customer || "") !== noteViews.customer.text ||
      stopsChanged ||
      photosChanged);
  const handEdited = !!summaryDoc.editedAt;
  return (
    <section className="summary-card" aria-label="AI summary">
      <div className="summary-head">
        <h2>AI summary</h2>
        {approved ? (
          <span className="badge is-approved">Approved</span>
        ) : (
          <span className="badge is-draft">AI draft</span>
        )}
      </div>
      {approved ? (
        <p className="summary-meta">
          Approved by {summaryDoc.approvedBy || ANONYMOUS_NAME} · {when(summaryDoc.approvedAt)}. Editing puts it back to draft.
        </p>
      ) : (
        <p className="summary-meta">Written by AI from your voice notes and photo descriptions. Check it, tap Edit to fix anything wrong, then approve it.</p>
      )}
      {outOfDate && !busy && (
        <div className="summary-stale" role="status">
          <p>Your notes changed since this summary was written.</p>
          <button className="big-btn photo-btn" onClick={() => setConfirmRegen(true)} disabled={!online || left === 0}>
            Regenerate summary
          </button>
        </div>
      )}
      {busy && <p className="summary-status is-busy" role="status">Building a new summary…</p>}
      {error && <p className="summary-error" role="alert">{error}</p>}

      <p className="summary-text">{draft.summary}</p>
      <button type="button" className="stop-more" onClick={() => setEditor("summary")}>
        Edit summary
      </button>

      <h3>
        Action items <span className="count">{draft.action_items.length}</span>
      </h3>
      <ul className="summary-list">
        {draft.action_items.map((item, i) => (
          <ItemRow
            key={item.id}
            item={item}
            numberOf={numberOf}
            onEdit={() => setEditor({ index: i })}
            onJump={onJumpToStop}
          />
        ))}
      </ul>
      <button type="button" className="add-btn" onClick={() => setEditor({ index: -1 })}>
        + Add action item
      </button>

      {removed && (
        <p className="undo-bar" role="status">
          Item removed.{" "}
          <button type="button" className="text-btn inline" onClick={undoRemove}>
            Undo
          </button>
        </p>
      )}

      {!approved && (
        <button className="save-btn approve-btn" onClick={approve} disabled={busy || !draft.summary.trim()}>
          Approve Summary
        </button>
      )}
      <button type="button" className="text-btn regen-link" onClick={() => setConfirmRegen(true)} disabled={busy || !online || left === 0}>
        Regenerate summary
      </button>
      <p className="summary-meta">
        {left === 0
          ? `You've used all ${PER_JOB_LIMIT} summaries for this job (demo limit).`
          : `${left} of ${PER_JOB_LIMIT} summaries left for this job.`}
        {!online && " Regenerating needs signal."}
      </p>
      <SummaryEngLine summary={summaryDoc} perJobLimit={PER_JOB_LIMIT} />

      {editor === "summary" && (
        <SummarySheet
          text={draft.summary}
          onClose={() => setEditor(null)}
          onSave={(text) => {
            commit({ ...draft, summary: text });
            setEditor(null);
          }}
        />
      )}
      {editor?.index !== undefined && (
        <ItemSheet
          item={editor.index < 0 ? null : draft.action_items[editor.index]}
          onClose={() => setEditor(null)}
          onSave={(item) => {
            saveItem(editor.index, item);
            setEditor(null);
          }}
          onRemove={() => {
            removeItem("action_items", editor.index);
            setEditor(null);
          }}
        />
      )}

      {confirmRegen && (
        <Sheet title={handEdited ? "Regenerate?" : "Regenerate the summary?"} onClose={() => setConfirmRegen(false)}>
          <p>
            {handEdited
              ? "Your edits to the summary will be replaced."
              : "The AI writes a new draft from your voice notes and wrap-up notes. It replaces the current summary"}
            {handEdited ? "" : "."}
            {approved ? " It will go back to draft and need approving again." : ""}
          </p>
          <button
            className="big-btn danger-btn"
            onClick={() => {
              setConfirmRegen(false);
              build();
            }}
          >
            Regenerate
          </button>
          <button className="big-btn plain-btn" onClick={() => setConfirmRegen(false)}>
            Keep This One
          </button>
        </Sheet>
      )}
    </section>
  );
}
