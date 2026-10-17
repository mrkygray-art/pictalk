import { useEffect, useRef, useState } from "react";
import { BackIcon, CameraIcon, MicIcon, StopIcon } from "./icons";
import { formatTime, useRecorder } from "./useRecorder";
import { newId, transcribeVoice, uploadFile, voicePathFor } from "./messagingStore";
import { autoFilePhotos } from "./photoQueue";
import { draftRecord, recordOptions } from "./recordStore";
import RecipientSearch from "./RecipientSearch";
import Sheet from "../Sheet";
import {
  dropOp, failToObservation, firstOpen, forgetRun, listInspections, loadRun, newOpId, onInspectionChange, openInspection, resolveConflict, retryOp,
  runKeyOf, saveAnswer, saveNote, savePhoto, setSectionNa, skipObservation, submitInspection, syncInspections, syncState, viewOf,
} from "./inspectionStore";
import { voiceCommand } from "./inspectionVoice";
import { useDemo, useDemoGuard } from "./demo";

// Inspections (sitesnap-inspections-spec.md): run a Procore inspection one question at a time, by voice and photo.
// Screens: list (A) -> sections (A2) -> item (B) -> fail (C, a failed item becomes an Observation) -> finish (D).
// Every answer is saved on the phone first and sent to Procore in the background (inspectionStore.js), so a lost
// signal never loses an answer and the foreman is never stuck on a screen. Voice is recorded on SiteSnap's own
// page (the mic doesn't work inside Procore's frame) and written down by the same Deepgram flow as messages.
const LABEL = { pass: "Pass", fail: "Fail", na: "N/A", neutral: "Answered" };
const PHOTO_TYPES = /^image\//;

