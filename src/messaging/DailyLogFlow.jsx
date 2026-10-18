import { useEffect, useRef, useState } from "react";
import { BackIcon, CameraIcon, MicIcon, StopIcon } from "./icons";
import { formatTime, useRecorder } from "./useRecorder";
import { newId, transcribeVoice, uploadFile, voicePathFor } from "./messagingStore";
import { clearDraft, dailyLogOptions, loadDraft, loadPhotos, markSent, MAX_PHOTOS, organizeLog, saveDraft, savePhotos, SECTIONS, sendEntry } from "./dailyLogStore";
import Sheet from "../Sheet";
import { Entry } from "./DailyLogEntry";
import { addDays, entryLine, fmtDate, payload, problem } from "./dailyLogFormat";
import PastLogs from "./PastLogs";
import { useDemo } from "./demo";

// Daily log by voice (docs/closeout-and-daily-log-spec.md, Feature B). The foreman talks (as many times as they
// like), SiteSnap sorts the words into Manpower, Delays, Deliveries and Notes, the foreman checks the cards, and
// Send writes each entry into Procore's Daily Log for the project's date, one at a time, with its photos.
// Steps: loading -> locked | error | capture -> organizing -> review -> sending (results).
// A New log | Past logs switch sits under the title on the capture and review screens; Past logs (PastLogs.jsx)
// shows what's already in Procore by day, and lets the person edit or delete their own entries.
// Nothing goes to Procore until Send. Blank means "not said": never guessed. Unsure answers carry a
// "Check this" tag with one-tap fixes. The draft stays on the phone until every entry is in.

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const flagCount = (log) => SECTIONS.reduce((n, s) => n + (log?.[s.key] ?? []).reduce((a, e) => a + (e.flags?.length ?? 0), 0), 0);
const entryCount = (log) => SECTIONS.reduce((n, s) => n + (log?.[s.key]?.length ?? 0), 0);

function blankEntry(section, opts) {
  const base = { id: newId(), source: "", flags: [] };
  const mine = opts?.myCompany?.id ?? null;
  if (section === "manpower") return { ...base, company: mine, defaulted: !!mine, workers: "", hours: null, trade: "", location: null, comment: "" };
  if (section === "delays") return { ...base, type: "", start: null, end: null, company: mine, defaulted: !!mine, location: null, comment: "" };
  if (section === "deliveries") return { ...base, what: "", time: null, from: "", comment: "" };
  return { ...base, text: "", location: null };
}

