import { DailyLogIcon, IssueIcon, MessageIcon, PhotosIcon } from "./icons";

// The project home (docs/sitesnap-project-home-and-photos-spec.md, section 1): right after a project is picked.
// Report an issue and Message side by side, Project photos and Daily log (docs/closeout-and-daily-log-spec.md,
// Feature B) full width below. dailyStatus: "draft" | { count } (sent today) | null.
export default function ProjectHome({ unread, onReport, onMessages, onPhotos, onDailyLog, dailyStatus }) {
  return (
    <nav className="home-tiles" aria-label="What do you want to do?">
      <button type="button" className="home-tile is-issue" onClick={onReport}>
        <IssueIcon />
        <strong>Report an issue</strong>
        <small>Becomes a Procore Observation or Punch Item</small>
      </button>
      <button type="button" className="home-tile" onClick={onMessages}>
        <MessageIcon />
        <strong>Message{unread ? <span className="home-badge" aria-label={`${unread} for you`}>{unread}</span> : null}</strong>
        <small>Photos and voice to your project team</small>
      </button>
      <button type="button" className="home-tile is-wide" onClick={onPhotos}>
        <PhotosIcon />
        <strong>Project photos</strong>
        <small>See the project's photos in Procore</small>
      </button>
      <button type="button" className="home-tile is-wide is-log" onClick={onDailyLog}>
        <DailyLogIcon />
        <strong>Daily log</strong>
        <small>Say who was here, delays and deliveries</small>
        <span className={`home-tile-status${dailyStatus === "draft" ? " is-draft" : dailyStatus ? " is-sent" : ""}`}>
          {dailyStatus === "draft" ? "Draft in progress" : dailyStatus ? `Sent today · ${dailyStatus.count} entr${dailyStatus.count === 1 ? "y" : "ies"}` : "Not sent today"}
        </span>
      </button>
    </nav>
  );
}
