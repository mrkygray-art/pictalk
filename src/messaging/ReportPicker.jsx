import { BackIcon, ChevronIcon, DelayIcon, ExtraWorkIcon, IssueIcon, QuestionIcon, SafetyIcon } from "./icons";

// "What are you reporting?" (sitesnap-report-picker-my-items-spec.md, section 5): one row per record type the person
// can actually create (rows come from pickerRows in capabilities.js, which leaves out types with no usable path;
// no greyed rows). Every type starts the same way: the existing capture screen.
const ICON = { issue: IssueIcon, safety: SafetyIcon, delay: DelayIcon, extra: ExtraWorkIcon, question: QuestionIcon };

export default function ReportPicker({ rows, newPill, onPick, onBack }) {
  return (
    <section className="rp">
      <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> Home</button>
      <h2 className="page-title">What are you reporting?</h2>
      {rows.length === 0 ? (
        <p className="rp-empty">Your role on this project doesn't include any of these. Ask your project admin.</p>
      ) : (
        <ul className="rp-list">
          {rows.map((r) => {
            const Icon = ICON[r.id];
            return (
              <li key={r.id}>
                <button type="button" className={`rp-row${r.id === "issue" ? " is-issue" : ""}`} onClick={() => onPick(r)}>
                  <Icon />
                  <span>
                    <strong>{r.title}{newPill && r.isNew && <span className="new-pill">New</span>}</strong>
                    <small>{r.subtitle}</small>
                  </span>
                  <ChevronIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="rp-foot">Every type starts the same way: photo, then speak.</p>
    </section>
  );
}
