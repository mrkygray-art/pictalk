import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import {
  watchSummary, hasSummary, requestSummary, saveSummaryEdits, approveSummary,
  isTranscriptPending, PRIORITIES,
} from "./summaryStore";
import { getSavedInitials, ANONYMOUS_NAME } from "./exportJob";

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
const rowsFor = (text) => Math.max(2, Math.ceil((text || "").length / 34));

function StopLinks({ ids, numberOf, onJump }) {
  if (!ids.length) return null;
  return (
    <div className="stop-links">
      {ids.map((id) => (
        <button key={id} type="button" className="stop-link" onClick={() => onJump(id)}>
          {numberOf.has(id) ? `Stop ${numberOf.get(id)}` : "Stop removed"} ›
        </button>
      ))}
    </div>
  );
}

function ItemEditor({ item, kind, numberOf, onText, onBlur, onPriority, onRemove, onJump }) {
  return (
    <li className="summary-item">
      {kind === "action" && (
        <div className="priority-row" role="group" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={`priority-btn is-${p}${item.priority === p ? " is-on" : ""}`}
              aria-pressed={item.priority === p}
              onClick={() => onPriority(p)}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="summary-field"
        value={item.text}
        rows={rowsFor(item.text)}
        placeholder={kind === "action" ? "What needs to be done" : "What still needs an answer"}
        aria-label={kind === "action" ? "Action item" : "Open question"}
        onChange={(e) => onText(e.target.value)}
        onBlur={onBlur}
      />
      <div className="item-foot">
        <StopLinks ids={item.source_stop_ids} numberOf={numberOf} onJump={onJump} />
        <button type="button" className="remove-btn" onClick={onRemove}>
          Remove
        </button>
      </div>
    </li>
  );
}

/**
 * Summary section on a finished job's page: builds the AI draft (automatically right
 * after End Job, otherwise with a button), then lets the user edit and approve it.
 */
export default function JobSummary({ uid, job, stops, online, autoStart, onJumpToStop }) {
  const [summaryDoc, setSummaryDoc] = useState(undefined); // undefined = loading, null = none
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [removed, setRemoved] = useState(null); // { list, index, item } for Undo
  const [now, setNow] = useState(() => Date.now());
  const dirty = useRef(false);
  const autoTried = useRef(false);

  useEffect(() => {
    if (!uid) return;
    return watchSummary(uid, job.id, (data) => {
      setSummaryDoc(data);
      // Don't overwrite what the user is typing
      if (hasSummary(data) && !dirty.current) setDraft(toDraft(data));
    });
  }, [uid, job.id]);

  const numberOf = new Map(stops.map((s, i) => [s.id, i + 1]));
  const waiting = stops.filter((s) => isTranscriptPending(s, now)).length;
  // The summary is written from speech; stops without it (photo only, no speech heard) add nothing
  const hasSpeech = stops.some((s) => (s.transcript || "").trim());
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
      dirty.current = false;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Right after End Job: build automatically once everything is ready
  useEffect(() => {
    if (!autoStart || autoTried.current || summaryDoc !== null || busy) return;
    if (waiting || !online || !stops.some((s) => (s.transcript || "").trim())) return;
    autoTried.current = true;
    Promise.resolve().then(build);
  });

  const commit = (next) => {
    const clean = tidy(next);
    setDraft(clean);
    dirty.current = false;
    saveSummaryEdits(uid, job.id, clean);
  };
  const edit = (next) => {
    dirty.current = true;
    setDraft(next);
  };
  const setItem = (list, index, patch) => ({
    ...draft,
    [list]: draft[list].map((it, i) => (i === index ? { ...it, ...patch } : it)),
  });
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
  const addItem = (list) => {
    const item = { id: `u${Date.now()}`, text: "", source_stop_ids: [] };
    if (list === "action_items") item.priority = "medium";
    edit({ ...draft, [list]: [...draft[list], item] });
  };
  const approve = () => {
    const clean = tidy(draft);
    setDraft(clean);
    dirty.current = false;
    approveSummary(uid, job.id, clean, getSavedInitials() || ANONYMOUS_NAME);
  };

  if (summaryDoc === undefined) return null;

  // ---------- no summary yet ----------
  if (!hasSummary(summaryDoc)) {
    let status = null;
    if (busy) status = "Building summary… this can take up to a minute.";
    else if (waiting) status = `Waiting for ${waiting} voice note${waiting === 1 ? "" : "s"} to upload and be written down…`;
    else if (!hasSpeech) {
      status = "No summary for this job: the AI summary is written from what you say at each stop, and none of these stops have spoken notes.";
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
        <p className="summary-meta">Written by AI from your voice notes. Check it, fix anything wrong, then approve it.</p>
      )}
      {busy && <p className="summary-status is-busy" role="status">Building a new summary…</p>}
      {error && <p className="summary-error" role="alert">{error}</p>}

      <textarea
        className="summary-field is-summary"
        value={draft.summary}
        rows={rowsFor(draft.summary)}
        aria-label="Summary"
        onChange={(e) => edit({ ...draft, summary: e.target.value })}
        onBlur={() => dirty.current && commit(draft)}
      />

      <h3>
        Action items <span className="count">{draft.action_items.length}</span>
      </h3>
      <ul className="summary-list">
        {draft.action_items.map((item, i) => (
          <ItemEditor
            key={item.id}
            item={item}
            kind="action"
            numberOf={numberOf}
            onText={(text) => edit(setItem("action_items", i, { text }))}
            onBlur={() => dirty.current && commit(draft)}
            onPriority={(priority) => commit(setItem("action_items", i, { priority }))}
            onRemove={() => removeItem("action_items", i)}
            onJump={onJumpToStop}
          />
        ))}
      </ul>
      <button type="button" className="add-btn" onClick={() => addItem("action_items")}>
        + Add action item
      </button>

      <h3>
        Open questions <span className="count">{draft.open_questions.length}</span>
      </h3>
      <ul className="summary-list">
        {draft.open_questions.map((item, i) => (
          <ItemEditor
            key={item.id}
            item={item}
            kind="question"
            numberOf={numberOf}
            onText={(text) => edit(setItem("open_questions", i, { text }))}
            onBlur={() => dirty.current && commit(draft)}
            onRemove={() => removeItem("open_questions", i)}
            onJump={onJumpToStop}
          />
        ))}
      </ul>
      <button type="button" className="add-btn" onClick={() => addItem("open_questions")}>
        + Add question
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
      <button className="big-btn plain-btn" onClick={() => setConfirmRegen(true)} disabled={busy || !online || left === 0}>
        Regenerate
      </button>
      <p className="summary-meta">
        {left === 0
          ? `You've used all ${PER_JOB_LIMIT} summaries for this job (demo limit).`
          : `${left} of ${PER_JOB_LIMIT} summaries left for this job.`}
        {!online && " Regenerating needs signal."}
      </p>

      {confirmRegen && (
        <Sheet title="Regenerate the summary?" onClose={() => setConfirmRegen(false)}>
          <p>
            The AI writes a new draft from your voice notes. It replaces the current summary
            {approved ? ", which will need approving again" : ", including any edits you made"}.
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
