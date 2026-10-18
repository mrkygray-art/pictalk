import { useCallback, useEffect, useState } from "react";
import Composer from "./Composer";
import { BackIcon, ChevronIcon, IssueIcon, MyItemsIcon } from "./icons";
import { forgetMyItems, loadItem, loadMyItems } from "./myItemsStore";
import { findRecordThread, projectKey } from "./messagingStore";
import { markFixedByRecord, recordAction } from "./recordStore";
import { replyFor, statusOf } from "./quickReplies";
import { recipientOf } from "../directorySearch";

// My items (sitesnap-report-picker-my-items-spec.md, section 6): Observations and Punch Items assigned to me on this
// project, grouped Overdue / Open / Ready for review, due date first. Tap one for the detail; Mark fixed is the
// existing close-out: the same photo + voice composer sent with Done, then Procore's Ready for review (the change
// a thread's Done makes). An item with a SiteSnap thread gets a reply there; one without starts a thread that
// follows the record, with whoever assigned it on CC. Guest demo: everything works up to Send (Composer's note).
const GROUPS = [["overdue", "Overdue"], ["open", "Open"], ["ready", "Ready for review"]];
const KIND = { observation: "Observation", punch_item: "Punch Item" };

const dayLabel = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
function whenLine(item, today) {
  if (item.due) {
    if (item.overdue) {
      const days = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${item.due}T12:00:00`)) / 86_400_000);
      return `${days} day${days === 1 ? "" : "s"} overdue`;
    }
    return item.due === today ? "Due today" : `Due ${dayLabel(item.due)}`;
  }
  if (item.createdAt) {
    const days = Math.max(0, Math.round((Date.now() - Date.parse(item.createdAt)) / 86_400_000));
    return days === 0 ? "Assigned today" : `${days} day${days === 1 ? "" : "s"} old`;
  }
  return "";
}

export default function MyItems({ session, onBack, onOpenThread }) {
  const { project } = session;
  const [state, setState] = useState({ loading: true });
  const [open, setOpen] = useState(null); // the row picked
  const [asked, setAsked] = useState(0);
  const reload = useCallback(() => { forgetMyItems(project); setAsked((n) => n + 1); }, [project]);

  useEffect(() => {
    let live = true;
    loadMyItems(project).then((data) => live && setState({ data }), (err) => live && setState({ error: err.message }));
    return () => { live = false; };
  }, [project, asked]);

  if (open) return <ItemDetail session={session} row={open} today={state.data?.today} onBack={() => setOpen(null)} onFixed={() => { setOpen(null); setState({ loading: true }); reload(); }} onOpenThread={onOpenThread} />;

  const data = state.data;
  const total = data ? data.groups.overdue.length + data.groups.open.length + data.groups.ready.length : 0;
  return (
    <section className="mi">
      <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> Home</button>
      <h2 className="page-title">My items</h2>
      {state.loading && <p className="mi-muted">Loading your items from Procore…</p>}
      {state.error && (
        <>
          <p className="error" role="alert">{state.error}</p>
          <button type="button" className="big-btn plain-btn" onClick={() => { setState({ loading: true }); reload(); }}>Try Again</button>
        </>
      )}
      {data && total === 0 && <p className="mi-empty">Nothing assigned to you on this project.</p>}
      {data && GROUPS.map(([key, label]) => data.groups[key].length > 0 && (
        <div className="mi-group" key={key}>
          <h3 className={key === "overdue" ? "is-alert" : ""}>{label} <small>{data.groups[key].length}</small></h3>
          <ul className="rp-list">
            {data.groups[key].map((item) => (
              <li key={`${item.type}-${item.id}`}>
                <button type="button" className={`rp-row mi-row${item.overdue ? " is-overdue" : ""}`} onClick={() => setOpen(item)}>
                  {item.type === "observation" ? <IssueIcon /> : <MyItemsIcon />}
                  <span>
                    <strong>{item.title}</strong>
                    <small>{[`${KIND[item.type]}${item.number ? ` #${item.number}` : ""}`, item.location].filter(Boolean).join(" · ")}</small>
                    <small className="mi-when">{[whenLine(item, data.today), item.status].filter(Boolean).join(" · ")}</small>
                  </span>
                  <ChevronIcon />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {data && <button type="button" className="text-btn" onClick={() => { setState({ loading: true }); reload(); }}>Refresh</button>}
    </section>
  );
}

function ItemDetail({ session, row, today, onBack, onFixed, onOpenThread }) {
  const { project } = session;
  const [item, setItem] = useState(row);
  const [error, setError] = useState("");
  const [thread, setThread] = useState(undefined); // undefined = still looking, null = none
  const [fixing, setFixing] = useState(false);
  const [marking, setMarking] = useState(""); // "" | "working" | "failed" | "done"
  const key = projectKey(project);

  useEffect(() => {
    let live = true;
    loadItem(project, row.type, row.id).then((full) => live && setItem((it) => ({ ...it, ...full, overdue: it.overdue })), (err) => live && setError(err.message));
    findRecordThread(key, row.type, row.id).then((c) => live && setThread(c), () => live && setThread(null));
    return () => { live = false; };
  }, [project, key, row.type, row.id]);

  // After the photo + voice message is saved: the same Procore change as Done in a thread
  const markReady = async (cid, existing) => {
    setMarking("working");
    setError("");
    try {
      if (existing) await recordAction(project, cid, "done");
      else await markFixedByRecord(project, row.type, row.id);
      setMarking("done");
      forgetMyItems(project);
    } catch (e) {
      setMarking("failed");
      setError(e.message);
    }
  };

  if (fixing) {
    const assigner = item.assignedById && session.dir?.people?.find((p) => String(p.id) === String(item.assignedById));
    const existing = thread && thread.status !== "closed" ? thread : null;
    return (
      <section className="mi">
        <h2 className="page-title">Mark fixed</h2>
        <p className="mi-muted">{KIND[row.type]}{item.number ? ` #${item.number}` : ""}: {item.title}</p>
        <p className="procore-note">Add a photo of the fix and say what you did. It goes {existing ? "on the item's thread" : "on a thread for this item"}, and the item goes to <strong>Ready for review</strong> in Procore.</p>
        <Composer
          mode={existing ? "reply" : "new"}
          session={session}
          conversation={existing}
          quickReplies
          initialStatus={statusOf(replyFor("done"))}
          initialPicked={!existing && assigner ? [{ ...recipientOf(assigner), cc: true }] : null}
          procoreLink={existing ? null : { recordType: row.type, id: Number(row.id), number: item.number ?? "", url: String(item.url ?? "").slice(0, 300), projectId: project.projectId, title: String(item.title).slice(0, 120), due: item.due ?? "" }}
          onCancel={() => setFixing(false)}
          onSent={(cid, status) => {
            setFixing(false);
            if (status?.code === "done") markReady(cid, !!existing);
            else setThread((t) => t ?? { id: cid });
          }}
        />
      </section>
    );
  }

  const canFix = item.stage === "open";
  return (
    <section className="mi">
      <button type="button" className="link-btn msg-home-back" onClick={onBack}><BackIcon /> My items</button>
      <p className="mi-muted">{KIND[row.type]}{item.number ? ` #${item.number}` : ""}{item.kind ? ` · ${item.kind}` : ""}</p>
      <h2 className="page-title">{item.title}</h2>
      <dl className="mi-facts">
        <div><dt>Status</dt><dd>{marking === "done" ? "Ready for review" : item.status}</dd></div>
        {item.due && <div><dt>Due</dt><dd className={item.overdue ? "is-alert" : ""}>{dayLabel(item.due)}{today ? ` (${whenLine(item, today)})` : ""}</dd></div>}
        {item.location && <div><dt>Where</dt><dd>{item.location}</dd></div>}
        {item.assignedBy && <div><dt>Assigned by</dt><dd>{item.assignedBy}</dd></div>}
      </dl>
      {item.description && <p className="mi-desc">{item.description}</p>}
      {item.photos?.length > 0 && (
        <ul className="mi-photos">
          {item.photos.map((p) => (
            <li key={p.url}>
              {/^https:\/\/([a-z0-9-]+\.)*procore\.com\//i.test(p.thumb || p.url)
                ? <img src={`/api/procore/photo-file?${new URLSearchParams({ companyId: project.companyId, projectId: project.projectId, u: p.thumb || p.url })}`} alt={p.name || "Photo"} loading="lazy" />
                : <span className="mi-photo-off">{p.name || "Photo"}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {marking === "working" && <p className="msg-status">Marking it ready for review in Procore…</p>}
      {marking === "done" && <p className="msg-status" role="status">Sent. It's Ready for review in Procore.</p>}
      {marking === "failed" && (
        <button type="button" className="big-btn plain-btn" onClick={() => markReady(thread?.id, !!thread?.procore)}>Try Marking It Ready Again</button>
      )}
      {canFix && marking !== "done" && marking !== "failed" && (
        <button type="button" className="big-btn photo-btn" disabled={thread === undefined || marking === "working"} onClick={() => setFixing(true)}>
          Mark Fixed
        </button>
      )}
      {marking === "done" && <button type="button" className="save-btn" onClick={onFixed}>Back to My Items</button>}
      {thread?.id && thread.procore && <button type="button" className="text-btn" onClick={() => onOpenThread(thread.id)}>Open the Thread</button>}
      {item.url && <a className="text-btn" href={item.url} target="_blank" rel="noopener">Open in Procore</a>}
    </section>
  );
}
