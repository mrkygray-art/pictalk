import { useEffect, useState } from "react";
import { readEmbed } from "../embedded";
import { useProcoreSession } from "./useProcoreSession";
import Feed from "./Feed";
import ConversationView from "./ConversationView";
import Composer from "./Composer";
import { onQueueChange, pendingMessages, startMessageSync, watchReads } from "./messagingStore";

// SiteSnap AI as project messaging (SPEC-messaging-pivot): sign in with Procore, pick a project, and
// the home screen is that project's conversation feed. New Message: tag people, take photos, talk,
// send. The old job / stop screens are kept in the code behind VITE_FEATURE_JOBS=1 (src/features.js).
const RESULT = { denied: "Procore sign-in was cancelled.", error: "Procore sign-in didn't work. Try again." };

export default function MessagingApp() {
  const [embed] = useState(readEmbed);
  const session = useProcoreSession({ linkCompanyId: embed.companyId, linkProjectId: embed.projectId });
  const { state, me, projects, project, choose, signedIn } = session;
  const [view, setView] = useState({ name: "feed" }); // feed | conversation {cid} | compose
  const [choosing, setChoosing] = useState(false);
  const [reads, setReads] = useState(new Map());
  const [pending, setPending] = useState([]);
  const [result] = useState(() => RESULT[new URLSearchParams(window.location.search).get("procore")] ?? "");
  const key = project ? `${project.companyId}_${project.projectId}` : null;

  useEffect(() => (signedIn ? startMessageSync() : undefined), [signedIn]);
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
          <button type="button" className="big-btn photo-btn" onClick={session.connect}>Sign in with Procore</button>
        )}
        {state.step === "ready" && <p className="procore-note">Signing in…</p>}
      </main>
    );
  }

  const multiCompany = new Set(projects.map((p) => p.companyId)).size > 1;
  // Who's signed in, from their Procore project directory entry: name · company · title (only what exists)
  const mine = session.dir?.people?.find((p) => String(p.id) === String(me.procoreUserId));
  const whoLine = [me.name, mine?.company, mine?.title || mine?.role].filter(Boolean).join(" · ");
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
                  <button type="button" className={`dir-project-btn${p.projectId === project?.projectId && p.companyId === project?.companyId ? " is-on" : ""}`} onClick={() => { choose(p); setChoosing(false); setView({ name: "feed" }); }}>
                    <strong>{p.name}</strong>
                    {multiCompany && p.companyName && <span>{p.companyName}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {project && <button type="button" className="text-btn" onClick={() => setChoosing(false)}>Keep {project.name}</button>}
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

      {view.name === "feed" && (
        <>
          <div className="msg-title-row">
            <h2 className="page-title">Messages</h2>
          </div>
          <button type="button" className="big-btn photo-btn msg-new" onClick={() => setView({ name: "compose" })}>New Message</button>
          <Feed projectKey={key} me={me.procoreUserId} reads={reads} pending={pending} onOpen={(cid) => setView({ name: "conversation", cid })} />
          <p className="msg-footnote">Only people on this Procore project can see its messages. Everyone on a message can see when it was sent, seen and answered.</p>
        </>
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
