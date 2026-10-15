import { useEffect, useMemo, useState } from "react";
import { BackIcon } from "./icons";
import Composer from "./Composer";
import RecipientSearch from "./RecipientSearch";
import { DelaySheet, QuickReplyBar } from "./QuickReplyBar";
import { statusOf } from "./quickReplies";
import { namesLine, timeAgo } from "./format";
import { SHOW_AI_PHOTO_DESCRIPTION } from "../features";
import {
  addPeople, fileUrl, markRead, queueMessage, setStatus, setTask, watchConversation, watchMessages,
} from "./messagingStore";

// One thread: who it's for (with what's been seen and answered, in plain words), every message in
// order, and at the bottom one-tap quick replies (for the people it was sent to) and a single Reply
// button that opens the full composer. A closed thread shows only Closed and Reopen.
function useUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    if (path) fileUrl(path).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [path]);
  return url;
}

function Photo({ path, n }) {
  const url = useUrl(path);
  return url ? <a href={url} target="_blank" rel="noopener"><img src={url} alt={`Photo ${n}`} /></a> : <span className="msg-photo-wait">Photo</span>;
}

function Voice({ path }) {
  const url = useUrl(path);
  return url ? <audio controls src={url} className="player" /> : null;
}

const clock = (ms) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
const statusText = (st) => [st.label, st.reason, st.newDate && `new date ${st.newDate}`].filter(Boolean).join(" · ");

function Task({ task, canChange, onChange }) {
  const done = task.status === "done";
  return (
    <li className={`msg-task${done ? " is-done" : ""}`}>
      <span className="msg-task-text">
        <strong>{done ? "Done:" : "To do:"}</strong> {task.text}
        {task.due && <small> · {task.due}</small>}
        <small className="msg-task-who"> For {task.assigneeNames?.join(", ") || "everyone tagged"}</small>
      </span>
      {canChange && (
        <button type="button" className="stop-more" onClick={() => onChange(done ? "open" : "done")}>{done ? "Reopen" : "Done"}</button>
      )}
    </li>
  );
}

