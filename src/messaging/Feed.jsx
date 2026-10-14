import { useEffect, useState } from "react";
import { fileUrl, isUnread, myTasks, watchFeed } from "./messagingStore";
import { namesLine, summaryLine, timeAgo } from "./format";

// The project feed: conversations, newest activity first. For Me = I'm tagged and it's open (these
// are highlighted, with an unread dot); All Project = everything on the project (others' look calmer
// and never alert); Mine = ones I started.
const TABS = [["forMe", "For Me"], ["all", "All Project"], ["mine", "Mine"]];

function Thumb({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    fileUrl(path).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [path]);
  return url ? <img className="conv-thumb" src={url} alt="" /> : <span className="conv-thumb is-empty" aria-hidden="true" />;
}

export default function Feed({ projectKey, me, reads, pending, onOpen }) {
  const [tab, setTab] = useState("forMe");
  const [lists, setLists] = useState({}); // tab -> list
  const [error, setError] = useState("");

  // For Me always listens (its unread count shows on the tab); the open tab too
  useEffect(() => watchFeed(projectKey, "forMe", me, (list, err) => {
    if (err) setError("Couldn't load conversations. Check your signal.");
    else setLists((l) => ({ ...l, forMe: list }));
  }), [projectKey, me]);
  useEffect(() => {
    if (tab === "forMe") return undefined;
    return watchFeed(projectKey, tab, me, (list, err) => {
      if (err) setError("Couldn't load conversations. Check your signal.");
      else setLists((l) => ({ ...l, [tab]: list }));
    });
  }, [projectKey, tab, me]);

  const list = lists[tab];
  const unreadCount = (lists.forMe ?? []).filter((c) => isUnread(c, me, reads)).length;
  const sending = pending.filter((p) => p.key === projectKey && p.newConversation);

  return (
    <section className="feed" aria-label="Conversations">
      <div className="dir-filters feed-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
            {label}{id === "forMe" && unreadCount > 0 && <span className="tab-badge" aria-label={`${unreadCount} unread`}>{unreadCount}</span>}
          </button>
        ))}
      </div>
      {error && <p className="procore-note procore-error" role="alert">{error}</p>}

      {sending.length > 0 && (
        <ul className="conv-list">
          {sending.map((p) => (
            <li key={p.mid}>
              <div className="conv-card is-sending">
                <span className="conv-thumb is-empty" aria-hidden="true" />
                <div className="conv-body">
                  <strong>To {namesLine(p.newConversation.tagged)}</strong>
                  <span className="conv-text">{(p.text || p.transcript || "Photo").slice(0, 120)}</span>
                  <small>{p.lastError ? "Not sent yet. It'll try again when there's signal." : "Sending…"}</small>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!list && !error && <p className="procore-note">Loading conversations…</p>}
      {list && list.length === 0 && (
        <p className="empty">
          {tab === "forMe" ? "Nothing for you right now. When someone tags you, it shows up here." : tab === "mine" ? "You haven't started a conversation yet." : "No conversations on this project yet."}
        </p>
      )}
      {list && list.length > 0 && (
        <ul className="conv-list">
          {list.map((c) => {
            const forMe = (c.taggedIds ?? []).includes(me);
            const unread = isUnread(c, me, reads);
            const tasks = myTasks(c, me);
            return (
              <li key={c.id}>
                <button type="button" className={`conv-card${forMe ? " is-for-me" : " is-muted"}${unread ? " is-unread" : ""}${c.status === "closed" ? " is-closed" : ""}`} onClick={() => onOpen(c.id)}>
                  {c.firstPhotoPath ? <Thumb path={c.firstPhotoPath} /> : <span className="conv-thumb is-empty" aria-hidden="true" />}
                  <div className="conv-body">
                    <span className="conv-top">
                      <strong>{c.createdBy?.name ?? "Someone"}</strong>
                      <small>{timeAgo(c.lastActivityAt)}</small>
                    </span>
                    <span className="conv-to">To {namesLine(c.tagged)}</span>
                    <span className="conv-text">{c.lastMessage?.text || (c.lastMessage ? "Photo" : "Sending…")}</span>
                    <span className="conv-meta">
                      {summaryLine(c)}
                      {c.status === "closed" && <span className="pill">Closed</span>}
                      {tasks.length > 0 && <span className="pill is-task">{tasks.length} task{tasks.length === 1 ? "" : "s"} for you</span>}
                    </span>
                  </div>
                  {unread && <span className="unread-dot" aria-label="Unread" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