// In the guest demo everything works (talk, photos, Organize) up to Send, which shows the view-only note.
export default function DailyLogFlow({ session, onClose, startTab = "new" }) {
  const { project } = session;
  const { demo, explain } = useDemo();
  const key = `${project.companyId}_${project.projectId}`;
  const [draft, setDraft] = useState(() => loadDraft(key) ?? { id: newId(), date: null, words: "", log: null, sent: {} });
  const draftRef = useRef(draft);
  const [wantDate, setWantDate] = useState(draft.date);
  const [opts, setOpts] = useState(null);
  const [step, setStep] = useState("loading");
  const [photos, setPhotos] = useState([]); // [{ id, blob, url, attach: entry id | null }]
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [wordsState, setWordsState] = useState(null); // working | done | nothing | offline | failed
  const [notice, setNotice] = useState(""); // missed | fallback
  const [datePick, setDatePick] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [ask, setAsk] = useState(null); // fix | flags | dup
  const [sheetPhoto, setSheetPhoto] = useState(null);
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState(startTab); // new | past
  const [pastDay, setPastDay] = useState(null); // the day open in Past logs
  const fileInput = useRef(null);

  // Every change is saved on the phone at once (B8)
  // (worked out from the ref, not inside setState, so the send loop sees each change straight away)
  const update = (fn) => {
    const d = draftRef.current;
    const next = typeof fn === "function" ? fn(d) : { ...d, ...fn };
    draftRef.current = next;
    saveDraft(key, next);
    setDraft(next);
  };

  useEffect(() => {
    let live = true;
    loadPhotos(key).then((list) => {
      if (!live) return;
      setPhotos(list.map((p) => ({ ...p, url: URL.createObjectURL(p.blob) })));
      setPhotosLoaded(true);
    });
    return () => { live = false; };
  }, [key]);
  useEffect(() => {
    if (!photosLoaded) return;
    savePhotos(key, photos);
    update((d) => ({ ...d, photoCount: photos.length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, photosLoaded, key]);
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // B7: can this person use the Daily Log here? Plus the project's lists for the chosen day.
  useEffect(() => {
    let live = true;
    dailyLogOptions(project, wantDate).then((o) => {
      if (!live) return;
      setOpts(o);
      if (o.error) return setStep("error");
      if (!o.access) return setStep("locked");
      if (!draftRef.current.date) update({ date: o.date });
      setStep((s) => (s === "loading" ? (draftRef.current.log ? "review" : "capture") : s));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, wantDate]);

  const recorder = useRecorder(async (blob) => {
    if (!navigator.onLine) return setWordsState("offline");
    setWordsState("working");
    try {
      const path = await uploadFile(voicePathFor(key, `dailylog-${draftRef.current.id}`, newId(), blob.type), blob);
      const t = await transcribeVoice(key, path, blob.type);
      if (t) update((d) => ({ ...d, words: [String(d.words ?? "").trim(), t].filter(Boolean).join("\n") }));
      setWordsState(t ? "done" : "nothing");
    } catch {
      setWordsState("failed");
    }
  });

  const pickDate = (iso) => { update({ date: iso }); setWantDate(iso); setDatePick(false); };
  const addPhotos = (e) => {
    const files = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = "";
    if (files.length) setPhotos((l) => [...l, ...files.map((f) => ({ id: newId(), blob: f, url: URL.createObjectURL(f), attach: null }))]);
  };
  const removePhoto = (id) => setPhotos((l) => { const p = l.find((x) => x.id === id); if (p) URL.revokeObjectURL(p.url); return l.filter((x) => x.id !== id); });

  const organize = async () => {
    setNotice("");
    setStep("organizing");
    const r = await organizeLog(key, draftRef.current.words, { ...opts, date: draftRef.current.date }).catch(() => null);
    if (r && !r.understood && !r.fallback) { setNotice("missed"); setStep("capture"); return; }
    // B4: anything that goes wrong -> the whole update as one Note
    const src = r ?? { notes: [{ text: String(draftRef.current.words).trim(), location: null, source: "", flags: [] }], fallback: true };
    const log = Object.fromEntries(SECTIONS.map((s) => [s.key, (src[s.key] ?? []).map((e) => ({ ...e, id: newId(), flags: e.flags ?? [] }))]));
    update((d) => ({ ...d, log, sent: {} }));
    if (src.fallback) setNotice("fallback");
    setPhotos((l) => l.map((p) => ({ ...p, attach: null })));
    setAsk(null);
    setStep("review");
  };

  // ---------- editing the cards ----------
  const setEntry = (sec, id, patch, clearFields = Object.keys(patch)) => update((d) => ({
    ...d,
    log: { ...d.log, [sec]: d.log[sec].map((e) => (e.id !== id ? e : {
      ...e, ...patch, ...(clearFields.includes("company") ? { defaulted: false } : {}),
      flags: (e.flags ?? []).filter((f) => !f.fields.some((x) => clearFields.includes(x))),
    })) },
  }));
  const fix = (sec, e, fi, option) => {
    const flag = e.flags[fi];
    update((d) => ({
      ...d,
      log: { ...d.log, [sec]: d.log[sec].map((x) => (x.id !== e.id ? x : { ...x, ...(option ? option.patch : {}), ...(flag.fields.includes("company") ? { defaulted: false } : {}), flags: x.flags.filter((_, i) => i !== fi) })) },
    }));
  };
  const removeEntry = (sec, id) => {
    update((d) => ({ ...d, log: { ...d.log, [sec]: d.log[sec].filter((e) => e.id !== id) } }));
    setPhotos((l) => l.map((p) => (p.attach === id ? { ...p, attach: null } : p)));
  };
  const addEntry = (sec) => { update((d) => ({ ...d, log: { ...d.log, [sec]: [...d.log[sec], blankEntry(sec, opts)] } })); setCollapsed((c) => ({ ...c, [sec]: false })); };

  // ---------- sending ----------
  const dupLine = () => {
    if (!opts?.existing?.manpower?.length || draft.date !== opts.date) return null;
    const mineSent = draft.log.manpower.filter((e) => !draft.sent?.[e.id]);
    return opts.existing.manpower.find((x) => mineSent.some((e) => Number(e.company) === Number(x.companyId))) ?? null;
  };
  const trySend = (skip = []) => {
    const d = draftRef.current;
    if (SECTIONS.some((s) => d.log[s.key].some((e) => problem(s.key, e)))) return setAsk("fix");
    if (!skip.includes("flags") && flagCount(d.log)) return setAsk("flags");
    if (!skip.includes("dup") && dupLine()) return setAsk("dup");
    setAsk(null);
    startSend();
  };
  const setRow = (id, patch) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const photosFor = (id) => {
    const d = draftRef.current;
    const firstNote = d.log.notes[0]?.id;
    return photosRef.current.filter((p) => p.attach === id || (!p.attach && id === firstNote)).map((p) => p.blob);
  };
  const sendRow = async (row) => {
    for (let tries = 0; ; tries += 1) {
      setRow(row.id, { status: "sending", msg: "" });
      const e = draftRef.current.log[row.section].find((x) => x.id === row.id);
      try {
        const out = await sendEntry(project, { date: draftRef.current.date, section: row.section, entryId: row.id, entry: payload(row.section, e), photos: photosFor(row.id) });
        update((d) => ({ ...d, sent: { ...d.sent, [row.id]: out.id ?? true } }));
        setRow(row.id, { status: "sent", pending: out.status === "pending" });
        return true;
      } catch (err) {
        if (err.status === 429 && tries < 3) { // spec: "Procore is busy, trying again in a moment", then automatic retry
          setRow(row.id, { status: "busy", msg: err.message });
          await wait(Math.min(60, err.retryAfter ?? 10) * 1000);
          continue;
        }
        setRow(row.id, { status: "failed", msg: err.message });
        return false;
      }
    }
  };
  const finishIfDone = () => {
    const d = draftRef.current;
    const all = SECTIONS.flatMap((s) => d.log[s.key]);
    if (all.length && all.every((e) => d.sent?.[e.id])) {
      markSent(key, d.date, all.length);
      clearDraft(key);
    }
  };
  const startSend = async () => {
    if (demo) return explain("Sending these entries to Procore's Daily Log");
    // Photos not given to an entry go with Notes (spec open question 5); with no note yet, one is made for them
    if (photosRef.current.some((p) => !p.attach) && !draftRef.current.log.notes.length) {
      update((d) => ({ ...d, log: { ...d.log, notes: [{ ...blankEntry("notes"), text: "Site photos" }] } }));
    }
    const d = draftRef.current;
    const list = SECTIONS.flatMap((s) => d.log[s.key].map((e) => ({ id: e.id, section: s.key, label: entryLine(s.key, e, opts), status: d.sent?.[e.id] ? "sent" : "wait" })));
    setRows(list);
    setStep("sending");
    for (const row of list) if (row.status !== "sent") await sendRow(row); // one at a time (rate limits); one failure never blocks the rest
    finishIfDone();
  };
  const retry = async (row) => { await sendRow(row); finishIfDone(); };

  // ---------- screens ----------
  const back = (to, label) => <button type="button" className="link-btn msg-home-back" onClick={to}><BackIcon /> {label}</button>;
  const dayWord = opts?.today && draft.date === opts.today ? "Today" : opts?.today && draft.date === addDays(opts.today, -1) ? "Yesterday" : "";
  const draftBusy = !!(String(draft.words ?? "").trim() || draft.log || photos.length);
  const tabs = (
    <div className="dl-tabs" role="tablist" aria-label="Daily log">
      <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "is-on" : ""} onClick={() => setTab("new")}>{draftBusy ? "Your draft" : "New log"}</button>
      <button type="button" role="tab" aria-selected={tab === "past"} className={tab === "past" ? "is-on" : ""} onClick={() => { setTab("past"); setPastDay(null); }}>Past logs</button>
    </div>
  );
  // Past logs -> "Add to this day": the draft takes that date (only offered when there's no draft for another day)
  const addToDay = (iso) => {
    if (draft.date !== iso) pickDate(iso);
    setTab("new");
    setStep(draftRef.current.log ? "review" : "capture");
  };

  if (step === "loading") {
    return <section className="report report-wait" aria-live="polite">{back(onClose, "Home")}<p className="page-title">Daily log</p><p className="msg-status">Checking the Daily Log in Procore…</p></section>;
  }
  if (step === "locked" || step === "error") {
    return (
      <section className="report">
        {back(onClose, "Home")}
        <h2 className="page-title">Daily log</h2>
        <div className="dl-locked">
          <strong>{step === "locked" ? opts.reason : opts?.error}</strong>
          {step === "locked" && <p className="msg-status">{opts.template ? `Your Procore permission template here is ${opts.template}, and it has no Daily Log access. ` : ""}Ask your project manager to give you Daily Log access in Procore (Standard lets you add and fix your own entries). Everything else in SiteSnap still works.</p>}
        </div>
        <button type="button" className="text-btn" onClick={onClose}>Back to the project</button>
      </section>
    );
  }
  if (step === "organizing") {
    return (
      <section className="report report-wait" aria-live="polite">
        <p className="page-title">Organizing…</p>
        <p className="msg-status">Sorting your words into Manpower, Delays, Deliveries and Notes.</p>
      </section>
    );
  }

  if (tab === "past" && (step === "capture" || step === "review")) {
    return <PastLogs project={project} opts={opts} draftDate={draft.date} draftBusy={draftBusy} onAddToDay={addToDay} tabs={tabs} onClose={onClose} day={pastDay} onDay={setPastDay} />;
  }

  if (step === "sending") {
    const done = rows.every((r) => r.status === "sent" || r.status === "failed");
    const failed = rows.filter((r) => r.status === "failed").length;
    return (
      <section className="report" aria-live="polite">
        <h2 className="page-title">{!done ? "Sending to Procore…" : failed ? "Almost there" : "Sent"}</h2>
        <p className="msg-status">{project.name} · Daily Log for {fmtDate(draft.date)}</p>
        <ul className="dl-results">
          {rows.map((r) => (
            <li key={r.id} className={`dl-res is-${r.status}`}>
              <span className="dl-res-ico" aria-hidden="true">{r.status === "sent" ? "✓" : r.status === "failed" ? "!" : r.status === "wait" ? "·" : "…"}</span>
              <span className="dl-res-text">
                <strong>{r.label}</strong>
                <small>{r.msg || (r.status === "wait" ? "Waiting" : r.status === "sending" ? "Sending…" : r.status === "sent" ? (r.pending ? "In Procore · waiting on approval" : "In Procore") : "")}</small>
              </span>
              {r.status === "failed" && <button type="button" className="dl-retry" onClick={() => retry(r)}>Retry</button>}
            </li>
          ))}
        </ul>
        {done && (failed ? (
          <div className="dl-done is-partial"><strong>{failed} entr{failed === 1 ? "y" : "ies"} didn&rsquo;t go through.</strong><span>The rest are in Procore. Your draft stays on this phone, so tap Retry when you can.</span></div>
        ) : (
          <div className="dl-done"><strong>All {rows.length} entries are in Procore&rsquo;s Daily Log.</strong><span>Your project manager sees them in Procore for {fmtDate(draft.date)}.</span></div>
        ))}
        {done && <button type="button" className={failed ? "text-btn" : "save-btn"} onClick={onClose}>{failed ? "Leave it for now" : "Back to the project"}</button>}
        {done && !failed && <button type="button" className="text-btn" onClick={() => { setTab("past"); setPastDay(draft.date); setStep("capture"); }}>See it in Past logs</button>}
        {done && failed > 0 && <button type="button" className="text-btn" onClick={() => setStep("review")}>Fix an entry</button>}
      </section>
    );
  }

  if (step === "review") {
    const log = draft.log;
    const flags = flagCount(log);
    const count = entryCount(log);
    const dup = ask === "dup" ? dupLine() : null;
    return (
      <section className="report dl-review" aria-label="Check your log">
        {back(() => setStep("capture"), "Add more")}
        <h2 className="page-title">Check your log</h2>
        {tabs}
        <p className="msg-status">{project.name} · {dayWord ? `${dayWord}, ` : ""}{fmtDate(draft.date)}</p>
        {notice === "fallback" && <p className="procore-note">I couldn&rsquo;t organize this. It&rsquo;s saved as a note. You can move things into the other sections with + Add.</p>}
        {flags > 0 && <p className="dl-banner"><b>{flags} thing{flags === 1 ? "" : "s"} to check.</b> Look for the orange Check this tags. Tap the right answer or fix the box.</p>}
        <details className="dl-said"><summary>What you said</summary><p>{draft.words}</p></details>
        {SECTIONS.map((s) => {
          const list = log[s.key];
          const open = !collapsed[s.key];
          const fc = list.reduce((a, e) => a + (e.flags?.length ?? 0), 0);
          return (
            <section key={s.key} className="dl-sec">
              <button type="button" className="dl-sec-head" aria-expanded={open} onClick={() => setCollapsed((c) => ({ ...c, [s.key]: open }))}>
                <span className="dl-sec-name">{s.name}<small>{summary(s, list)}</small></span>
                {fc > 0 && <span className="dl-pill">Check {fc}</span>}
                <span className="dl-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="dl-sec-body">
                  {list.length === 0 && <p className="dl-empty">Nothing here.</p>}
                  {list.map((e) => (
                    <Entry key={e.id} section={s.key} e={e} opts={opts} sent={!!draft.sent?.[e.id]} photos={photos.filter((p) => p.attach === e.id || (!p.attach && s.key === "notes" && log.notes[0]?.id === e.id))}
                      onSet={(patch, fields) => setEntry(s.key, e.id, patch, fields)} onFix={(fi, o) => fix(s.key, e, fi, o)} onRemove={() => removeEntry(s.key, e.id)} onPhoto={setSheetPhoto} />
                  ))}
                  <button type="button" className="dl-add" onClick={() => addEntry(s.key)}>+ Add {s.one}</button>
                </div>
              )}
            </section>
          );
        })}
        {photos.length > 0 && (
          <div className="msg-field"><span>Photos · tap one to choose its entry</span>
            <ul className="dl-photos">
              {photos.map((p, i) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setSheetPhoto(p.id)} aria-label={`Choose an entry for photo ${i + 1}`}><img src={p.url} alt={`Photo ${i + 1}`} /></button>
                  <small>With {attachLabel(p, log, opts)}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
        {ask === "fix" && <p className="error" role="alert">Some entries are missing something (marked in red). Fix them, then tap Send.</p>}
        {ask === "flags" && (
          <div className="dl-ask" role="alert">
            <p>{flags} thing{flags === 1 ? " still says" : "s still say"} Check this. Send anyway?</p>
            <div className="dl-ask-row"><button type="button" className="text-btn" onClick={() => setAsk(null)}>Fix them</button><button type="button" className="save-btn" onClick={() => trySend(["flags"])}>Send anyway</button></div>
          </div>
        )}
        {ask === "dup" && dup && (
          <div className="dl-ask" role="alert">
            <p>You already logged {dup.workers} worker{dup.workers === 1 ? "" : "s"} for {dup.companyName ?? "this company"} on {fmtDate(draft.date)}. Add this too?</p>
            <div className="dl-ask-row"><button type="button" className="text-btn" onClick={() => setAsk(null)}>Go back</button><button type="button" className="save-btn" onClick={() => trySend(["flags", "dup"])}>Add anyway</button></div>
          </div>
        )}
        {(ask === null || ask === "fix") && (
          <>
            <p className="msg-new-hint">Nothing goes to Procore until you tap Send.</p>
            <button type="button" className="save-btn" onClick={() => trySend()} disabled={!count}>Send {count} entr{count === 1 ? "y" : "ies"} to Procore</button>
          </>
        )}
        {sheetPhoto && (
          <Sheet title="Which entry is this photo for?" onClose={() => setSheetPhoto(null)}>
            <div className="dl-sheet-list">
              <button type="button" onClick={() => { setPhotos((l) => l.map((p) => (p.id === sheetPhoto ? { ...p, attach: null } : p))); setSheetPhoto(null); }}>Notes<small>Where photos go unless you pick an entry</small></button>
              {SECTIONS.flatMap((s) => log[s.key].filter((e) => s.key !== "notes" || e.id !== log.notes[0]?.id).map((e) => (
                <button key={e.id} type="button" onClick={() => { setPhotos((l) => l.map((p) => (p.id === sheetPhoto ? { ...p, attach: e.id } : p))); setSheetPhoto(null); }}>{s.name}<small>{entryLine(s.key, e, opts)}</small></button>
              )))}
              <button type="button" className="dl-sheet-remove" onClick={() => { removePhoto(sheetPhoto); setSheetPhoto(null); }}>Remove photo</button>
            </div>
          </Sheet>
        )}
      </section>
    );
  }

  // capture
  const busy = recorder.recording || wordsState === "working";
  return (
    <section className="report" aria-label="Daily log">
      {back(onClose, "Home")}
      <h2 className="page-title">Daily log</h2>
      {tabs}
      <div className="dl-date-row">
        <button type="button" className="dl-date" aria-expanded={datePick} onClick={() => setDatePick((v) => !v)}>{dayWord ? `${dayWord} · ` : ""}{fmtDate(draft.date)} ▾</button>
        <span className="msg-status">Project time</span>
      </div>
      {datePick && opts?.today && (
        <div className="dl-date-pick">
          <button type="button" className={draft.date === opts.today ? "is-on" : ""} onClick={() => pickDate(opts.today)}>Today</button>
          <button type="button" className={draft.date === addDays(opts.today, -1) ? "is-on" : ""} onClick={() => pickDate(addDays(opts.today, -1))}>Yesterday</button>
          <label className="msg-field"><span>Another day</span><input type="date" className="dir-input" max={opts.today} value={draft.date ?? ""} onChange={(e) => e.target.value && pickDate(e.target.value)} /></label>
        </div>
      )}
      {opts?.offline && <p className="procore-note">No signal. You can talk and check your log now, and send it when you have signal.</p>}
      <button type="button" className={`big-btn talk-btn${recorder.recording ? " is-recording" : ""}`} onClick={recorder.toggle} aria-pressed={recorder.recording} disabled={wordsState === "working"}>
        {recorder.recording ? <StopIcon /> : <MicIcon />}
        {recorder.recording ? `Stop  ${formatTime(recorder.seconds)}` : draft.words?.trim() ? "Talk Again" : "Tap to Talk"}
      </button>
      {recorder.error && <p className="error" role="alert">{recorder.error}</p>}
      <p className="msg-status">{draft.words?.trim() ? "Talk again to add more. Your words add up." : "Say who was on site, any delays, and any deliveries."}</p>
      {wordsState === "working" && <p className="msg-status">Writing it down…</p>}
      {wordsState === "nothing" && <p className="error" role="alert">I didn&rsquo;t catch that. Tap to Talk and try again.</p>}
      {wordsState === "offline" && <p className="msg-status">No signal: type what you said below.</p>}
      {wordsState === "failed" && <p className="msg-status">Couldn&rsquo;t write down the words. Type them below, or talk again.</p>}
      {notice === "missed" && <p className="error" role="alert">I didn&rsquo;t catch that. Tap to Talk and try again.</p>}
      <label className="msg-field"><span>What you said (you can fix it)</span>
        <textarea className="words-field" rows={4} value={draft.words ?? ""} onChange={(e) => { setNotice(""); update({ words: e.target.value }); }} placeholder="Or type it here: Six guys on site, drywall delayed waiting on materials, forklift delivery at 10." />
      </label>
      {photos.length > 0 && (
        <ul className="msg-photos">
          {photos.map((p, i) => (
            <li key={p.id}>
              <img src={p.url} alt={`Photo ${i + 1}`} />
              <button type="button" className="msg-photo-x" onClick={() => removePhoto(p.id)} aria-label={`Remove photo ${i + 1}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
      <button type="button" className="big-btn photo-btn" onClick={() => fileInput.current.click()} disabled={photos.length >= MAX_PHOTOS || busy}>
        <CameraIcon />{photos.length ? "Add More Photos" : "Add Photos"}
      </button>
      {draft.log && <p className="msg-status">Organizing again replaces the cards you already checked.</p>}
      <button type="button" className="save-btn" onClick={organize} disabled={busy || !draft.words?.trim()}>Organize My Log</button>
      {draft.log && <button type="button" className="text-btn" onClick={() => setStep("review")}>Back to my cards</button>}
      {(draft.words?.trim() || photos.length > 0) && <p className="msg-new-hint">Draft saved on this phone</p>}
    </section>
  );
}

function summary(s, list) {
  if (!list.length) return "None";
  if (s.key === "manpower") {
    const w = list.reduce((a, e) => a + (Number(e.workers) || 0), 0);
    return `${w} worker${w === 1 ? "" : "s"}${list.length > 1 ? ` · ${list.length} entries` : ""}`;
  }
  return `${list.length} ${list.length === 1 ? s.one : s.many}`;
}
function attachLabel(p, log, opts) {
  if (!p.attach) return "Notes";
  for (const s of SECTIONS) {
    const e = log[s.key].find((x) => x.id === p.attach);
    if (e) return entryLine(s.key, e, opts);
  }
  return "Notes";
}