function Message({ m, me, pending, onTask }) {
  const local = useMemo(() => (pending ? m.photos.map((p) => URL.createObjectURL(p.blob)) : null), [pending, m.photos]);
  useEffect(() => () => local?.forEach((u) => URL.revokeObjectURL(u)), [local]);
  if (m.event) {
    return (
      <li className="msg-event">
        {m.event === "closed" ? "Closed" : "Reopened"} by {m.authorName} · {clock(m.clientCreatedAt)}
      </li>
    );
  }
  const mine = m.authorId === me.procoreUserId || pending;
  return (
    <li className={`msg${mine ? " is-mine" : ""}${pending ? " is-pending" : ""}`}>
      <div className="msg-head">
        <strong>{pending ? me.name : m.authorName}</strong>
        <small>{pending ? (m.lastError ? "Not sent yet · tries again with signal" : "Sending…") : timeAgo(m.clientCreatedAt)}</small>
      </div>
      {m.status && <p className={`msg-status-line is-${m.status.code}`}>{statusText(m.status)}</p>}
      {(m.photos?.length ?? 0) > 0 && (
        <div className="msg-photo-grid">
          {pending ? local.map((u, i) => <img key={u} src={u} alt={`Photo ${i + 1}`} />) : m.photos.map((p, i) => <Photo key={p.path} path={p.path} n={i + 1} />)}
        </div>
      )}
      {!pending && m.voicePath && <Voice path={m.voicePath} />}
      {m.transcript && <p className="msg-words">{m.transcript}</p>}
      {!pending && m.voicePath && !m.transcript && m.transcriptStatus === "pending" && <p className="msg-status">Writing it down…</p>}
      {!pending && m.transcriptStatus === "failed" && !m.transcript && <p className="msg-status">Couldn't write down this voice note. Play it above.</p>}
      {m.text && <p className="msg-words">{m.text}</p>}
      {SHOW_AI_PHOTO_DESCRIPTION && m.aiDescription && (
        <div className="stop-box photo-desc">
          <span className="stop-box-label">Photo description (AI)</span>
          <p>{m.aiDescription}</p>
        </div>
      )}
      {(m.tasks?.length ?? 0) > 0 && (
        <ul className="msg-tasks">
          {m.tasks.map((t) => (
            <Task key={t.id} task={t} canChange={t.assigneeIds?.includes(me.procoreUserId) || m.authorId === me.procoreUserId} onChange={(s) => onTask(m.id, t.id, s)} />
          ))}
        </ul>
      )}
    </li>
  );
}

// What's known about each person it was sent to: seen, and their latest quick reply or first answer
function Tracking({ conv }) {
  const people = conv.tagged ?? [];
  if (!people.length) return null;
  return (
    <ul className="conv-track" aria-label="Seen and answered">
      {people.map((p) => {
        const st = conv.statuses?.[p.procoreUserId];
        const seen = conv.seen?.[p.procoreUserId];
        const answered = conv.answered?.[p.procoreUserId];
        const bits = [
          seen ? `Seen ${clock(seen)}` : "Not seen yet",
          st ? `${st.label} ${clock(st.at)}` : answered ? `Answered ${clock(answered)}` : null,
        ].filter(Boolean);
        return <li key={p.procoreUserId}><strong>{p.name}</strong> <span>{bits.join(" · ")}</span></li>;
      })}
    </ul>
  );
}

export default function ConversationView({ session, projectKey, cid, pending, onBack }) {
  const { me } = session;
  const [conv, setConv] = useState(undefined);
  const [messages, setMessages] = useState([]);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState([]);
  const [replying, setReplying] = useState(false);
  const [askDelay, setAskDelay] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => watchConversation(projectKey, cid, setConv), [projectKey, cid]);
  useEffect(() => watchMessages(projectKey, cid, setMessages), [projectKey, cid]);
  // Opening it (and each new message while it's open) counts as read
  useEffect(() => { markRead(projectKey, me.procoreUserId, cid); }, [projectKey, cid, me.procoreUserId, messages.length]);
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(() => setSent(""), 2500);
    return () => clearTimeout(t);
  }, [sent]);

  const waiting = pending.filter((p) => p.key === projectKey && p.cid === cid && !messages.some((m) => m.id === p.mid));
  const onTask = (mid, taskId, status) => setTask(projectKey, cid, mid, taskId, status).catch((e) => setError(e?.message ?? "Couldn't change that."));

  if (conv === undefined && !waiting.length) return <p className="procore-note">Loading…</p>;
  const tagged = conv?.tagged ?? waiting[0]?.newConversation?.tagged ?? [];
  const closed = conv?.status === "closed";
  const sentToMe = (conv?.taggedIds ?? []).includes(me.procoreUserId);
  const party = sentToMe || conv?.createdBy?.procoreUserId === me.procoreUserId;

  // One tap: a quick reply with nothing else, through the same send queue as any message
  const quick = async (reply, extra) => {
    setError("");
    try {
      await queueMessage({ key: projectKey, cid, me, status: statusOf(reply, extra) });
      setSent(`Sent: ${reply.told}`);
    } catch {
      setError("Couldn't send that. Please try again.");
    }
  };
  const pick = (r) => (r.code === "delayed" ? setAskDelay(true) : quick(r));
  const changeStatus = (next) => setStatus(projectKey, cid, next, me).catch(() => setError("Couldn't change it. Check your signal."));

  if (adding && conv) {
    return (
      <section className="conversation">
        <RecipientSearch
          dir={session.dir} dirError={session.dirError} loadingDir={session.loadingDir} onRefresh={session.refreshDirectory}
          projectName={session.project.name} selected={more} onChange={setMore} alreadyTagged={conv.taggedIds ?? []}
          doneLabel="Add to Message"
          onDone={async () => {
            try { await addPeople(projectKey, conv, more); } catch { setError("Couldn't add them. Check your signal."); }
            setMore([]);
            setAdding(false);
          }}
        />
        <button type="button" className="text-btn" onClick={() => { setMore([]); setAdding(false); }}>Cancel</button>
      </section>
    );
  }

  return (
    <section className="conversation" aria-label="Message">
      <div className="conv-header">
        <button type="button" className="link-btn" onClick={onBack}><BackIcon /> Messages</button>
        {conv && party && !closed && <button type="button" className="stop-more is-danger" onClick={() => changeStatus("closed")}>Close</button>}
        {closed && <span className="pill closed-pill">Closed</span>}
      </div>
      <div className="conv-people">
        <p><small>From {conv?.createdBy?.name ?? me.name}{conv?.createdAt ? ` · Sent ${clock(conv.createdAt)}` : ""}</small></p>
        {conv?.procore && (
          <p className="procore-link">
            <strong>Procore {conv.procore.recordType === "punch_item" ? "Punch Item" : "Observation"}{conv.procore.number ? ` #${conv.procore.number}` : ""}</strong>
            {" · "}<a href={conv.procore.url} target="_blank" rel="noopener">Open in Procore</a>
          </p>
        )}
        <p>To: <strong>{tagged.length ? namesLine(tagged, 6) : "no one yet"}</strong></p>
        {conv && <Tracking conv={conv} />}
        {conv && !closed && <button type="button" className="stop-more" onClick={() => setAdding(true)}>Add People</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <ul className="msg-list">
        {messages.map((m) => <Message key={m.id} m={m} me={me} onTask={onTask} />)}
        {waiting.map((p) => <Message key={p.mid} m={p} me={me} pending onTask={() => {}} />)}
      </ul>

      {conv && closed && (
        <div className="closed-box">
          <p>This message is closed. It stays in All Project.</p>
          {party && <button type="button" className="big-btn plain-btn" onClick={() => changeStatus("open")}>Reopen</button>}
        </div>
      )}
      {conv && !closed && !replying && (
        <>
          {sentToMe && <QuickReplyBar onPick={pick} />}
          {sent && <p className="msg-status" role="status">{sent}</p>}
          <button type="button" className="save-btn msg-reply-btn" onClick={() => setReplying(true)}>Reply</button>
        </>
      )}
      {conv && !closed && replying && (
        <Composer mode="reply" session={session} conversation={conv} quickReplies={sentToMe} onSent={() => setReplying(false)} onCancel={() => setReplying(false)} />
      )}
      {askDelay && (
        <DelaySheet onClose={() => setAskDelay(false)} onSend={(extra) => { setAskDelay(false); quick({ code: "delayed", told: "Delayed" }, extra); }} />
      )}
    </section>
  );
}
