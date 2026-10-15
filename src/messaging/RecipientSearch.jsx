import { useEffect, useMemo, useRef, useState } from "react";
import { FILTERS, groupByCompany, recipientOf, searchPeople, updatedLabel } from "../directorySearch";

// Who is this for? Search the project's Procore directory (loaded once, searched on the phone) by
// Name / Title / Company / All, tap people to tag them, or tag a whole company or every match at once.
// Typing and tapping only: no microphone (Procore's frame blocks it).
export const MAX_TAGGED = 50;
const PLACEHOLDER = { name: "Search by name", title: "Search by title, like foreman", company: "Search by company", all: "Search name, title or company" };
const SHOW_MAX = 60;

export default function RecipientSearch({ dir, dirError, loadingDir, onRefresh, projectName, selected, onChange, onDone, doneLabel = "Done", alreadyTagged = [], noteFor = null }) {
  const [filter, setFilter] = useState("name");
  const [query, setQuery] = useState("");
  const input = useRef(null);
  useEffect(() => { if (dir) input.current?.focus({ preventScroll: true }); }, [dir]);

  const people = useMemo(() => dir?.people ?? [], [dir]);
  const results = useMemo(() => searchPeople(people, query, filter), [people, query, filter]);
  const shown = results.slice(0, SHOW_MAX);
  const picked = new Set(selected.map((r) => r.procoreUserId));
  const fixed = new Set(alreadyTagged.map(String));

  const add = (list) => {
    const next = [...selected];
    for (const p of list) {
      const r = recipientOf(p);
      if (!picked.has(r.procoreUserId) && !fixed.has(r.procoreUserId) && next.length < MAX_TAGGED) next.push(r);
    }
    onChange(next);
  };
  const toggle = (p) => {
    const id = String(p.id);
    if (fixed.has(id)) return;
    if (picked.has(id)) onChange(selected.filter((r) => r.procoreUserId !== id));
    else add([p]);
  };
  const allIn = (list) => list.every((p) => picked.has(String(p.id)) || fixed.has(String(p.id)));

  const row = (p) => {
    const on = picked.has(String(p.id)) || fixed.has(String(p.id));
    const sub = [p.title || p.role, filter === "company" ? null : p.company].filter(Boolean).join(" · ");
    const note = noteFor?.(p) ?? "";
    return (
      <li key={p.id}>
        <button type="button" className={`dir-person${on ? " is-on" : ""}${note ? " is-limited" : ""}`} aria-pressed={on} onClick={() => toggle(p)} disabled={fixed.has(String(p.id))}>
          <span className="dir-check" aria-hidden="true">{on ? "✓" : ""}</span>
          <span className="dir-who">
            <strong>{p.name ?? "Unnamed"}</strong>
            {sub && <span>{sub}</span>}
            {fixed.has(String(p.id)) && <small>Already on this message</small>}
            {note && <small className="dir-note">{note}</small>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="dir-search">
      <h2>Who is this for?</h2>
      <input
        ref={input}
        type="search"
        className="dir-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={PLACEHOLDER[filter]}
        aria-label={PLACEHOLDER[filter]}
        autoComplete="off"
        enterKeyHint="search"
      />
      <div className="dir-filters" role="group" aria-label="Search by">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" className={filter === id ? "is-on" : ""} aria-pressed={filter === id} onClick={() => { setFilter(id); input.current?.focus({ preventScroll: true }); }}>
            {label}
          </button>
        ))}
      </div>
      <p className="dir-meta">
        {dir ? `${results.length} ${results.length === 1 ? "person" : "people"}` : loadingDir ? "Loading people…" : ""}
        {dir && ` · Updated ${updatedLabel(dir.at)}`}
        {loadingDir && dir && " · Refreshing…"}
      </p>
      <button type="button" className="text-btn dir-refresh" onClick={onRefresh} disabled={loadingDir}>Refresh Directory</button>
      {dirError && <p className="procore-note procore-error" role="alert">{dirError}</p>}
      {dir?.compact && <p className="procore-note">Procore only shows you names and companies on this project, so Title search may find no one.</p>}

      {dir && people.length === 0 && <p className="procore-note">No one is on this project's directory yet.</p>}
      {dir && people.length > 0 && results.length === 0 && <p className="procore-note">No matches in {projectName}. Try another filter.</p>}
      {dir && query.trim() && results.length > 1 && filter !== "company" && !allIn(results) && (
        <button type="button" className="stop-more dir-group-btn" onClick={() => add(results)}>Tag all {results.length} matches</button>
      )}
      {dir && results.length > 0 && (filter === "company" ? (
        <div className="dir-groups">
          {groupByCompany(shown).map((g) => (
            <div key={g.company ?? "none"}>
              <div className="dir-group-head">
                <h3>{g.company ?? "No company in Procore"}</h3>
                {g.company && !allIn(g.people) && (
                  <button type="button" className="stop-more dir-group-btn" onClick={() => add(g.people)}>Tag everyone at {g.company}</button>
                )}
              </div>
              <ul className="dir-list">{g.people.map(row)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="dir-list">{shown.map(row)}</ul>
      ))}
      {results.length > SHOW_MAX && <p className="procore-note">Showing {SHOW_MAX} of {results.length}. Keep typing to narrow it down.</p>}

      {selected.length > 0 && (
        <div className="dir-picked" aria-label="Tagged">
          {selected.map((r) => (
            <button key={r.procoreUserId} type="button" className="place-chip is-on" onClick={() => onChange(selected.filter((x) => x.procoreUserId !== r.procoreUserId))} aria-label={`Remove ${r.name}`}>
              {r.name} ×
            </button>
          ))}
        </div>
      )}
      <button type="button" className="save-btn dir-done" onClick={onDone}>
        {selected.length ? `${doneLabel} · ${selected.length} ${selected.length === 1 ? "person" : "people"} tagged` : doneLabel}
      </button>
    </div>
  );
}
