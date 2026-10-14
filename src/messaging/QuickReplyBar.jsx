import { useState } from "react";
import Sheet from "../Sheet";
import { DELAY_REASONS, MAIN_REPLIES, QUICK_REPLIES } from "./quickReplies";

// One-tap answers (the list is in quickReplies.js). Four big buttons, the rest behind More.
// selected: the code picked so far (in the Reply composer), or null for one-tap sending.
export function QuickReplyBar({ onPick, selected = null, label = "Quick reply" }) {
  const [more, setMore] = useState(false);
  const main = QUICK_REPLIES.filter((r) => MAIN_REPLIES.includes(r.code));
  const rest = QUICK_REPLIES.filter((r) => !MAIN_REPLIES.includes(r.code));
  const button = (r) => (
    <button key={r.code} type="button" className={`qr-btn${selected === r.code ? " is-on" : ""}`} aria-pressed={selected === r.code} onClick={() => onPick(r)}>
      {r.label}
    </button>
  );
  return (
    <div className="qr" role="group" aria-label={label}>
      <div className="qr-grid">
        {main.map(button)}
      </div>
      {more ? (
        <div className="qr-grid">{rest.map(button)}</div>
      ) : (
        <button type="button" className="text-btn qr-more" onClick={() => setMore(true)}>More</button>
      )}
    </div>
  );
}

// Delayed: why, and a new date. Both optional, so Send works right away.
export function DelaySheet({ onSend, onClose }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const pretty = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "");
  return (
    <Sheet title="Delayed" onClose={onClose}>
      <p>Why? (optional)</p>
      <div className="place-chips">
        {DELAY_REASONS.map((r) => (
          <button key={r} type="button" className={`place-chip${reason === r ? " is-on" : ""}`} onClick={() => setReason(reason === r ? "" : r)}>{r}</button>
        ))}
      </div>
      <label className="msg-field">
        <span>New date (optional)</span>
        <input type="date" className="dir-input" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button type="button" className="save-btn" onClick={() => onSend({ reason, newDate: pretty(date) })}>Send Delayed</button>
      <button type="button" className="text-btn" onClick={onClose}>Cancel</button>
    </Sheet>
  );
}
