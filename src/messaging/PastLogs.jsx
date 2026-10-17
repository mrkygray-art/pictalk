import { useEffect, useState } from "react";
import { BackIcon } from "./icons";
import { changeEntry, pastLogs, SECTIONS } from "./dailyLogStore";
import { Entry } from "./DailyLogEntry";
import { addDays, fmtDate, label12, payload, problem } from "./dailyLogFormat";
import Sheet from "../Sheet";

// Past logs: what's already in Procore's Daily Log for this project, read live from Procore with the person's own
// sign-in. Days list (only days with entries, newest first, 30 days at a time, Show older logs, Go to a day; the list
// scrolls in its own box) -> one day, by section. Everyone's entries
// are shown; only your own have Edit and Delete, and Procore refuses both once the day is marked Completed (the
// day then says it's locked). SiteSnap never changes an entry's approval status.
// Props: project, opts (the Daily Log options: companies, locations, delay types), draftDate + draftBusy (a draft
// for another day stops "Add to this day"), onAddToDay(date), tabs (the New log | Past logs switch), onClose,
// day + onDay (the open day lives in DailyLogFlow, so tapping the Past logs tab inside a day goes back to the list).

const SPAN = 30; // the server takes up to 31 days per read
const STATUS = { approved: "Approved", pending: "Waiting on approval", submitted: "Waiting on approval" };

