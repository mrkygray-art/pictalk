import { useEffect, useMemo, useState } from "react";
import { BackIcon } from "./icons";
import Composer from "./Composer";
import RecipientSearch from "./RecipientSearch";
import { namesLine, timeAgo } from "./format";
import {
  addPeople, fileUrl, markRead, setStatus, setTask, watchConversation, watchMessages,
} from "./messagingStore";

// One conversation: who's tagged, every message in order (photos, voice note with its words, typed
// words, the optional AI photo description, flagged tasks), and a reply box with the same capture tools.
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

function Task({ task, canChange, onChange }) {
  const done = task.status === "done";
  return (
    <li className={`msg-task${done ? " is-done" : ""}`}>
      <span className="msg-task-text">
        <strong>{done ? "Done:" : "Task:"}</strong> {task.text}
        {task.due && <small> · {task.due}</small>}
        <small className="msg-task-who"> For {task.assigneeNames?.join(", ") || "everyone tagged"}</small>
      </span>
      {canChange && (
        <button type="button" className="stop-more" onClick={() => onChange(done ? "open" : "done")}>{done ? "Reopen" : "Mark Done"}</button>
      )}
    </li>
  );
}

function Message({ m, me, pending, onTask }) {
  const local = useMemo(() => (pending ? m.photos.map((p) => URL.createObjectURL(p.blob)) : null), [pending, m.photos]);
  useEffect(() => () => local?.forEach((u) => URL.revokeObjectURL(u)), [local]);
  const mine = m.authorId === me.procoreUserId || pending;
  return (
    <li className={`msg${mine ? " is-mine" : ""}${pending ? " is-pending" : ""}`}>
      <div className="msg-head">
        <strong>{pending ? me.name : m.authorName}</strong>
        <small>{pending ? (m.lastError ? "Not sent yet · tries again with signal" : "Sending…") : timeAgo(m.clientCreatedAt)}</small>
      </div>
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
      {m.aiDescription && (
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

export default function ConversationView({ session, projectKey, cid, pending, onBack }) {
  const { me } = session;
  const [conv, setConv] = useState(undefined);
  const [messages, setMessages] = useState([]);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState([]);
  const [replyKey, setReplyKey] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => watchConversation(projectKey, cid, setConv), [projectKey, cid]);
  useEffect(() => watchMessages(projectKey, cid, setMessages), [projectKey, cid]);
  // Opening it (and each new message while it's open) counts as read
  useEffect(() => { markRead(projectKey, me.procoreUserId, cid); }, [projectKey, cid, me.procoreUserId, messages.length]);

  const waiting = pending.filter((p) => p.key === projectKey && p.cid === cid && !messages.some((m) => m.id === p.mid));
  const onTask = (mid, taskId, status) => setTask(projectKey, cid, mid, taskId, status).catch((e) => setError(e?.message ?? "Couldn't change that task."));

  if (conv === undefined && !waiting.length) return <p className="procore-note">Loading…</p>;
  const tagged = conv?.tagged ?? waiting[0]?.newConversation?.tagged ?? [];
  const closed = conv?.status === "closed";

  if (adding && conv) {
    return (
      <section className="conversation">
        <RecipientSearch
          dir={session.dir} dirError={session.dirError} loadingDir={session.loadingDir} onRefresh={session.refreshDirectory}
          projectName={session.project.name} selected={more} onChange={setMore} alreadyTagged={conv.taggedIds ?? []}
          doneLabel="Add to Conversation"
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
    <section className="conversation" aria-label="Conversation">
      <div className="conv-header">
        <button type="button" className="link-btn" onClick={onBack}><BackIcon /> Conversations</button>
        {conv && (
          <button type="button" className={`stop-more${closed ? "" : " is-danger"}`} onClick={() => setStatus(projectKey, cid, closed ? "open" : "closed", me.procoreUserId).catch(() => setError("Couldn't change it. Check your signal."))}>
            {closed ? "Reopen" : "Close"}
          </button>
        )}
      </div>
      <div className="conv-people">
        <p><small>Started by {conv?.createdBy?.name ?? me.name}</small></p>
        <p>To: <strong>{namesLine(tagged, 6)}</strong></p>
        {conv && <button type="button" className="stop-more" onClick={() => setAdding(true)}>Add People</button>}
        {closed && <p className="procore-note">This conversation is closed. It stays in All Project; reopen it to put it back in For Me.</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <ul className="msg-list">
        {messages.map((m) => <Message key={m.id} m={m} me={me} onTask={onTask} />)}
        {waiting.map((p) => <Message key={p.mid} m={p} me={me} pending onTask={() => {}} />)}
      </ul>

      {conv && (
        <Composer key={replyKey} mode="reply" session={session} conversation={conv} onSent={() => setReplyKey((k) => k + 1)} />
      )}
    </section>
  );
}
