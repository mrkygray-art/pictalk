import { useEffect, useState } from "react";
import { readEmbed } from "../embedded";
import { useProcoreSession } from "./useProcoreSession";
import Feed from "./Feed";
import ConversationView from "./ConversationView";
import Composer from "./Composer";
import ReportFlow from "./ReportFlow";
import AccessList from "./AccessList";
import PushToggle from "./PushToggle";
import ProjectHome from "./ProjectHome";
import PhotosView from "./PhotosView";
import DailyLogFlow from "./DailyLogFlow";
import { hasDraft, lastSent } from "./dailyLogStore";
import { startPhotoSync } from "./photoQueue";
import { BackIcon } from "./icons";
import { readBeta } from "./beta";
import { isUnread, onQueueChange, pendingMessages, startMessageSync, watchFeed, watchReads } from "./messagingStore";

// SiteSnap AI (SPEC-messaging-pivot, then docs/sitesnap-project-home-and-photos-spec.md): sign in with
// Procore, pick a project, and land on the project home: Report an issue, Message (the conversation feed;
// New Message: tag people, take photos, talk, send) and Project photos (Procore's Photos tool). The old job / stop screens are kept in the code behind VITE_FEATURE_JOBS=1 (src/features.js).
const RESULT = { denied: "Procore sign-in was cancelled.", error: "Procore sign-in didn't work. Try again." };