function dayWord(iso, today) {
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  return "";
}
function daySummary(list) {
  if (!list.length) return "Nothing logged";
  const parts = [];
  const workers = list.filter((x) => x.section === "manpower").reduce((a, x) => a + (Number(x.entry.workers) || 0), 0);
  if (list.some((x) => x.section === "manpower")) parts.push(`${workers} worker${workers === 1 ? "" : "s"}`);
  for (const s of SECTIONS.slice(1)) {
    const n = list.filter((x) => x.section === s.key).length;
    if (n) parts.push(`${n} ${n === 1 ? s.one : s.many}`);
  }
  return parts.join(" · ");
}
// The line a past entry shows (names from Procore, so a company no longer on the project still reads right)
function pastLine(item, opts) {
  const e = item.entry;
  const co = e.companyName ?? (opts?.companies ?? []).find((c) => Number(c.id) === Number(e.company))?.name ?? "";
  if (item.section === "manpower") return { main: `${e.workers} worker${e.workers === 1 ? "" : "s"}${co ? ` · ${co}` : ""}`, more: [e.hours != null ? `${e.hours} hours each` : "", e.locationName, e.comment].filter(Boolean).join(" · ") };
  if (item.section === "delays") return { main: e.type ? typeName(e.type, opts) : "Delay", more: [e.start ? `${label12(e.start)}${e.end ? ` – ${label12(e.end)}` : ""}` : "", co, e.locationName, e.comment].filter(Boolean).join(" · ") };
  if (item.section === "deliveries") return { main: e.what || "Delivery", more: [e.time ? label12(e.time) : "", e.from ? `from ${e.from}` : "", e.comment].filter(Boolean).join(" · ") };
  return { main: e.text || "Note", more: e.locationName ?? "" };
}
// Procore answers the delay type as its key ("weather"); the edit form picks by the project's names
function typeName(t, opts) {
  const s = String(t ?? "");
  const hit = (opts?.delayTypes ?? []).find((x) => x.key === s || x.name === s || x.name?.toLowerCase().replace(/[^a-z0-9]+/g, "_") === s);
  return hit?.name ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default function PastLogs({ project, opts, draftDate, draftBusy, onAddToDay, tabs, onClose, day, onDay }) {
  const today = opts?.today;
  const [from, setFrom] = useState(() => (today ? addDays(today, -(SPAN - 1)) : null));
  const [entries, setEntries] = useState([]);
  const [state, setState] = useState("loading"); // loading | ready | more | error | locked
  const [error, setError] = useState("");
  const [jump, setJump] = useState("");

  // 30 days at a time; "Show older logs" adds the 30 days before
  const apply = (r, add) => {
    if (r.error) { setError(r.error); setState(add ? "ready" : "error"); return; }
    if (!r.access) { setError(r.reason + (r.template ? ` Your Procore permission template here is ${r.template}.` : "")); setState("locked"); return; }
    setEntries((list) => (add ? [...list, ...r.entries] : r.entries));
    setError("");
    setState("ready");
  };
  useEffect(() => {
    if (!today) return undefined;
    let live = true;
    pastLogs(project, addDays(today, -(SPAN - 1)), today).then((r) => { if (live) apply(r, false); });
    return () => { live = false; };
  }, [project, today]);
  const retry = () => { setState("loading"); pastLogs(project, from, today).then((r) => apply(r, false)); };
  const older = () => {
    const f = addDays(from, -SPAN);
    setState("more");
    setFrom(f);
    pastLogs(project, f, addDays(from, -1)).then((r) => apply(r, true));
  };

  if (day) {
    return (
      <PastDay project={project} opts={opts} date={day} tabs={tabs} onBack={() => onDay(null)}
        canAdd={!draftBusy || draftDate === day} draftDate={draftDate} onAddToDay={() => onAddToDay(day)}
        onChanged={(list) => setEntries((all) => [...all.filter((x) => x.date !== day), ...list])} />
    );
  }

  // Only days with something logged, newest first
  const days = [...new Set(entries.map((x) => x.date))].filter((d) => d >= from).sort().reverse();
  return (
    <section className="report" aria-label="Past logs">
      <button type="button" className="link-btn msg-home-back" onClick={onClose}><BackIcon /> Home</button>
      <h2 className="page-title">Daily log</h2>
      {tabs}
      <p className="msg-status">{project.name} · straight from Procore</p>
      {state === "loading" && <p className="msg-status" aria-live="polite">Loading past logs from Procore…</p>}
      {(state === "error" || state === "locked") && (
        <div className="dl-locked"><strong>{error}</strong>{state === "error" && <button type="button" className="text-btn" onClick={retry}>Try again</button>}</div>
      )}
      {(state === "ready" || state === "more") && (
        <>
          <label className="msg-field"><span>Go to a day</span>
            <input type="date" className="dir-input" max={today} value={jump} onChange={(e) => { setJump(e.target.value); if (e.target.value >= "2000-01-01") onDay(e.target.value); /* typing a year passes through 0002, 0020... */ }} />
          </label>
          <p className="msg-status">{days.length ? `${days.length} day${days.length === 1 ? "" : "s"} with logs since ${fmtDate(from)}` : `No logs since ${fmtDate(from)}.`}</p>
          {days.length > 0 && <ul className="dl-days" aria-label="Days with logs">
            {days.map((d) => {
              const list = entries.filter((x) => x.date === d);
              const mine = list.filter((x) => x.mine).length;
              const word = dayWord(d, today);
              return (
                <li key={d}>
                  <button type="button" className="dl-day" onClick={() => onDay(d)}>
                    <span className="dl-day-name">{word ? `${word} · ` : ""}{fmtDate(d)}<small>{daySummary(list)}</small></span>
                    {mine > 0 && <span className="dl-yours">{mine} yours</span>}
                    <span className="dl-chev" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="button" className="text-btn" onClick={older} disabled={state === "more"}>{state === "more" ? "Loading…" : "Show older logs"}</button>
        </>
      )}
    </section>
  );
}

// ---------- one day ----------

function PastDay({ project, opts, date, tabs, onBack, canAdd, draftDate, onAddToDay, onChanged }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [edit, setEdit] = useState(null); // { item, e }
  const [del, setDel] = useState(null); // item
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [done, setDone] = useState("");
  const today = opts?.today;

  const apply = (r) => {
    if (r.error || !r.access) { setError(r.error ?? r.reason); setList([]); return; }
    setError("");
    setList(r.entries);
    onChanged(r.entries);
  };
  useEffect(() => {
    let live = true;
    pastLogs(project, date).then((r) => { if (live) apply(r); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, date]);
  const load = () => { setList(null); setError(""); pastLogs(project, date).then(apply); };

  const failed = (err) => {
    if (err.code === "day_locked") { setLocked(true); setEdit(null); setDel(null); return; }
    setSheetError(err.message);
  };
  const save = async () => {
    if (problem(edit.item.section, edit.e)) return;
    setBusy(true); setSheetError("");
    try {
      const r = await changeEntry(project, { action: "update", section: edit.item.section, id: edit.item.id, entry: payload(edit.item.section, edit.e) });
      const next = list.map((x) => (x.id === edit.item.id && x.section === edit.item.section ? { ...x, ...(r.entry ?? {}), entry: r.entry?.entry ?? { ...x.entry, ...edit.e } } : x));
      setList(next); onChanged(next); setEdit(null); setDone("Saved in Procore.");
    } catch (err) { failed(err); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setSheetError("");
    try {
      await changeEntry(project, { action: "delete", section: del.section, id: del.id });
      const next = list.filter((x) => !(x.id === del.id && x.section === del.section));
      setList(next); onChanged(next); setDel(null); setDone("Deleted from Procore.");
    } catch (err) { failed(err); } finally { setBusy(false); }
  };
  const openEdit = (item) => {
    setDone(""); setSheetError("");
    const e = { ...item.entry, id: `p${item.id}`, flags: [] };
    if (item.section === "delays") e.type = e.type ? typeName(e.type, opts) : "";
    setEdit({ item, e });
  };
  // The entry's own company stays pickable even if it's no longer active on the project
  const editOpts = edit && edit.e.company && !(opts?.companies ?? []).some((c) => Number(c.id) === Number(edit.e.company))
    ? { ...opts, companies: [{ id: edit.e.company, name: edit.e.companyName ?? "Company" }, ...(opts?.companies ?? [])] } : opts;

  const word = dayWord(date, today);
  const mine = (list ?? []).filter((x) => x.mine).length;
  return (
    <section className="report" aria-label={`Daily log for ${fmtDate(date)}`}>
      <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> Past logs</button>
      <h2 className="page-title">{word ? `${word}, ` : ""}{fmtDate(date)}</h2>
      {tabs}
      <p className="msg-status">{project.name} · Daily Log in Procore</p>
      {list === null && <p className="msg-status" aria-live="polite">Loading this day from Procore…</p>}
      {error && <div className="dl-locked"><strong>{error}</strong><button type="button" className="text-btn" onClick={load}>Try again</button></div>}
      {locked && <p className="dl-banner" role="alert"><b>This day is locked in Procore.</b> It&rsquo;s been marked Completed, so nobody can change it. Ask your superintendent to reopen it in Procore.</p>}
      {done && <p className="dl-saved" role="status">{done}</p>}
      {list && !error && list.length === 0 && <p className="dl-empty is-day">Nothing in the Daily Log for this day yet.</p>}
      {list && list.length > 0 && !locked && mine > 0 && <p className="msg-new-hint">You can edit or delete your own entries until the day is marked Completed.</p>}
      {list && SECTIONS.map((s) => {
        const items = list.filter((x) => x.section === s.key);
        if (!items.length) return null;
        return (
          <section key={s.key} className="dl-sec">
            <h3 className="dl-sec-title">{s.name}</h3>
            <div className="dl-sec-body">
              {items.map((item) => {
                const line = pastLine(item, opts);
                return (
                  <article key={`${s.key}-${item.id}`} className={`dl-past${item.mine ? " is-mine" : ""}`}>
                    <strong>{line.main}</strong>
                    {line.more && <p>{line.more}</p>}
                    <div className="dl-past-meta">
                      <span>{item.mine ? "You" : item.by?.name ?? "Someone"}</span>
                      {STATUS[item.status] && <span className={`dl-status is-${item.status === "approved" ? "ok" : "wait"}`}>{STATUS[item.status]}</span>}
                      {item.photos > 0 && <span>{item.photos} photo{item.photos === 1 ? "" : "s"}</span>}
                    </div>
                    {item.mine && !locked && (
                      <div className="dl-past-actions">
                        <button type="button" className="dl-edit" onClick={() => openEdit(item)}>Edit</button>
                        <button type="button" className="dl-delete" onClick={() => { setDone(""); setSheetError(""); setDel(item); }}>Delete</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {list && !locked && (canAdd
        ? <button type="button" className="save-btn" onClick={onAddToDay}>{list.some((x) => x.mine) ? "Add more to this day" : "Log this day"}</button>
        : <p className="msg-status">You have a draft for {fmtDate(draftDate)}. Send it first, then you can add to this day.</p>)}
      {edit && (
        <Sheet title={`Edit ${SECTIONS.find((s) => s.key === edit.item.section).one}`} onClose={() => !busy && setEdit(null)}>
          <div className="dl-edit-sheet">
            <Entry section={edit.item.section} e={edit.e} opts={editOpts} sent={false}
              onSet={(patch) => setEdit((x) => ({ ...x, e: { ...x.e, ...patch } }))} onFix={() => {}} />
            {sheetError && <p className="error" role="alert">{sheetError}</p>}
            <p className="msg-new-hint">Saves straight to Procore. The approval status stays as it is in Procore.</p>
            <button type="button" className="save-btn" onClick={save} disabled={busy || !!problem(edit.item.section, edit.e)}>{busy ? "Saving…" : "Save to Procore"}</button>
            <button type="button" className="text-btn" onClick={() => setEdit(null)} disabled={busy}>Cancel</button>
          </div>
        </Sheet>
      )}
      {del && (
        <Sheet title="Delete this entry?" onClose={() => !busy && setDel(null)}>
          <div className="dl-edit-sheet">
            <p><strong>{pastLine(del, opts).main}</strong></p>
            <p className="msg-status">It comes out of Procore&rsquo;s Daily Log for {fmtDate(date)}. This can&rsquo;t be undone.</p>
            {sheetError && <p className="error" role="alert">{sheetError}</p>}
            <button type="button" className="save-btn is-danger" onClick={remove} disabled={busy}>{busy ? "Deleting…" : "Delete from Procore"}</button>
            <button type="button" className="text-btn" onClick={() => setDel(null)} disabled={busy}>Keep it</button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