export default function InspectionsFlow({ session, onClose }) {
  const { project } = session;
  const [screen, setScreen] = useState({ name: "list" }); // list | sections | item {itemId} | fail {itemId} | finish
  const [listId, setListId] = useState(null);
  const [run, setRun] = useState(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const runKey = listId ? runKeyOf(project, listId) : null;

  // The open inspection follows its record on the phone (answers, what's still to send, Observations made)
  useEffect(() => {
    if (!runKey) return undefined;
    return onInspectionChange((k) => { if (k === runKey) loadRun(project, listId).then((r) => r && setRun(r)); });
  }, [runKey, project, listId]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const open = async (id) => {
    setError("");
    setListId(id);
    setRun(null);
    setScreen({ name: "loading" });
    try {
      const r = await openInspection(project, id);
      if (!r.access) { setError(r.reason); setScreen({ name: "list" }); return; }
      setRun(r.run);
      setOffline(r.offline);
      setScreen({ name: "sections" });
    } catch (err) {
      setError(err.message || "Couldn't open the inspection.");
      setScreen({ name: "list" });
    }
  };

  if (screen.name === "list") return <InspectionList project={project} onOpen={open} onBack={onClose} error={error} />;
  if (screen.name === "loading" || !run) return <section className="insp" aria-live="polite"><p className="page-title">Opening the inspection…</p></section>;

  const view = viewOf(run);
  const goItem = (it) => setScreen(it ? { name: "item", itemId: it.id } : { name: "finish" });
  const sync = syncState(run);
  const common = { session, run, runKey, view, sync, offline, setToast };

  return (
    <>
      {screen.name === "sections" && (
        <SectionOverview {...common} onBack={() => { setListId(null); setRun(null); setScreen({ name: "list" }); }} onItem={goItem} onFinish={() => setScreen({ name: "finish" })} />
      )}
      {screen.name === "item" && (
        <ItemScreen
          key={screen.itemId} {...common} itemId={screen.itemId}
          onGo={goItem} onExit={() => setScreen({ name: "sections" })} onFail={(photos, words) => setScreen({ name: "fail", itemId: screen.itemId, photos, words })}
        />
      )}
      {screen.name === "fail" && (
        <FailScreen
          key={screen.itemId} {...common} itemId={screen.itemId} startPhotos={screen.photos ?? []} startWords={screen.words ?? ""}
          onBack={() => setScreen({ name: "item", itemId: screen.itemId })}
          onDone={(msg) => { setToast(msg); syncInspections(); goItem(nextAfter(viewOf(run), screen.itemId)); }}
        />
      )}
      {screen.name === "finish" && (
        <FinishScreen {...common} onBack={() => setScreen({ name: "sections" })} onHome={onClose} onItem={goItem} />
      )}
      {toast && <p className="insp-toast" role="status">{toast}</p>}
    </>
  );
}

// The next item still to answer after this one (in order, then from the top), else null
function nextAfter(view, itemId) {
  const i = view.all.findIndex((it) => it.id === itemId);
  const open = (it) => it.id !== itemId && !it.section.na && !it.current?.counts;
  return view.all.slice(i + 1).find(open) ?? view.all.slice(0, Math.max(0, i)).find(open) ?? null;
}

// ---------- Screen A: the list ----------

function InspectionList({ project, onOpen, onBack, error }) {
  const [state, setState] = useState({ step: "loading" });
  const [tab, setTab] = useState("mine");
  const [details, setDetails] = useState(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    listInspections(project)
      .then((b) => live && setState(b.access === false ? { step: "denied", reason: b.reason } : { step: "ready", ...b }))
      .catch((err) => live && setState({ step: "failed", message: err.status === 401 ? "Sign in to Procore again." : navigator.onLine ? err.message : "No signal. Inspections you've opened before still work: try again when you have signal." }));
    return () => { live = false; };
  }, [project, tries]);
  const load = () => { setState({ step: "loading" }); setTries((n) => n + 1); };
  useEffect(() => { recordOptions(project).catch(() => {}); }, [project]); // Observation types, saved for a Fail without signal

  const back = <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> Home</button>;
  if (state.step === "loading") return <section className="insp">{back}<h2 className="page-title">Inspections</h2><p className="msg-status">Loading inspections from Procore…</p></section>;
  if (state.step === "denied") {
    return (
      <section className="insp">
        {back}<h2 className="page-title">Inspections</h2>
        <p className="procore-note">{state.reason}</p>
        <button type="button" className="save-btn" onClick={onBack}>Back</button>
      </section>
    );
  }
  if (state.step === "failed") {
    return (
      <section className="insp">
        {back}<h2 className="page-title">Inspections</h2>
        <p className="procore-note">{state.message}</p>
        <button type="button" className="save-btn" onClick={load}>Try Again</button>
      </section>
    );
  }
  const { groups, myCompany } = state;
  const rows = tab === "mine" ? groups.mine : groups.company;
  return (
    <section className="insp" aria-label="Inspections">
      {back}
      <div>
        <h2 className="page-title">Inspections</h2>
        <p className="msg-status">{project.name}</p>
      </div>
      <div className="dl-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? "is-on" : ""} onClick={() => setTab("mine")}>Assigned to me</button>
        <button type="button" role="tab" aria-selected={tab === "company"} className={tab === "company" ? "is-on" : ""} onClick={() => setTab("company")}>My company's work</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {rows.length === 0 ? (
        <p className="procore-note">
          {tab === "mine" ? "No inspections assigned to you on this project." : myCompany ? `No inspections with ${myCompany.name} as the responsible contractor on this project.` : "Procore doesn't show which company you're with on this project, so SiteSnap can't find your company's inspections."}
        </p>
      ) : (
        <ul className="insp-rows">{rows.map((r) => <InspectionRow key={r.id} r={r} onOpen={onOpen} onDetails={setDetails} />)}</ul>
      )}
      {tab === "mine" && groups.open.length > 0 && (
        <>
          <h3 className="insp-group">Open on this project</h3>
          <ul className="insp-rows">{groups.open.map((r) => <InspectionRow key={r.id} r={r} onOpen={onOpen} onDetails={setDetails} />)}</ul>
        </>
      )}
      {rows.length === 0 && groups.open.length === 0 && <button type="button" className="save-btn" onClick={onBack}>Back</button>}
      {details && (
        <Sheet title={details.title} onClose={() => setDetails(null)}>
          <p className="insp-details">{details.description}</p>
          <button type="button" className="save-btn" onClick={() => setDetails(null)}>Close</button>
        </Sheet>
      )}
    </section>
  );
}

function InspectionRow({ r, onOpen, onDetails }) {
  const facts = [r.location, r.due ? `Due ${fmtDay(r.due)}` : null].filter(Boolean).join(" · ");
  return (
    <li className="insp-row-wrap">
      <button type="button" className="insp-row" onClick={() => onOpen(r.id)}>
        <span className="insp-row-name">
          <strong>{r.title}</strong>
          {facts && <small>{facts}</small>}
        </span>
        <span className="insp-row-side">
          <span className={`insp-status is-${r.status.replace(/\s/g, "").toLowerCase()}`}>{r.status}</span>
          <small>{r.progress.done} of {r.progress.total}</small>
        </span>
      </button>
      {r.description && <button type="button" className="text-btn inline insp-details-link" onClick={() => onDetails(r)}>Details</button>}
    </li>
  );
}

const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ---------- shared bits ----------

