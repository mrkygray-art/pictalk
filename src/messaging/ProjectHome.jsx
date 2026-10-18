import { ChecklistIcon, DailyLogIcon, IssueIcon, MessageIcon, MyItemsIcon, PhotosIcon } from "./icons";

// The project home, 2 columns x 3 rows (sitesnap-report-picker-my-items-spec.md, section 3):
//   Report something | Message
//   My items (New)   | Inspection
//   Daily log        | Project photos
// Each tile has one status line under its words; a tile with nothing to say keeps an empty line of the same
// height, so counts arriving later never move anything. dailyStatus: "draft" | { count } (sent today) | null.
// badges: { inspections, myItems: { open, overdue } } or null while loading. showMyItems: false only when Procore
// refuses both Observations and Punch List for this person.
export default function ProjectHome({ unread, onReport, onMessages, onMyItems, onInspections, onPhotos, onDailyLog, dailyStatus, badges, showMyItems = true, newPill = false }) {
  const my = badges?.myItems;
  const insp = badges?.inspections;
  return (
    <nav className="home-tiles" aria-label="What do you want to do?">
      <button type="button" className="home-tile is-issue" onClick={onReport}>
        <IssueIcon />
        <strong>Report something</strong>
        <small>Issue, safety, delay, RFI, extra work</small>
      </button>
      <button type="button" className="home-tile" onClick={onMessages}>
        <MessageIcon />
        <strong>Message{unread ? <span className="home-badge" aria-label={`${unread} for you`}>{unread}</span> : null}</strong>
        <small>Photos and voice to your project team</small>
      </button>
      {showMyItems && (
        <button type="button" className={`home-tile${newPill ? " is-new" : ""}`} onClick={onMyItems}>
          {newPill && <span className="new-pill home-new">New</span>}
          <MyItemsIcon />
          <strong>My items</strong>
          <small>Assigned to you, close out by voice</small>
          <Status show={my && my.open > 0} tone={my?.overdue > 0 ? "is-alert" : ""}>
            {my ? `${my.open} open${my.overdue > 0 ? ` · ${my.overdue} overdue` : ""}` : ""}
          </Status>
        </button>
      )}
      <button type="button" className="home-tile is-inspect" onClick={onInspections}>
        <ChecklistIcon />
        <strong>Inspection</strong>
        <small>Walk a checklist</small>
        <Status show={insp > 0}>{`${insp} assigned`}</Status>
      </button>
      <button type="button" className="home-tile is-log" onClick={onDailyLog}>
        <DailyLogIcon />
        <strong>Daily log</strong>
        <small>Crew, delays, deliveries, by voice</small>
        <span className={`home-tile-status${dailyStatus === "draft" ? " is-draft" : dailyStatus ? " is-sent" : ""}`}>
          {dailyStatus === "draft" ? "Draft in progress" : dailyStatus ? `Sent today · ${dailyStatus.count} entr${dailyStatus.count === 1 ? "y" : "ies"}` : "Not sent today"}
        </span>
      </button>
      <button type="button" className="home-tile" onClick={onPhotos}>
        <PhotosIcon />
        <strong>Project photos</strong>
        <small>See the project's photos in Procore</small>
      </button>
    </nav>
  );
}

// A tile's status pill, or an empty line of the same height (no layout shift while counts load)
function Status({ show, tone = "", children }) {
  return show
    ? <span className={`home-tile-status ${tone}`.trim()}>{children}</span>
    : <span className="home-tile-status is-empty" aria-hidden="true" />;
}
