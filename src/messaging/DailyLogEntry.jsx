// One Daily Log entry card: the review screen (DailyLogFlow) and the Past logs edit sheet (PastLogs).
import { problem } from "./dailyLogFormat";

// ---------- one entry card ----------

export function Entry({ section, e, opts, sent, photos = [], onSet, onFix, onRemove, onPhoto }) {
  const flagged = (f) => (e.flags ?? []).some((x) => x.fields.includes(f));
  const cls = (f, wide) => `dl-fld${wide ? " is-wide" : ""}${flagged(f) ? " is-check" : ""}`;
  const companies = opts?.companies ?? [];
  const mineId = opts?.myCompany?.id;
  const coSelect = (f) => (
    <select className="dir-input" value={e[f] ?? ""} onChange={(ev) => onSet({ [f]: ev.target.value ? Number(ev.target.value) : null })}>
      <option value="">Pick a company</option>
      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.id === mineId ? " (yours)" : ""}</option>)}
    </select>
  );
  const locSelect = (opts?.locations ?? []).length > 0 && (
    <label className={cls("location")}><span>Where</span>
      <select className="dir-input" value={e.location ?? ""} onChange={(ev) => onSet({ location: ev.target.value ? Number(ev.target.value) : null })}>
        <option value="">Not said</option>
        {opts.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
  const time = (f, label) => (
    <label className={cls(f)}><span>{label}</span><input type="time" className="dir-input" value={e[f] ?? ""} onChange={(ev) => onSet({ [f]: ev.target.value || null })} /></label>
  );
  const wrong = problem(section, e);
  return (
    <article className={`dl-entry${sent ? " is-sent" : ""}`}>
      {sent && <p className="dl-sent-tag">Already in Procore</p>}
      {e.source && <p className="dl-source">You said &ldquo;{e.source}&rdquo;</p>}
      {(e.flags ?? []).map((f, i) => (
        <div key={i} className="dl-check">
          <span className="dl-check-tag">Check this</span>
          <p>{f.reason}</p>
          <div className="dl-chips">
            {f.options.map((o) => <button key={o.label} type="button" onClick={() => onFix(i, o)}>{o.label}</button>)}
            <button type="button" onClick={() => onFix(i, null)}>Looks right</button>
          </div>
        </div>
      ))}
      <div className="dl-fields">
        {section === "manpower" && (
          <>
            <label className={cls("company", true)}><span>Company{e.defaulted ? <em> your company, since you didn&rsquo;t name one</em> : null}</span>{coSelect("company")}</label>
            <label className={cls("workers")}><span>Workers</span><input type="number" inputMode="numeric" min="0" className="dir-input" value={e.workers ?? ""} onChange={(ev) => onSet({ workers: ev.target.value === "" ? "" : Number(ev.target.value) })} /></label>
            <label className={cls("hours")}><span>Hours each</span><input type="number" inputMode="decimal" min="0" max="24" className="dir-input" placeholder="Not said" value={e.hours ?? ""} onChange={(ev) => onSet({ hours: ev.target.value === "" ? null : Number(ev.target.value) })} /></label>
            {locSelect}
            <label className={cls("comment", true)}><span>Notes</span><input className="dir-input" placeholder={e.trade ? e.trade : "Optional"} value={e.comment ?? ""} onChange={(ev) => onSet({ comment: ev.target.value })} /></label>
          </>
        )}
        {section === "delays" && (
          <>
            <label className={cls("type", true)}><span>Kind of delay</span>
              {(opts?.delayTypes ?? []).length ? (
                <select className="dir-input" value={e.type ?? ""} onChange={(ev) => onSet({ type: ev.target.value })}>
                  <option value="">Pick one</option>
                  {opts.delayTypes.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              ) : <input className="dir-input" value={e.type ?? ""} onChange={(ev) => onSet({ type: ev.target.value })} placeholder="e.g. Weather" />}
            </label>
            {time("start", "Started")}
            {time("end", "Ended")}
            <label className={cls("company", true)}><span>Company{e.defaulted ? <em> your company</em> : null}</span>{coSelect("company")}</label>
            {locSelect}
            <label className={cls("comment", true)}><span>What happened</span><input className="dir-input" value={e.comment ?? ""} onChange={(ev) => onSet({ comment: ev.target.value })} /></label>
          </>
        )}
        {section === "deliveries" && (
          <>
            <label className={cls("what")}><span>What came</span><input className="dir-input" value={e.what ?? ""} onChange={(ev) => onSet({ what: ev.target.value })} placeholder="e.g. Rebar" /></label>
            {time("time", "Time")}
            <label className={cls("from", true)}><span>From</span>
              <input className="dir-input" list={`dl-co-${e.id}`} value={e.from ?? ""} onChange={(ev) => onSet({ from: ev.target.value })} placeholder="Not said" />
              <datalist id={`dl-co-${e.id}`}>{companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </label>
            <label className={cls("comment", true)}><span>Comment</span><input className="dir-input" value={e.comment ?? ""} onChange={(ev) => onSet({ comment: ev.target.value })} placeholder="Optional" /></label>
          </>
        )}
        {section === "notes" && (
          <>
            <label className={cls("text", true)}><span>Note</span><textarea className="words-field" rows={3} value={e.text ?? ""} onChange={(ev) => onSet({ text: ev.target.value })} /></label>
            {locSelect}
          </>
        )}
      </div>
      {photos.length > 0 && (
        <ul className="dl-photos is-small">
          {photos.map((p) => <li key={p.id}><button type="button" onClick={() => onPhoto(p.id)} aria-label="Move this photo"><img src={p.url} alt="" /></button></li>)}
        </ul>
      )}
      {wrong && <p className="error">{wrong}</p>}
      {!sent && onRemove && <button type="button" className="dl-delete" onClick={onRemove}>Delete</button>}
    </article>
  );
}

