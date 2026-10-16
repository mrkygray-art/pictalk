import { IssueIcon, MessageIcon, PhotosIcon } from "./icons";

// The project home (docs/sitesnap-project-home-and-photos-spec.md, section 1): three tiles, right after a
// project is picked. Report an issue and Message side by side, Project photos full width below.
export default function ProjectHome({ unread, onReport, onMessages, onPhotos }) {
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
    </nav>
  );
}
