import { useEffect, useMemo, useState } from "react";
import { BackIcon } from "./icons";
import Composer from "./Composer";
import RecipientSearch from "./RecipientSearch";
import { DelaySheet, QuickReplyBar } from "./QuickReplyBar";
import { statusOf } from "./quickReplies";
import { namesLine, timeAgo } from "./format";
import { SHOW_AI_PHOTO_DESCRIPTION } from "../features";
import { recordAction, syncRecord } from "./recordStore";
import {
  addPeople, ccOf, fileUrl, markRead, pendingLine, queueMessage, setStatus, setTask, watchConversation, watchMessages,
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
        <small>{pending ? pendingLine(m, me.procoreUserId) : timeAgo(m.clientCreatedAt)}</small>
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
      {/* the typed words, unless they just repeat what was said (a report's description often does) */}
      {m.text && m.text.trim().toLowerCase().replace(/[.!?\s]+$/, "") !== String(m.transcript ?? "").trim().toLowerCase().replace(/[.!?\s]+$/, "") && <p className="msg-words">{m.text}</p>}
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
  // A thread that follows a Procore record: check Procore once when it opens (closed there = closed here)
  const recordId = conv?.procore?.id;
  useEffect(() => {
    if (recordId) syncRecord(session.project, cid).catch(() => {});
  }, [recordId, cid, session.project]);
  const [busy, setBusy] = useState("");
  useEffect(() => watchMessages(projectKey, cid, setMessages), [projectKey, cid]);
  // Opening it (and each new message while it's open) counts as read
  useEffect(() => { markRead(projectKey, me.procoreUserId, cid); }, [projectKey, cid, me.procoreUserId, messages.length]);
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(() => setSent(""), 2500);
    return () => clearTimeout(t);
  }, [sent]);

  const waiting = pending.filter((p) => p.key === projectKey && p.cid === cid && !messages.some((m) => m.id === p.mid));
  // Done on a record thread: when no one else still has a to-do, the Procore record goes to Ready for review
  const markRecordDone = async () => {
    if (!conv?.procore) return;
    const others = (conv.openTasks ?? []).filter((t) => !(t.assigneeIds ?? []).includes(me.procoreUserId));
    if (others.length) return;
    try {
      await recordAction(session.project, cid, "done");
      setSent("Marked ready for review in Procore.");
    } catch (e) {
      setError(e.message);
    }
  };
  const onTask = async (mid, taskId, status) => {
    try {
      await setTask(projectKey, cid, mid, taskId, status);
      if (status === "done") await markRecordDone();
    } catch (e) {
      setError(e?.message ?? "Couldn't change that.");
    }
  };
  // Closing or reopening a record thread goes through Procore (it decides who may)
  const recordChange = async (action) => {
    setError("");
    setBusy(action);
    try {
      await recordAction(session.project, cid, action);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

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
      if (reply.code === "done") await markRecordDone();
    } catch {
      setError("Couldn't send that. Please try again.");
    }
  };
  const pick = (r) => (r.code === "delayed" ? setAskDelay(true) : quick(r));
  const changeStatus = (next) => (conv?.procore
    ? recordChange(next === "closed" ? "close" : "reopen")
    : setStatus(projectKey, cid, next, me).catch(() => setError("Couldn't change it. Check your signal.")));
  const everyoneDone = !!conv?.procore && !closed && (conv.openTasks ?? []).length === 0 && messages.some((m) => (m.tasks ?? []).length);

  if (adding && conv) {
    return (
      <section className="conversation">
        <RecipientSearch
          dir={session.dir} dirError={session.dirError} loadingDir={session.loadingDir} onRefresh={session.refreshDirectory}
          projectName={session.project.name} selected={more} onChange={setMore} alreadyTagged={[...(conv.taggedIds ?? []), ...(conv.ccIds ?? [])]}
          doneLabel="Add to Message" allowCc
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
        {conv && party && !closed && (
          <button type="button" className="stop-more is-danger" onClick={() => changeStatus("closed")} disabled={!!busy}>
            {busy === "close" ? "Closing…" : conv.procore ? "Close in Procore" : "Close"}
          </button>
        )}
        {closed && <span className="pill closed-pill">Closed</span>}
      </div>
      <div className="conv-people">
        <p><small>From {conv?.createdBy?.name ?? me.name}{conv?.createdAt ? ` · Sent ${clock(conv.createdAt)}` : ""}</small></p>
        {conv?.procore && (
          <p className="procore-link">
            <strong>Procore {conv.procore.recordType === "punch_item" ? "Punch List" : "Observations"}{conv.procore.number ? ` #${conv.procore.number}` : ""}</strong>
            {conv.procoreStatus?.label && <> · {conv.procoreStatus.label}</>}
            {" · "}<a href={conv.procore.url} target="_blank" rel="noopener">Open in Procore</a>
          </p>
        )}
        <p>To: <strong>{tagged.length ? namesLine(tagged, 6) : "no one yet"}</strong></p>
        {ccOf(conv).length > 0 && <p>CC: <strong>{namesLine(ccOf(conv), 6)}</strong></p>}
        {conv && <Tracking conv={conv} />}
        {conv && !closed && <button type="button" className="stop-more" onClick={() => setAdding(true)}>Add People</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <ul className="msg-list">
        {messages.map((m) => <Message key={m.id} m={m} me={me} onTask={onTask} />)}
        {waiting.map((p) => <Message key={p.mid} m={p} me={me} pending onTask={() => {}} />)}
      </ul>

      {everyoneDone && (
        <div className="closed-box">
          <p>Everyone's done. Close it in Procore?</p>
          <button type="button" className="big-btn photo-btn" onClick={() => recordChange("close")} disabled={!!busy}>{busy === "close" ? "Closing…" : "Close in Procore"}</button>
        </div>
      )}
      {conv && closed && (
        <div className="closed-box">
          <p>This message is closed. It stays in All Project.</p>
          {party && <button type="button" className="big-btn plain-btn" onClick={() => changeStatus("open")} disabled={!!busy}>{busy === "reopen" ? "Reopening…" : "Reopen"}</button>}
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
