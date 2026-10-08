import { useState } from "react";
import Sheet from "../Sheet";
import { compareDraft } from "./piccoloStore";

/**
 * Edit one text item: a task, a requirement, an installation note, a location name, the
 * scope, or an open question (questions also get an answer box).
 */
export function ItemSheet({ title, initial = "", answer, multiline, allowEmpty, maxLength = 500, onSave, onDelete, onClose }) {
  const [text, setText] = useState(initial);
  const [ans, setAns] = useState(answer ?? "");
  const isQuestion = answer !== undefined;
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() && !allowEmpty) return;
          onSave(text.trim(), ans.trim());
        }}
      >
        <div className="detail-fields">
          <label>
            {isQuestion ? "Question" : "Text"}
            {multiline ? (
              <textarea className="words-field" value={text} rows={6} maxLength={maxLength} onChange={(e) => setText(e.target.value)} />
            ) : (
              <input value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} autoFocus={!initial} />
            )}
          </label>
          {isQuestion && (
            <label>
              Answer (leave blank if you don't know yet)
              <textarea className="words-field" value={ans} rows={3} maxLength={1000} onChange={(e) => setAns(e.target.value)} />
            </label>
          )}
        </div>
        <button type="submit" className="save-btn" disabled={!text.trim() && !allowEmpty}>
          Save
        </button>
        {onDelete && (
          <button type="button" className="big-btn plain-btn is-danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className="text-btn" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}

// Compare a newer AI draft with the user's version: add lines or questions one at a time,
// or replace everything.
export function CompareSheet({ mine, draft, onAddLine, onAddQuestion, onReplace, onClose }) {
  const [taken, setTaken] = useState(() => new Set());
  const diff = compareDraft(mine, draft);
  const take = (id, fn) => {
    fn();
    setTaken((t) => new Set(t).add(id));
  };
  const nothing = !diff.added.length && !diff.changed.length && !diff.missing.length && !diff.questions.length;
  return (
    <Sheet title={`Compare with draft ${draft.version}`} onClose={onClose}>
      {nothing && <p>Draft {draft.version} has the same lines and questions as your version.</p>}
      {diff.added.length > 0 && (
        <section className="pc-compare">
          <h3>New in draft {draft.version}</h3>
          {diff.added.map((l) => (
            <div key={l.id} className="pc-compare-row">
              <span>
                {l.qty} {l.unit} · {l.description}
                {l.location ? ` (${l.location})` : ""}
              </span>
              <button className="link-btn" disabled={taken.has(l.id)} onClick={() => take(l.id, () => onAddLine(l))}>
                {taken.has(l.id) ? "Added" : "Add"}
              </button>
            </div>
          ))}
        </section>
      )}
      {diff.changed.length > 0 && (
        <section className="pc-compare">
          <h3>Different quantity or part number</h3>
          {diff.changed.map((l) => (
            <div key={l.id} className="pc-compare-row">
              <span>
                Draft {draft.version} says {l.qty} {l.unit} · {l.description}
                {l.partNumber ? ` · ${l.partNumber}` : ""}
              </span>
            </div>
          ))}
        </section>
      )}
      {diff.missing.length > 0 && (
        <section className="pc-compare">
          <h3>In your version, not in draft {draft.version}</h3>
          {diff.missing.map((l) => (
            <div key={l.id} className="pc-compare-row">
              <span>{l.description}</span>
            </div>
          ))}
          <p className="pc-hint">These stay unless you delete them.</p>
        </section>
      )}
      {diff.questions.length > 0 && (
        <section className="pc-compare">
          <h3>New questions</h3>
          {diff.questions.map((q) => (
            <div key={q.id} className="pc-compare-row">
              <span>{q.text}</span>
              <button className="link-btn" disabled={taken.has(q.id)} onClick={() => take(q.id, () => onAddQuestion(q))}>
                {taken.has(q.id) ? "Added" : "Add"}
              </button>
            </div>
          ))}
        </section>
      )}
      <button className="big-btn plain-btn is-danger" onClick={onReplace}>
        Replace My Version with Draft {draft.version}
      </button>
      <button className="save-btn" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