export default function MessagingApp() {
  const [embed] = useState(readEmbed);
  const [beta] = useState(readBeta); // ?beta=report: the "who can't get records" list (Report an issue is on the home screen now)
  const session = useProcoreSession({ linkCompanyId: embed.companyId, linkProjectId: embed.projectId });
  const { state, me, projects, project, choose, signedIn } = session;
  // An alert opens its thread: /?companyId=&projectId=&cid=
  const [view, setView] = useState(() => {
    const cid = new URLSearchParams(window.location.search).get("cid");
    return cid && /^[A-Za-z0-9_-]{1,64}$/.test(cid) ? { name: "conversation", cid } : { name: "home" };
  }); // home | feed | conversation {cid} | compose | report | photos | dailylog | access
  const [choosing, setChoosing] = useState(false);
  const [reads, setReads] = useState(new Map());
  const [pending, setPending] = useState([]);
  const [forMe, setForMe] = useState([]); // for the Message tile's count
  const [result] = useState(() => RESULT[new URLSearchParams(window.location.search).get("procore")] ?? "");
  const key = project ? `${project.companyId}_${project.projectId}` : null;

  useEffect(() => (signedIn ? startMessageSync() : undefined), [signedIn]);
  useEffect(() => (signedIn ? startPhotoSync() : undefined), [signedIn]); // Snap photos waiting on this phone
  // Keep the address bar plain: drop ?procore=… once its message has been read
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("procore")) return;
    url.searchParams.delete("procore");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    const load = () => pendingMessages().then(setPending).catch(() => {});
    load();
    return onQueueChange(load);
  }, []);
  useEffect(() => (signedIn && key ? watchReads(key, me.procoreUserId, setReads) : undefined), [signedIn, key, me?.procoreUserId]);
  useEffect(() => (signedIn && key && view.name === "home" ? watchFeed(key, "forMe", me.procoreUserId, (list, err) => !err && setForMe(list)) : undefined), [signedIn, key, me?.procoreUserId, view.name]);

  // Inside Procore's frame there's no sign-in (Procore's login page can't load there): open a tab
  if (embed.embedded) {
    return (
      <main className="app msg-app">
        <h1 className="page-title">SiteSnap AI</h1>
        <p className="subtitle">Messages with photos and voice for your Procore project team.</p>
        <button type="button" className="big-btn photo-btn" onClick={() => window.open(window.location.href, "_blank", "noopener")}>
          Open SiteSnap AI in a New Tab
        </button>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="app msg-app msg-signin">
        <h1 className="page-title">SiteSnap AI</h1>
        <p className="subtitle">Snap a photo, say what you see, and send it to the right people on your Procore project.</p>
        {result && <p className="procore-note">{result}</p>}
        {state.step === "loading" && <p className="procore-note">Checking Procore…</p>}
        {state.step === "unavailable" && <p className="procore-note">Procore sign-in isn't available on this site.</p>}
        {state.step === "failed" && <p className="procore-note">{state.message}</p>}
        {(state.step === "signin" || state.step === "failed") && (
          <>
            <button type="button" className="big-btn photo-btn" onClick={() => session.connect()}>Sign in with Procore</button>
            <button type="button" className="text-btn" onClick={session.switchAccount}>Use a different Procore account</button>
            <p className="procore-note">That signs you out of Procore too, then asks for the other person's Procore email and password.</p>
          </>
        )}
        {state.step === "ready" && <p className="procore-note">Signing in…</p>}
        {state.step === "switching" && <p className="procore-note">Signing you out of Procore… A small Procore window opened: don't log in there. It closes by itself in a few seconds, then Procore's login opens here.</p>}
      </main>
    );
  }

  const multiCompany = new Set(projects.map((p) => p.companyId)).size > 1;
  // Who's signed in, from their Procore project directory entry: name · company · title (only what exists)
  const mine = session.dir?.people?.find((p) => String(p.id) === String(me.procoreUserId));
  const whoLine = [String(me.name ?? "").trim() || mine?.name || "Signed in", mine?.company, mine?.title || mine?.role].filter(Boolean).join(" · ");
  if (!project || choosing) {
    return (
      <main className="app msg-app">
        <h1 className="page-title">Pick a project</h1>
        {projects.length === 0 ? (
          <p className="empty">You're not on any Procore projects yet. Ask your project manager to add you in Procore.</p>
        ) : (
          <div className="dir-projects">
            <ul>
              {projects.map((p) => (
                <li key={`${p.companyId}_${p.projectId}`}>
                  <button type="button" className={`dir-project-btn${p.projectId === project?.projectId && p.companyId === project?.companyId ? " is-on" : ""}`} onClick={() => { choose(p); setChoosing(false); setView({ name: "home" }); }}>
                    <strong>{p.name}</strong>
                    {multiCompany && p.companyName && <span>{p.companyName}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {project && <button type="button" className="text-btn" onClick={() => { setChoosing(false); setView({ name: "home" }); }}>Keep {project.name}</button>}
        <button type="button" className="text-btn" onClick={session.signOut}>Sign out</button>
      </main>
    );
  }

  return (
    <main className="app msg-app">
      <header className="msg-header">
        <div className="dir-project">
          <div>
            <small>Procore project</small>
            <strong>{project.name}</strong>
          </div>
          {projects.length > 1 && <button type="button" className="stop-more" onClick={() => setChoosing(true)}>Switch Project</button>}
        </div>
        <p className="msg-who">
          {state.offline ? "Offline · " : ""}<strong>{whoLine}</strong> · <button type="button" className="text-btn inline" onClick={session.signOut}>Sign out</button>
        </p>
      </header>

      {view.name === "home" && (
        <>
          <ProjectHome
            unread={forMe.filter((c) => isUnread(c, me.procoreUserId, reads)).length}
            onReport={() => setView({ name: "report" })}
            onMessages={() => setView({ name: "feed" })}
            onPhotos={() => setView({ name: "photos" })}
            onDailyLog={() => setView({ name: "dailylog" })}
            dailyStatus={dailyStatusFor(key)}
          />
          <PushToggle myId={me.procoreUserId} />
          {beta && <button type="button" className="text-btn" onClick={() => setView({ name: "access" })}>Who can't get Punch Items or Observations?</button>}
        </>
      )}
      {view.name === "photos" && <PhotosView session={session} onBack={() => setView({ name: "home" })} />}
      {view.name === "dailylog" && <DailyLogFlow key={key} session={session} onClose={() => setView({ name: "home" })} />}
      {view.name === "feed" && (
        <>
          <button type="button" className="link-btn msg-home-back" onClick={() => setView({ name: "home" })}><BackIcon /> Home</button>
          <div className="msg-title-row">
            <h2 className="page-title">Messages</h2>
          </div>
          <button type="button" className="big-btn photo-btn msg-new" onClick={() => setView({ name: "compose" })}>New Message</button>
          <p className="msg-new-hint">Stays in SiteSnap. Nothing goes to Procore.</p>
          <Feed projectKey={key} me={me.procoreUserId} reads={reads} pending={pending} onOpen={(cid) => setView({ name: "conversation", cid })} />
          <p className="msg-footnote">Only people on this Procore project can see its messages. Everyone on a message can see when it was sent, seen and answered.</p>
        </>
      )}
      {view.name === "access" && <AccessList session={session} onBack={() => setView({ name: "home" })} />}
      {view.name === "report" && (
        <ReportFlow session={session} onClose={() => setView({ name: "home" })} onOpenThread={(cid) => setView({ name: "conversation", cid })} />
      )}
      {view.name === "compose" && (
        <Composer mode="new" session={session} onCancel={() => setView({ name: "feed" })} onSent={(cid) => setView({ name: "conversation", cid })} />
      )}
      {view.name === "conversation" && (
        <ConversationView key={view.cid} session={session} projectKey={key} cid={view.cid} pending={pending} onBack={() => setView({ name: "feed" })} />
      )}
    </main>
  );
}

// The Daily log tile's line: a draft on this phone, else what was sent today (the project's date), else nothing
function dailyStatusFor(key) {
  if (hasDraft(key)) return "draft";
  const sent = lastSent(key);
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  return sent && sent.date === today ? { count: sent.count } : null;
}
