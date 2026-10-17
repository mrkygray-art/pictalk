import { useEffect, useState } from "react";
import { ccOf, discardPending, fileUrl, isUnread, myTasks, pendingLine, pendingReason, watchFeed } from "./messagingStore";
import { namesLine, summaryLine, timeAgo } from "./format";
import { useDemo } from "./demo";

// The project feed: conversations, newest activity first. For Me = I'm tagged and it's open (these
// are highlighted, with an unread dot); CC = I'm CC'd (kept in the loop: calm cards, no count, no alerts);
// All Project = everything on the project (others' look calmer and never alert); Sent = ones I started.
const TABS = [["forMe", "For Me"], ["cc", "CC"], ["all", "All Project"], ["mine", "Sent"]];
const EMPTY = {
  forMe: "Nothing for you right now. When someone tags you, it shows up here.",
  cc: "Nothing you're CC'd on. When someone CCs you, it shows up here.",
  all: "No messages on this project yet.",
  mine: "You haven't sent a message yet.",
};

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
  const { demo } = useDemo();
  const [tab, setTab] = useState(demo ? "all" : "forMe"); // the demo guest is never tagged, so its For Me is empty
  const [lists, setLists] = useState({}); // tab -> list
  const [error, setError] = useState("");

  // For Me always listens (its unread count shows on the tab); the open tab too
  useEffect(() => watchFeed(projectKey, "forMe", me, (list, err) => {
    if (err) setError("Couldn't load messages. Check your signal.");
    else setLists((l) => ({ ...l, forMe: list }));
  }), [projectKey, me]);
  useEffect(() => {
    if (tab === "forMe") return undefined;
    return watchFeed(projectKey, tab, me, (list, err) => {
      if (err) setError("Couldn't load messages. Check your signal.");
      else setLists((l) => ({ ...l, [tab]: list }));
    });
  }, [projectKey, tab, me]);

  const list = lists[tab];
  const unreadCount = (lists.forMe ?? []).filter((c) => isUnread(c, me, reads)).length;
  const sending = pending.filter((p) => p.key === projectKey && p.newConversation);

  return (
    <section className="feed" aria-label="Messages">
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
                  <strong>To {namesLine(p.newConversation.tagged)}{p.newConversation.cc?.length ? ` · CC ${namesLine(p.newConversation.cc)}` : ""}</strong>
                  <span className="conv-text">{(p.text || p.transcript || "Photo").slice(0, 120)}</span>
                  <small>{pendingLine(p, me)}</small>
                  {["refused", "other"].includes(pendingReason(p, me)) && (
                    <button type="button" className="text-btn inline" onClick={() => { if (window.confirm("Remove this message? It hasn't been sent, and it can't be brought back.")) discardPending(p.mid); }}>Remove</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!list && !error && <p className="procore-note">Loading messages…</p>}
      {list && list.length === 0 && (
        <p className="empty">
          {EMPTY[tab]}
        </p>
      )}
      {list && list.length > 0 && (
        <ul className="conv-list">
          {list.map((c) => {
            const forMe = (c.taggedIds ?? []).includes(me);
            const unread = isUnread(c, me, reads);
            const tasks = myTasks(c, me);
            const cc = ccOf(c);
            return (
              <li key={c.id}>
                <button type="button" className={`conv-card${forMe ? " is-for-me" : " is-muted"}${unread ? " is-unread" : ""}${c.status === "closed" ? " is-closed" : ""}`} onClick={() => onOpen(c.id)}>
                  {c.firstPhotoPath ? <Thumb path={c.firstPhotoPath} /> : <span className="conv-thumb is-empty" aria-hidden="true" />}
                  <div className="conv-body">
                    <span className="conv-top">
                      <strong>{c.createdBy?.name ?? "Someone"}</strong>
                      <small>{timeAgo(c.lastActivityAt)}</small>
                    </span>
                    <span className="conv-to">To {namesLine(c.tagged)}{cc.length > 0 && ` · CC ${namesLine(cc)}`}</span>
                    <span className="conv-text">{c.lastMessage?.text || (c.lastMessage ? "Photo" : "Sending…")}</span>
                    <span className="conv-meta">
                      {summaryLine(c)}
                      {c.status === "closed" && <span className="pill">Closed</span>}
                      {c.procore && <span className="pill is-procore">{c.procore.recordType === "punch_item" ? "Punch Item" : "Observation"}{c.procore.number ? ` #${c.procore.number}` : ""}</span>}
                      {tasks.length > 0 && <span className="pill is-task">{tasks.length} to do for you</span>}
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
