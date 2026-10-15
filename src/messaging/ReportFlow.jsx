import { useEffect, useRef, useState } from "react";
import { CameraIcon, MicIcon, StopIcon } from "./icons";
import { formatTime, useRecorder } from "./useRecorder";
import RecipientSearch from "./RecipientSearch";
import { newId, queueMessage, transcribeVoice, uploadFile, voicePathFor } from "./messagingStore";
import { cantGet, draftRecord, MAX_PHOTOS, projectAccess, RECORD_HINT, RECORD_LABEL, RECORD_TOOL, recordOptions, sendRecord } from "./recordStore";

// Report an Issue (voice + photo -> Procore record). The foreman describes it; SiteSnap works out what
// kind of Procore record it is, fills it in, and one tap on Send creates it in Procore under their own
// sign-in. Then a SiteSnap thread follows it. Steps: capture -> drafting -> card -> sending -> done.
// Blank on the card means "not said": never guessed. Typing works everywhere voice does.
const PRIORITIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];

export default function ReportFlow({ session, onClose, onOpenThread }) {
  const { project, me } = session;
  const key = `${project.companyId}_${project.projectId}`;
  const ids = useRef({ cid: newId(), mid: newId() });
  const [step, setStep] = useState("capture");
  const [photos, setPhotos] = useState([]); // [{ blob, url }]
  const [voice, setVoice] = useState(null); // { blob, url, path? }
  const [words, setWords] = useState(""); // what was said (editable)
  const [wordsState, setWordsState] = useState(null); // null | working | done | failed | offline
  const [options, setOptions] = useState(null);
  const [access, setAccess] = useState(null); // who Procore will take for each kind of record
  const [card, setCard] = useState(null);
  const [draftNote, setDraftNote] = useState(null); // { lowConfidence, suggested, unmatched, impact }
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(null);
  const fileInput = useRef(null);

  // One Procore read after the other (a token refresh replaces the refresh token)
  useEffect(() => {
    let live = true;
    recordOptions(project).then((o) => { if (live) setOptions(o); return projectAccess(project); }).then((a) => { if (live) setAccess(a); }).catch(() => {});
    return () => { live = false; };
  }, [project]);
  useEffect(() => () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    if (voice) URL.revokeObjectURL(voice.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recorder = useRecorder(async (blob) => {
    if (voice) URL.revokeObjectURL(voice.url);
    const v = { blob, url: URL.createObjectURL(blob) };
    setVoice(v);
    if (!navigator.onLine) return setWordsState("offline");
    setWordsState("working");
    try {
      const path = await uploadFile(voicePathFor(key, ids.current.cid, ids.current.mid, blob.type), blob);
      setVoice({ ...v, path });
      const t = await transcribeVoice(key, path, blob.type);
      setWords((w) => [w.trim(), t].filter(Boolean).join(" "));
      setWordsState(t ? "done" : "failed");
    } catch {
      setWordsState("failed");
    }
  });

  const addPhotos = (e) => {
    const files = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = "";
    if (files.length) setPhotos((l) => [...l, ...files.map((f) => ({ blob: f, url: URL.createObjectURL(f) }))]);
  };

  // The AI's draft -> the card. People are the project directory (names, companies, titles).
  const draft = async () => {
    setError("");
    if (!words.trim()) return setError("Say or type what you see first.");
    setStep("drafting");
    let d;
    try {
      d = await draftRecord(key, words, { project, options: options ?? { observationTypes: [], trades: [], locations: [] }, people: session.dir?.people });
    } catch {
      d = null; // no signal or the AI is down: an Observation with the words as said
    }
    const people = session.dir?.people ?? [];
    const toRecipient = (a) => {
      const p = people.find((x) => String(x.id) === String(a.id));
      return { procoreUserId: String(a.id), name: a.name, company: p?.company ?? null, title: p?.title || p?.role || null };
    };
    setCard({
      recordType: d?.record_type === "punch_item" ? "punch_item" : "observation",
      title: d?.title ?? words.trim().split(/\s+/).slice(0, 10).join(" "),
      description: d?.description ?? words.trim(),
      observationTypeId: d?.observation_type?.id ?? defaultType(options)?.id ?? null,
      tradeId: d?.trade?.id ?? null,
      locationText: d?.location_text ?? "",
      locationId: d?.location?.id ?? null,
      priority: d?.priority ?? null,
      assignees: (d?.assignees ?? []).map(toRecipient),
      dueDate: d?.due_date ?? "",
      impactMentioned: !!d?.impact_mentioned,
    });
    setDraftNote({
      lowConfidence: !d || d.low_confidence,
      suggested: d?.suggested_record_type ?? null,
      unmatched: d?.unmatched_names ?? [],
      impact: d?.impact_notes ?? null,
      offline: !d,
    });
    setStep("card");
  };

  const set = (patch) => setCard((c) => ({ ...c, ...patch }));

  const send = async () => {
    setError("");
    if (!card.title.trim()) return setError("Add a short title.");
    if (card.recordType === "observation" && !card.observationTypeId) return setError("Pick what kind of observation it is.");
    setStep("sending");
    try {
      const made = await sendRecord(project, {
        recordType: card.recordType,
        title: card.title,
        description: card.description,
        transcript: words,
        observationTypeId: card.observationTypeId,
        tradeId: card.tradeId,
        locationId: card.locationId,
        locationText: card.locationText,
        priority: card.priority,
        assigneeIds: card.assignees.map((a) => Number(a.procoreUserId)),
        dueDate: card.dueDate || null,
        impactMentioned: card.impactMentioned,
        captureId: ids.current.cid,
      }, { photos: photos.map((p) => p.blob), voice: voice?.blob ?? null, link: window.location.origin });
      // The SiteSnap thread that follows it: the capture is its first message
      await queueMessage({
        key,
        cid: ids.current.cid,
        mid: ids.current.mid,
        me,
        newConversation: {
          tagged: card.assignees,
          procore: { recordType: made.recordType, id: Number(made.id), number: made.number == null ? "" : String(made.number), url: made.url, projectId: project.projectId, title: card.title.slice(0, 120), due: card.dueDate || "" },
        },
        text: card.description,
        transcript: words,
        transcriptDone: true,
        photos: photos.map((p) => ({ blob: p.blob })),
        voice: voice ? { blob: voice.blob, path: voice.path } : null,
      });
      setSent(made);
      setStep("done");
    } catch (err) {
      setError(err.message || "Couldn't send it to Procore. Try again.");
      setStep("card");
    }
  };

  if (picking) {
    return (
      <section className="composer">
        <RecipientSearch
          dir={session.dir} dirError={session.dirError} loadingDir={session.loadingDir} onRefresh={session.refreshDirectory}
          projectName={project.name} selected={card.assignees} onChange={(a) => set({ assignees: a })}
          onDone={() => setPicking(false)} doneLabel="Done"
          noteFor={(p) => { const why = cantGet(access, p.id, card.recordType); return why ? `Can't get ${RECORD_LABEL[card.recordType]}s in Procore: ${why}` : ""; }}
        />
      </section>
    );
  }

  if (step === "done") {
    const label = RECORD_LABEL[sent.recordType];
    const tool = RECORD_TOOL[sent.recordType];
    const other = RECORD_TOOL[sent.recordType === "punch_item" ? "observation" : "punch_item"];
    const kind = sent.recordType === "observation" ? (options?.observationTypes ?? []).find((t) => t.id === card.observationTypeId)?.name : "";
    return (
      <section className="report">
        <h2 className="page-title">Sent to Procore</h2>
        <div className="report-sent">
          <p className="report-where">Created in Procore <span aria-hidden="true">→</span> <strong>{tool}</strong></p>
          <p><strong>{kind ? `${kind} ` : ""}{label}{sent.number ? ` #${sent.number}` : ""}</strong>: {card.title}</p>
          <p className="msg-status">Find it in Procore's {tool} tool, not {other === "Punch List" ? "the Punch List" : other}. It's there now.</p>
          {card.assignees.length > 0 && <p className="msg-status">{card.assignees.map((a) => a.name).join(", ")} will get Procore's email.</p>}
          {(sent.warnings ?? []).map((w) => <p key={w} className="msg-status">{w}</p>)}
          <a className="big-btn plain-btn" href={sent.url} target="_blank" rel="noopener">Open in Procore</a>
        </div>
        <button type="button" className="save-btn" onClick={() => onOpenThread(ids.current.cid)}>Open the Thread</button>
        <button type="button" className="text-btn" onClick={onClose}>Done</button>
      </section>
    );
  }

  if (step === "drafting" || step === "sending") {
    return (
      <section className="report report-wait" aria-live="polite">
        <p className="page-title">{step === "drafting" ? "Filling it in…" : "Sending to Procore…"}</p>
        <p className="msg-status">{step === "drafting" ? "Working out what kind of record it is." : "Creating it in Procore with your photos and voice note."}</p>
      </section>
    );
  }

  if (step === "card") {
    const blank = "Not said. Add it if you know.";
    const types = options?.observationTypes ?? [];
    return (
      <section className="report report-card" aria-label="Check and send">
        <div className="dir-filters report-type" role="group" aria-label="Record type">
          {["observation", "punch_item"].map((t) => (
            <button key={t} type="button" className={card.recordType === t ? "is-on" : ""} aria-pressed={card.recordType === t} onClick={() => set({ recordType: t })}>{RECORD_LABEL[t]}</button>
          ))}
        </div>
        <p className="procore-note">Goes to Procore's <strong>{RECORD_TOOL[card.recordType]}</strong>. {RECORD_HINT[card.recordType]}</p>
        {draftNote.lowConfidence && <p className="procore-note">{draftNote.offline ? "Couldn't fill it in automatically. Check each field." : "Not sure what kind of record this is. Check the type above."}</p>}
        {draftNote.suggested === "change_event" && <p className="procore-note">This sounds like extra work. It goes in as an Observation with the impact noted; Change Events come later.</p>}

        <label className="msg-field"><span>Title</span>
          <input className="dir-input" value={card.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} />
        </label>
        <label className="msg-field"><span>What's going on</span>
          <textarea className="words-field" rows={3} value={card.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        {card.recordType === "observation" && (
          <label className="msg-field"><span>Kind of observation</span>
            <select className="dir-input" value={card.observationTypeId ?? ""} onChange={(e) => set({ observationTypeId: Number(e.target.value) || null })}>
              <option value="">Pick one</option>
              {groupTypes(types).map(([cat, list]) => (
                <optgroup key={cat} label={cat}>{list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
              ))}
            </select>
          </label>
        )}
        <div className="msg-field"><span>Who it's for</span>
          <button type="button" className="to-line to-btn" onClick={() => setPicking(true)}>
            <p>{card.assignees.length ? <strong>{card.assignees.map((a) => a.name).join(", ")}</strong> : blank}</p>
            <span className="stop-more">{card.assignees.length ? "Change" : "Pick"}</span>
          </button>
          {card.assignees.map((a) => [a, cantGet(access, a.procoreUserId, card.recordType)]).filter(([, why]) => why).map(([a, why]) => (
            <small key={a.procoreUserId} className="procore-warn">{a.name} can't get {RECORD_LABEL[card.recordType]}s in Procore ({why}). It will go in unassigned; {a.name.split(" ")[0]} is still tagged on the thread.</small>
          ))}
          {draftNote.unmatched.length > 0 && <small className="msg-status">Heard "{draftNote.unmatched.join(", ")}" but couldn't find them on this project. Pick them above.</small>}
        </div>
        <div className="msg-field"><span>Priority</span>
          <div className="place-chips">
            {PRIORITIES.map(([v, l]) => <button key={v} type="button" className={`place-chip${card.priority === v ? " is-on" : ""}`} onClick={() => set({ priority: card.priority === v ? null : v })}>{l}</button>)}
          </div>
        </div>
        <label className="msg-field"><span>Where</span>
          <input className="dir-input" value={card.locationText} placeholder={blank} onChange={(e) => set({ locationText: e.target.value, locationId: null })} />
        </label>
        <label className="msg-field"><span>Trade</span>
          <select className="dir-input" value={card.tradeId ?? ""} onChange={(e) => set({ tradeId: Number(e.target.value) || null })}>
            <option value="">{(options?.trades ?? []).length ? "Not said" : options?.tradesReadable === false ? "Procore didn't share its trades list" : "No trades in Procore's company list yet"}</option>
            {(options?.trades ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="msg-field"><span>Due</span>
          <input type="date" className="dir-input" value={card.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </label>
        {photos.length > 0 && (
          <ul className="msg-photos">{photos.map((p, i) => <li key={p.url}><img src={p.url} alt={`Photo ${i + 1}`} /></li>)}</ul>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="save-btn report-send" onClick={send}>Send to Procore</button>
        <button type="button" className="text-btn" onClick={() => setStep("capture")}>Back</button>
      </section>
    );
  }

  // capture
  return (
    <section className="report" aria-label="Report an issue">
      <h2 className="page-title">Report an Issue</h2>
      <p className="msg-status">Take a photo and say what you see. SiteSnap fills in the Procore form for you.</p>
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
      <input ref={fileInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={addPhotos} />
      <button type="button" className="big-btn photo-btn" onClick={() => fileInput.current.click()} disabled={photos.length >= MAX_PHOTOS || recorder.recording}>
        <CameraIcon />{photos.length ? "Add Photo" : "Take Photo"}
      </button>
      <button type="button" className={`big-btn talk-btn${recorder.recording ? " is-recording" : ""}`} onClick={recorder.toggle} aria-pressed={recorder.recording}>
        {recorder.recording ? <StopIcon /> : <MicIcon />}
        {recorder.recording ? `Stop  ${formatTime(recorder.seconds)}` : voice ? "Talk Again" : "Tap to Talk"}
      </button>
      {recorder.error && <p className="error" role="alert">{recorder.error}</p>}
      {voice && !recorder.recording && <audio controls src={voice.url} className="player" />}
      {wordsState === "working" && <p className="msg-status">Writing it down…</p>}
      {wordsState === "offline" && <p className="msg-status">No signal: type what you said below.</p>}
      {wordsState === "failed" && <p className="msg-status">Couldn't write down the words. Type them below.</p>}
      <label className="msg-field"><span>What you see (you can fix it)</span>
        <textarea className="words-field" rows={4} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Or type it here" />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="save-btn" onClick={draft} disabled={recorder.recording || wordsState === "working"}>Fill It In</button>
      <button type="button" className="text-btn" onClick={onClose}>Cancel</button>
    </section>
  );
}

// Observation types by category, Quality and Safety first (most field reports)
function groupTypes(types) {
  const order = ["Quality", "Safety"];
  const groups = new Map();
  for (const t of types) {
    const c = t.category || "Other";
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(t);
  }
  return [...groups.entries()].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
}
const defaultType = (options) => (options?.observationTypes ?? []).find((t) => t.name === "Deficiency") ?? null;
