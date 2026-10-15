import { useEffect, useMemo, useRef, useState } from "react";
import { FILTERS, groupByCompany, groupByTitle, recipientOf, searchPeople, updatedLabel } from "../directorySearch";

// Who is this for? Search the project's Procore directory (loaded once, searched on the phone) by
// Name / Title / Company / All, tap people to tag them, or tag a whole company or every match at once.
// Typing and tapping only: no microphone (Procore's frame blocks it). With allowCc, each picked person has
// a To / CC switch: To = responsible (to-dos, alerts, For Me), CC = kept in the loop (their CC tab only).
// A person switched to CC carries cc: true in the selected list.
export const MAX_TAGGED = 50;
const PLACEHOLDER = { name: "Search by name", title: "Search by title, like foreman", company: "Search by company", all: "Search name, title or company" };
const SHOW_MAX = 60;

export default function RecipientSearch({ dir, dirError, loadingDir, onRefresh, projectName, selected, onChange, onDone, doneLabel = "Done", alreadyTagged = [], noteFor = null, allowCc = false }) {
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
  const setCc = (id, cc) => onChange(selected.map((r) => (r.procoreUserId === id ? { ...r, cc } : r)));
  const ccCount = selected.filter((r) => r.cc).length;
  const toCount = selected.length - ccCount;
  const doneCount = allowCc && ccCount
    ? `${toCount} To, ${ccCount} CC`
    : `${selected.length} ${selected.length === 1 ? "person" : "people"} tagged`;
  const allIn = (list) => list.every((p) => picked.has(String(p.id)) || fixed.has(String(p.id)));

  const row = (p) => {
    const on = picked.has(String(p.id)) || fixed.has(String(p.id));
    const sub = [filter === "title" ? null : p.title || p.role, filter === "company" ? null : p.company].filter(Boolean).join(" · ");
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
      {dir && query.trim() && results.length > 1 && filter !== "company" && filter !== "title" && !allIn(results) && (
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
      ) : filter === "title" ? (
        <div className="dir-groups">
          {groupByTitle(shown).map((g) => (
            <div key={g.title ?? "none"}>
              <div className="dir-group-head">
                <h3>{g.title ?? "No title in Procore"}{g.people.length > 1 ? ` (${g.people.length})` : ""}</h3>
                {g.title && g.people.length > 1 && !allIn(g.people) && (
                  <button type="button" className="stop-more dir-group-btn" onClick={() => add(g.people)}>Tag all {g.people.length}</button>
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

      {selected.length > 0 && allowCc && (
        <ul className="dir-picked-list" aria-label="Picked">
          {selected.map((r) => (
            <li key={r.procoreUserId} className="dir-picked-row">
              <strong>{r.name}</strong>
              <div className="dir-filters to-cc" role="group" aria-label={`${r.name}: To or CC`}>
                <button type="button" className={r.cc ? "" : "is-on"} aria-pressed={!r.cc} onClick={() => setCc(r.procoreUserId, false)}>To</button>
                <button type="button" className={r.cc ? "is-on" : ""} aria-pressed={!!r.cc} onClick={() => setCc(r.procoreUserId, true)}>CC</button>
              </div>
              <button type="button" className="text-btn inline" onClick={() => onChange(selected.filter((x) => x.procoreUserId !== r.procoreUserId))} aria-label={`Remove ${r.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && allowCc && <p className="dir-meta">To: responsible, gets the to-do and alerts. CC: sees it in their CC tab, no alerts.</p>}
      {selected.length > 0 && !allowCc && (
        <div className="dir-picked" aria-label="Tagged">
          {selected.map((r) => (
            <button key={r.procoreUserId} type="button" className="place-chip is-on" onClick={() => onChange(selected.filter((x) => x.procoreUserId !== r.procoreUserId))} aria-label={`Remove ${r.name}`}>
              {r.name} ×
            </button>
          ))}
        </div>
      )}
      <button type="button" className="save-btn dir-done" onClick={onDone}>
        {selected.length ? `${doneLabel} · ${doneCount}` : doneLabel}
      </button>
    </div>
  );
}