function SyncLine({ sync, offline, runKey }) {
  if (sync.conflicts.length || sync.failed.length) {
    return (
      <div className="insp-sync-issues">
        {sync.conflicts.map((o) => (
          <div key={o.opId} className="insp-conflict" role="alert">
            <p>Item {o.number ?? ""} was already answered by <strong>{o.by?.name ?? "someone else"}</strong>{o.theirs?.counts ? ` (${LABEL[o.theirs.counts]})` : ""}. Keep theirs or use yours?</p>
            <div className="insp-two">
              <button type="button" className="big-btn plain-btn" onClick={() => resolveConflict(runKey, o.opId, false)}>Keep Theirs</button>
              <button type="button" className="save-btn" onClick={() => resolveConflict(runKey, o.opId, true)}>Use Mine{o.answer?.counts ? ` (${LABEL[o.answer.counts]})` : ""}</button>
            </div>
          </div>
        ))}
        {sync.failed.map((o) => (
          <div key={o.opId} className="insp-conflict is-failed" role="alert">
            <p>{o.error}</p>
            <div className="insp-two">
              <button type="button" className="big-btn plain-btn" onClick={() => dropOp(runKey, o.opId)}>Keep on Phone Only</button>
              <button type="button" className="save-btn" onClick={() => retryOp(runKey, o.opId)}>Try Again</button>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <p className={`insp-saved${sync.waiting ? " is-waiting" : ""}`}>{sync.waiting ? `Not synced yet · ${sync.waiting} waiting${navigator.onLine ? "" : " for signal"}` : offline ? "Saved on this phone · no signal" : "Saved"}</p>;
}

// Labels the conflict / failed rows with the item number they belong to
function withNumbers(sync, view) {
  const num = (id) => view.all.find((it) => it.id === id)?.number ?? "";
  return { ...sync, conflicts: sync.conflicts.map((o) => ({ ...o, number: num(o.itemId) })), failed: sync.failed.map((o) => ({ ...o, error: `${o.itemId ? `Item ${num(o.itemId)}: ` : ""}${o.error}` })) };
}

// ---------- Screen A2: sections ----------

function SectionOverview({ run, runKey, view, sync, offline, onBack, onItem, onFinish, setToast }) {
  const guard = useDemoGuard();
  const [askNa, setAskNa] = useState(null); // a section to confirm
  const [showDetails, setShowDetails] = useState(false);
  const insp = run.snapshot;
  const next = firstOpen(view);
  return (
    <section className="insp" aria-label="Sections">
      <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> Inspections</button>
      <div>
        <h2 className="page-title">{insp.title}</h2>
        <p className="msg-status">{[insp.location, insp.due ? `Due ${fmtDay(insp.due)}` : null, `${view.counts.answered} of ${view.counts.total} answered`].filter(Boolean).join(" · ")}</p>
        {insp.description && <button type="button" className="text-btn inline" onClick={() => setShowDetails(true)}>Details</button>}
      </div>
      <SyncLine sync={withNumbers(sync, view)} offline={offline} runKey={runKey} />
      {insp.closed && <p className="procore-note">This inspection is closed in Procore. You can look, but answers may not be accepted.</p>}
      {next ? (
        <button type="button" className="save-btn" onClick={() => onItem(next)}>{view.counts.answered ? "Continue" : "Start"} <small className="insp-btn-sub">at {next.number}</small></button>
      ) : (
        <button type="button" className="save-btn" onClick={onFinish}>Review and Submit</button>
      )}
      <ul className="insp-sections">
        {view.sections.map((s) => (
          <li key={s.id} className={`insp-section${s.na ? " is-na" : ""}`}>
            <button type="button" className="insp-section-main" onClick={() => onItem(firstOpen(view, s.id) ?? s.items[0])} disabled={!s.items.length}>
              <strong>{s.number}. {s.name}</strong>
              <small>{s.na ? "Not applicable" : `${s.counts.answered} of ${s.counts.total}`}</small>
              {!s.na && s.counts.answered > 0 && (
                <span className="insp-counts">
                  {s.counts.pass > 0 && <span className="is-pass">{s.counts.pass} pass</span>}
                  {s.counts.fail > 0 && <span className="is-fail">{s.counts.fail} fail</span>}
                  {s.counts.na > 0 && <span className="is-na">{s.counts.na} N/A</span>}
                </span>
              )}
            </button>
            <button type="button" className="insp-na-btn" onClick={guard("Setting a section N/A", () => setAskNa(s))}>
              {s.na ? "Undo N/A" : "Set N/A"}
            </button>
          </li>
        ))}
      </ul>
      {next && view.counts.answered > 0 && <button type="button" className="text-btn" onClick={onFinish}>See the summary</button>}
      {askNa && !askNa.na && (
        <Sheet title={`Set "${askNa.name}" as N/A?`} onClose={() => setAskNa(null)}>
          <p>All {askNa.items.length} item{askNa.items.length === 1 ? "" : "s"} in this section are answered N/A in Procore. You can undo it.</p>
          <button type="button" className="save-btn" onClick={() => { setSectionNa(runKey, askNa, true); setToast(`${askNa.name}: N/A`); setAskNa(null); }}>Yes, Set Section N/A</button>
          <button type="button" className="text-btn" onClick={() => setAskNa(null)}>Cancel</button>
        </Sheet>
      )}
      {askNa?.na && (
        <Sheet title={`Undo N/A on "${askNa.name}"?`} onClose={() => setAskNa(null)}>
          <p>Procore clears the N/A answer on all {askNa.items.length} item{askNa.items.length === 1 ? "" : "s"} in this section, so each one needs an answer again.</p>
          <button type="button" className="save-btn" onClick={() => { setSectionNa(runKey, askNa, false); setToast(`${askNa.name}: back on`); setAskNa(null); }}>Yes, Undo N/A</button>
          <button type="button" className="text-btn" onClick={() => setAskNa(null)}>Cancel</button>
        </Sheet>
      )}
      {showDetails && (
        <Sheet title="Details" onClose={() => setShowDetails(false)}>
          <p className="insp-details">{insp.description}</p>
          <button type="button" className="save-btn" onClick={() => setShowDetails(false)}>Close</button>
        </Sheet>
      )}
    </section>
  );
}

// ---------- voice: record, write down (Deepgram), hand back the words ----------

function useVoice(key, onWords) {
  const [state, setState] = useState(null); // working | failed | offline
  const recorder = useRecorder(async (blob) => {
    if (!navigator.onLine) { setState("offline"); return; }
    setState("working");
    try {
      const path = await uploadFile(voicePathFor(key, "inspections", newId(), blob.type), blob);
      const words = await transcribeVoice(key, path, blob.type);
      setState(words ? null : "failed");
      if (words) onWords(words);
    } catch {
      setState("failed");
    }
  });
  return { recorder, state };
}

// ---------- Screen B: one question ----------

function ItemScreen({ session, run, runKey, view, sync, offline, itemId, onGo, onExit, onFail, setToast }) {
  const { project, me } = session;
  const key = `${project.companyId}_${project.projectId}`;
  const index = view.all.findIndex((it) => it.id === itemId);
  const item = view.all[index];
  const [note, setNote] = useState(run.notes[itemId]?.text ?? "");
  const [noteOpen, setNoteOpen] = useState(!!run.notes[itemId]?.text);
  const [value, setValue] = useState(item?.current?.value ?? "");
  const [photos, setPhotos] = useState([]); // taken on this visit (also go with a Fail's Observation)
  const [askNa, setAskNa] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const insp = run.snapshot;
  const { demo, explain } = useDemo();
  const guard = useDemoGuard();

  const { recorder, state: voiceState } = useVoice(key, (words) => {
    const cmd = voiceCommand(words);
    if (cmd?.section) return setAskNa(true);
    if (cmd?.counts && item.kind === "passfail") return answer({ counts: cmd.counts });
    if (cmd?.counts && item.kind === "choice") {
      const opt = item.options.find((o) => o.counts === cmd.counts);
      if (opt) return answer({ optionId: opt.id, counts: opt.counts });
    }
    setNote((n) => [n.trim(), words].filter(Boolean).join(" "));
    setNoteOpen(true);
  });

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return <section className="insp"><p className="procore-note">This item isn't on the inspection anymore.</p><button type="button" className="save-btn" onClick={onExit}>Back to Sections</button></section>;

  const passed = view.counts.pass;
  const otherAnswer = item.answer?.by && item.answer.by.id !== String(run.myId ?? me.procoreUserId) && !run.local[item.id] ? item.answer : null;
  const notePending = note.trim() && note.trim() !== (run.notes[item.id]?.text ?? "");
  const photoCount = (item.photos ?? 0) + (run.photos[item.id] ?? 0); // in Procore + added on this phone
  const hasPhoto = photoCount > 0 || photos.length > 0;

  async function answer(a) {
    if (demo) return explain(`Answering item ${item.number} in Procore`);
    setError("");
    const counts = a.counts ?? (item.kind === "passfail" || item.kind === "choice" ? null : "neutral");
    if (counts !== "fail" && counts !== "na") {
      if (item.photoRequired && !hasPhoto) return setError("This item needs a photo first. Tap Photo.");
      if (item.noteRequired && !note.trim() && !run.notes[item.id]?.text) return setError("This item needs a note first. Tap Speak or type one.");
    }
    if (notePending) await saveNote(runKey, item, note);
    if (counts === "fail") return onFail(photos.map((p) => p.blob), note.trim());
    await saveAnswer(runKey, item, a);
    setToast(`${item.number} ${LABEL[counts] ?? "saved"}`);
    onGo(nextAfter(viewAfter(view, item.id, counts), item.id));
  }

  const addPhoto = async (e) => {
    const files = [...(e.target.files ?? [])].filter((f) => PHOTO_TYPES.test(f.type)).slice(0, 4);
    e.target.value = "";
    for (const f of files) {
      setPhotos((l) => [...l, { blob: f, url: URL.createObjectURL(f) }]);
      await savePhoto(runKey, item, f);
      // Also into Procore's Photos tool, the same way the other features do it
      autoFilePhotos({ project, captureBase: `i-${newOpId()}`, photos: [f], words: note || item.text, by: me.name, from: `Inspection ${insp.title}, item ${item.number}` });
    }
    if (files.length) setToast(files.length === 1 ? "Photo added to the item" : `${files.length} photos added to the item`);
  };

  const prev = view.all[index - 1];
  return (
    <section className="insp insp-item" aria-label={`Item ${item.number}`}>
      <div className="insp-top">
        <button type="button" className="link-btn" onClick={() => (prev ? onGo(prev) : onExit())} aria-label={prev ? `Back to item ${prev.number}` : "Back to sections"}><BackIcon /> {prev ? prev.number : "Sections"}</button>
        <button type="button" className="text-btn inline" onClick={async () => { if (notePending && !demo) await saveNote(runKey, item, note); onExit(); }}>{demo ? "Exit" : "Save and Exit"}</button>
      </div>
      <p className="insp-where">{item.section.name}, {item.section.items.findIndex((x) => x.id === item.id) + 1} of {item.section.items.length}</p>
      <h2 className="insp-title">{insp.title}</h2>
      <div className="insp-progress-line"><span>Item {index + 1} of {view.all.length}</span><span>{passed} passed</span></div>
      <div className="insp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={view.counts.total} aria-valuenow={view.counts.answered}><span style={{ width: `${view.counts.total ? (100 * view.counts.answered) / view.counts.total : 0}%` }} /></div>
      <SyncLine sync={withNumbers(sync, view)} offline={offline} runKey={runKey} />

      <div className="insp-card">
        <span className="insp-num">{item.number}</span>
        <p className="insp-q">{item.text}</p>
        {item.details && <p className="insp-q-details">{item.details}</p>}
        {item.section.na && <p className="msg-status">This section is set N/A.</p>}
        {(item.photoRequired || item.noteRequired || item.required) && (
          <p className="insp-required">{[item.required && "Required", item.photoRequired && "photo needed", item.noteRequired && "note needed"].filter(Boolean).join(" · ")}</p>
        )}
        {otherAnswer && <p className="insp-already">Already answered by <strong>{otherAnswer.by.name}</strong>: {answerText(item, otherAnswer)}. Keep it or change it.</p>}
        {!otherAnswer && item.current?.counts && <p className="insp-already is-mine">Your answer: {answerText(item, item.current)}{item.current.synced === false ? " · not synced yet" : ""}</p>}
        {run.observations[item.id]?.id && <p className="msg-status">Observation #{run.observations[item.id].number ?? ""} made from this item.</p>}
      </div>

      {item.kind === "passfail" && (
        <div className="insp-answers">
          {["pass", "fail", "na"].map((c) => (
            <button key={c} type="button" className={`insp-ans is-${c}${item.current?.counts === c ? " is-on" : ""}`} aria-pressed={item.current?.counts === c} onClick={() => answer({ counts: c })}>{LABEL[c]}</button>
          ))}
        </div>
      )}
      {item.kind === "passfail" && insp.phrasing && (insp.phrasing.pass || insp.phrasing.fail) && (
        <p className="msg-status insp-phrasing">In Procore: Pass = {insp.phrasing.pass || "Conforming"}, Fail = {insp.phrasing.fail || "Deficient"}</p>
      )}
      {item.kind === "choice" && (
        <div className={`insp-answers${item.options.length > 3 ? " is-many" : ""}`}>
          {item.options.map((o) => (
            <button key={o.id} type="button" className={`insp-ans is-${o.counts}${item.current?.optionId === o.id ? " is-on" : ""}`} aria-pressed={item.current?.optionId === o.id} onClick={() => answer({ optionId: o.id, counts: o.counts })}>{o.label}</button>
          ))}
        </div>
      )}
      {(item.kind === "text" || item.kind === "number" || item.kind === "date") && (
        <div className="insp-value">
          {item.kind === "text"
            ? <textarea className="words-field" rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Type the answer" />
            : <input className="dir-input" type={item.kind === "date" ? "date" : "text"} inputMode={item.kind === "number" ? "decimal" : undefined} value={value} onChange={(e) => setValue(e.target.value)} placeholder={item.kind === "number" ? "Type a number" : ""} />}
          <button type="button" className="save-btn" onClick={() => (String(value).trim() ? answer({ value: String(value).trim(), counts: "neutral" }) : setError(item.kind === "date" ? "Pick a date." : "Type an answer first."))}>Save Answer</button>
        </div>
      )}

      <div className="insp-tools">
        <button type="button" className={`insp-tool${recorder.recording ? " is-recording" : ""}`} onClick={guard("Answering by voice", recorder.toggle)} aria-pressed={recorder.recording}>
          {recorder.recording ? <StopIcon /> : <MicIcon />}{recorder.recording ? `Stop ${formatTime(recorder.seconds)}` : "Speak"}
        </button>
        <button type="button" className="insp-tool" onClick={() => (demo ? explain("Adding a photo to the item") : fileInput.current.click())}><CameraIcon />Photo{photoCount ? ` · ${photoCount}` : ""}</button>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={addPhoto} />
      </div>
      <p className="insp-help">{voiceState === "working" ? "Writing it down…" : voiceState === "failed" ? "Couldn't write that down. Try again or type it." : voiceState === "offline" ? "No signal: tap the buttons or type a note." : item.kind === "passfail" ? "Say pass, fail, or add a note" : "Say a note, or tap an answer"}</p>
      {recorder.error && <p className="error" role="alert">{recorder.error}</p>}
      {photos.length > 0 && <ul className="msg-photos">{photos.map((p, i) => <li key={p.url}><img src={p.url} alt={`Photo ${i + 1} for item ${item.number}`} /></li>)}</ul>}
      {noteOpen ? (
        <label className="msg-field"><span>Note on this item (you can fix it)</span>
          <textarea className="words-field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => notePending && saveNote(runKey, item, note)} />
          {run.notes[item.id]?.notInProcore && <small className="msg-status">Procore didn't take notes on this item. It's kept in SiteSnap and goes into an Observation if the item fails.</small>}
        </label>
      ) : (
        <button type="button" className="text-btn" onClick={guard("Adding a note to the item", () => setNoteOpen(true))}>Type a note</button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {askNa && (
        <Sheet title={`Set "${item.section.name}" as N/A?`} onClose={() => setAskNa(false)}>
          <p>All {item.section.items.length} items in this section are answered N/A in Procore. You can undo it from the sections list.</p>
          <button type="button" className="save-btn" onClick={() => { setSectionNa(runKey, item.section, true); setAskNa(false); setToast(`${item.section.name}: N/A`); onGo(nextOutsideSection(view, item.section.id)); }}>Yes, Set Section N/A</button>
          <button type="button" className="text-btn" onClick={() => setAskNa(false)}>Cancel</button>
        </Sheet>
      )}
    </section>
  );
}

// The view as it will be once this answer is saved (so "next" skips the item just answered)
function viewAfter(view, itemId, counts) {
  return { ...view, all: view.all.map((it) => (it.id === itemId ? { ...it, current: { counts: counts ?? "neutral" } } : it)) };
}
function nextOutsideSection(view, sectionId) {
  return view.all.find((it) => it.section.id !== sectionId && !it.section.na && !it.current?.counts) ?? null;
}
function answerText(item, a) {
  if (item.kind === "choice") return item.options.find((o) => o.id === a.optionId)?.label ?? LABEL[a.counts];
  if (a.value != null && a.value !== "" && item.kind !== "passfail") return `"${a.value}"`;
  return LABEL[a.counts] ?? "answered";
}

// ---------- Screen C: a failed item becomes an Observation ----------

function FailScreen({ session, run, runKey, view, itemId, startPhotos, startWords, onBack, onDone }) {
  const { project } = session;
  const key = `${project.companyId}_${project.projectId}`;
  const item = view.all.find((it) => it.id === itemId);
  const insp = run.snapshot;
  const [photos, setPhotos] = useState(() => startPhotos.map((blob) => ({ blob, url: URL.createObjectURL(blob) })));
  const [words, setWords] = useState(startWords);
  const [who, setWho] = useState([]); // people from the project directory
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const contractor = insp.responsibleContractor; // inspection-level; Procore items don't carry their own
  const { recorder, state: voiceState } = useVoice(key, (w) => setWords((x) => [x.trim(), w].filter(Boolean).join(" ")));
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const people = session.dir?.people ?? [];
  const fromContractor = contractor ? people.filter((p) => String(p.company ?? "").toLowerCase() === contractor.name.toLowerCase()).slice(0, 4) : [];

  if (picking) {
    return (
      <section className="composer">
        <RecipientSearch
          dir={session.dir} dirError={session.dirError} loadingDir={session.loadingDir} onRefresh={session.refreshDirectory}
          projectName={project.name} selected={who} onChange={(list) => setWho(list.filter((p) => !p.cc))} onDone={() => setPicking(false)} doneLabel="Done"
        />
      </section>
    );
  }

  const create = async () => {
    setError("");
    setBusy(true);
    const said = words.trim();
    const story = [`Failed: ${item.text}`, said].filter(Boolean).join(". ");
    const options = await recordOptions(project).catch(() => null);
    let d = null;
    if (navigator.onLine) {
      d = await Promise.race([
        draftRecord(key, story, { project, options: options ?? { observationTypes: [], trades: [], locations: [] }, people }).catch(() => null),
        new Promise((ok) => setTimeout(() => ok(null), 15000)),
      ]);
    }
    const typeId = d?.observation_type?.id ?? (options?.observationTypes ?? []).find((t) => t.name === "Deficiency")?.id ?? (options?.observationTypes ?? []).find((t) => /safety/i.test(insp.title) && t.category === "Safety")?.id ?? options?.observationTypes?.[0]?.id ?? null;
    if (!typeId) { setBusy(false); return setError("SiteSnap needs signal once to load Procore's observation types. Try again with signal, or tap Skip."); }
    const card = {
      recordType: "observation",
      title: (d?.title ?? `Failed: ${item.text}`).slice(0, 80),
      description: d?.description ?? (said || item.text),
      transcript: said,
      observationTypeId: typeId,
      tradeId: d?.trade?.id ?? null,
      locationId: d?.location?.id ?? null,
      locationText: d?.location_text ?? "",
      priority: d?.priority ?? null,
      assigneeIds: who.map((p) => Number(p.procoreUserId)),
      dueDate: d?.due_date ?? null,
      impactMentioned: !!d?.impact_mentioned,
    };
    await failToObservation(runKey, item, { card, photos: photos.map((p) => p.blob), contractor: contractor ?? null });
    // The photos also go into Procore's Photos tool, like Report an issue's
    if (photos.length) autoFilePhotos({ project, captureBase: `if-${newOpId()}`, photos: photos.map((p) => p.blob), words: said || item.text, by: session.me.name, from: `Inspection ${insp.title}, item ${item.number} (failed)` });
    onDone(navigator.onLine ? "Creating the Observation…" : "Saved. The Observation goes to Procore when there's signal.");
  };

  const skip = async () => {
    if (words.trim()) await saveNote(runKey, item, words);
    await skipObservation(runKey, item);
    onDone(`${item.number} failed · no Observation`);
  };

  return (
    <section className="insp insp-fail" aria-label="Failed item">
      <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> Back to the question</button>
      <p className="insp-failed-label">Failed item {item.number}</p>
      <p className="insp-q">{item.text}</p>
      {photos.length > 0 && (
        <ul className="msg-photos">
          {photos.map((p, i) => (
            <li key={p.url}>
              <img src={p.url} alt={`Photo ${i + 1}`} />
              <button type="button" className="msg-photo-x" onClick={() => setPhotos((l) => l.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = [...(e.target.files ?? [])].filter((x) => PHOTO_TYPES.test(x.type)).slice(0, 4 - photos.length); e.target.value = ""; setPhotos((l) => [...l, ...f.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))]); }} />
      <button type="button" className={photos.length ? "big-btn plain-btn" : "big-btn photo-btn"} onClick={() => fileInput.current.click()} disabled={photos.length >= 4}><CameraIcon />{photos.length ? "Add Another Photo" : "Add Photo"}</button>
      <label className="msg-field"><span>What's wrong (you can fix it)</span>
        <textarea className="words-field" rows={3} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Say or type what's wrong" />
      </label>
      <button type="button" className={`insp-tool${recorder.recording ? " is-recording" : ""}`} onClick={recorder.toggle} aria-pressed={recorder.recording}>
        {recorder.recording ? <StopIcon /> : <MicIcon />}{recorder.recording ? `Stop ${formatTime(recorder.seconds)}` : words ? "Record Again" : "Record"}
      </button>
      {voiceState === "working" && <p className="msg-status">Writing it down…</p>}
      {voiceState === "failed" && <p className="msg-status">Couldn't write that down. Type it instead.</p>}
      {recorder.error && <p className="error" role="alert">{recorder.error}</p>}

      <div className="insp-becomes">
        <span>Becomes</span>
        <span className="insp-chip is-obs">Observation</span>
        {contractor ? <span className="insp-chip">{contractor.name}</span> : null}
        <button type="button" className="insp-chip is-pick" onClick={() => setPicking(true)}>{who.length ? who.map((p) => p.name).join(", ") : "Choose who"}</button>
      </div>
      {fromContractor.length > 0 && !who.length && (
        <div className="place-chips" aria-label={`People at ${contractor.name}`}>
          {fromContractor.map((p) => <button key={p.id} type="button" className="place-chip" onClick={() => setWho([{ procoreUserId: String(p.id), name: p.name, company: p.company ?? null, title: p.title || p.role || null }])}>{p.name}</button>)}
        </div>
      )}
      {!contractor && <p className="msg-status">No responsible contractor on this inspection in Procore. Choose who should fix it, or leave it unassigned.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="save-btn insp-create" onClick={create} disabled={busy || recorder.recording || voiceState === "working"}>{busy ? "Creating…" : "Create Observation"}</button>
      <button type="button" className="text-btn" onClick={skip} disabled={busy}>Skip, keep going</button>
    </section>
  );
}

// ---------- Screen D: finish ----------

function FinishScreen({ session, run, runKey, view, sync, offline, onBack, onHome, onItem }) {
  const { project } = session;
  const [state, setState] = useState(null); // submitting | { closed, message } | { error }
  const insp = run.snapshot;
  const failed = view.all.filter((it) => it.current?.counts === "fail");
  const open = view.all.filter((it) => !it.section.na && !it.current?.counts);
  const bare = failed.filter((it) => !it.photos && !(run.photos[it.id] > 0) && !run.notes[it.id]?.text && !it.notes.length);

  const guard = useDemoGuard();
  const submit = guard("Submitting the inspection to Procore", async () => {
    if (sync.waiting) { syncInspections({ now: true }); return setState({ error: "Some answers haven't reached Procore yet. Wait for \"Saved\", then submit." }); }
    setState("submitting");
    try {
      const r = await submitInspection(project, run.listId);
      setState(r);
      if (r.closed) await forgetRun(project, run.listId);
    } catch (err) {
      setState({ error: navigator.onLine ? err.message : "Submitting needs signal. Your answers are saved." });
    }
  });

  return (
    <section className="insp" aria-label="Summary">
      <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> Sections</button>
      <h2 className="page-title">{insp.title}</h2>
      <SyncLine sync={withNumbers(sync, view)} offline={offline} runKey={runKey} />
      <div className="insp-summary">
        <div className="is-pass"><strong>{view.counts.pass}</strong><span>Passed</span></div>
        <div className="is-fail"><strong>{view.counts.fail}</strong><span>Failed</span></div>
        <div className="is-na"><strong>{view.counts.na}</strong><span>N/A</span></div>
      </div>
      {open.length > 0 && (
        <p className="procore-note">{open.length} item{open.length === 1 ? "" : "s"} still to answer. <button type="button" className="text-btn inline" onClick={() => onItem(open[0])}>Go to {open[0].number}</button></p>
      )}
      {failed.length > 0 && (
        <>
          <h3 className="insp-group">Failed items</h3>
          <ul className="insp-failed-list">
            {failed.map((it) => {
              const o = run.observations[it.id] ?? (it.observations[0] ? { id: it.observations[0].id, number: it.observations[0].number } : null);
              return (
                <li key={it.id}>
                  <button type="button" className="text-btn inline" onClick={() => onItem(it)}>{it.number}</button> {it.text}
                  <br />
                  {o?.url ? <a href={o.url} target="_blank" rel="noopener">Observation #{o.number ?? ""}</a>
                    : o?.id ? <span className="msg-status">Observation #{o.number ?? ""}</span>
                    : o?.skipped ? <span className="insp-flag">No Observation (skipped)</span>
                    : o?.queued ? <span className="msg-status">{o.error ? `Observation not created: ${o.error}` : "Observation waiting to be created"}</span>
                    : <span className="insp-flag">No Observation</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {bare.length > 0 && <p className="msg-status">Failed with no photo or note: {bare.map((it) => it.number).join(", ")}</p>}
      {state && state !== "submitting" && (state.closed ? <p className="procore-note">Submitted. The inspection is closed in Procore.</p> : state.message ? <p className="procore-note">{state.message}</p> : state.error ? <p className="error" role="alert">{state.error}</p> : null)}
      {!state?.closed && !state?.message && (
        <button type="button" className="save-btn" onClick={submit} disabled={state === "submitting" || open.length > 0}>{state === "submitting" ? "Submitting…" : "Submit Inspection"}</button>
      )}
      {open.length > 0 && <p className="msg-status">Answer every item (or set its section N/A) to submit.</p>}
      <button type="button" className={state?.closed || state?.message ? "save-btn" : "text-btn"} onClick={onHome}>Back to Home</button>
    </section>
  );
}
