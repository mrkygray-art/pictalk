import { useEffect, useRef, useState } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "./firebase";
import App from "./App";
import PiccoloPane from "./piccolo/PiccoloPane";
import AccountSheet from "./AccountSheet";
import AdminConsole from "./admin/AdminConsole";
import { watchProfile, ensureProfile, createExampleJobs, acceptInvite, isEmailLinkVisit, roleLabel, errorText, retryGuestMerge } from "./accountStore";
import { readEmbed } from "./embedded";
import ProcorePanel from "./ProcorePanel";
import { PICCOLO } from "./features";

const PANE_KEY = "pictalk-pane";

// Embedded mode, for now: a small debug strip with what the host page sent. Shown inside an
// iframe, or when the link carries companyId / projectId; ordinary SiteSnap AI links never show it.
function EmbedStrip({ embed }) {
  if (!embed.embedded && !embed.hasIds) return null;
  return (
    <div className="embed-strip" role="status">
      <span>Embedded: {embed.embedded ? "yes" : "no"}</span>
      <span>Company: {embed.companyId ?? "not received"}</span>
      <span>Project: {embed.projectId ?? "not received"}</span>
    </div>
  );
}

const INVITE_KEY = "pictalk-invite";

function savedPane() {
  if (!PICCOLO) return "pictalk";
  try {
    return localStorage.getItem(PANE_KEY) === "piccolo" ? "piccolo" : "pictalk";
  } catch {
    return "pictalk";
  }
}

// An invite link (/?invite=ID) is remembered for this tab until it's used
function startInvite() {
  const id = new URL(window.location.href).searchParams.get("invite");
  try {
    if (id) sessionStorage.setItem(INVITE_KEY, id);
    return id || sessionStorage.getItem(INVITE_KEY);
  } catch {
    return id;
  }
}

function clearInvite() {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // nothing saved
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has("invite")) {
    url.searchParams.delete("invite");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}

// Signed-in user (refreshed when a guest links an account) and their users/{uid} profile.
// Makes the profile, or brings it up to date, through the account function.
function useAccount() {
  const [user, setUser] = useState(null);
  const [profileState, setProfileState] = useState({ uid: null });
  const asked = useRef("");

  useEffect(
    () =>
      onIdTokenChanged(auth, (u) =>
        // A guest who links Google keeps an empty top-level name; Google's is in providerData
        setUser(u ? {
          uid: u.uid,
          isAnonymous: u.isAnonymous,
          email: u.email || u.providerData.find((p) => p.email)?.email || null,
          displayName: u.displayName || u.providerData.find((p) => p.displayName)?.displayName || null,
        } : null)
      ),
    []
  );
  const uid = user?.uid;
  useEffect(() => (uid ? watchProfile(uid, (p) => setProfileState({ uid, ...p })) : undefined), [uid]);
  const profile = uid && profileState.uid === uid ? profileState : null;

  useEffect(() => {
    if (!user || !profile?.loaded) return;
    const key = `${user.uid}:${user.isAnonymous}`;
    // Also refresh profiles made before canDeleteJobs existed
    const stale = profile.missing || profile.isAnonymous !== user.isAnonymous || (!user.isAnonymous && profile.canDeleteJobs === undefined);
    if (!stale || asked.current === key) return;
    asked.current = key;
    ensureProfile().catch((err) => {
      asked.current = ""; // try again next time (e.g. back online)
      console.warn("Profile setup failed:", err);
    });
  }, [user, profile]);

  // A new guest (and the app owner) gets the example jobs once, the first time the app opens
  // (the server marks the profile with exampleJobsAt; deleted ones stay deleted)
  const examplesAsked = useRef("");
  useEffect(() => {
    if (!user || !profile?.loaded || profile.missing || profile.exampleJobsAt) return;
    if (!user.isAnonymous && !profile.canDeleteJobs) return;
    if (examplesAsked.current === user.uid) return;
    examplesAsked.current = user.uid;
    createExampleJobs().catch((err) => {
      examplesAsked.current = ""; // try again next time (e.g. back online)
      console.warn("Example jobs failed:", err);
    });
  }, [user, profile]);

  return { user, profile };
}

// The two panes (SiteSnap AI capture, Piccolo quoting) over the same account and the same jobs.
// SiteSnap AI stays mounted while Piccolo shows, so a recording or an open sheet isn't lost.
export default function Shell() {
  const { user, profile } = useAccount();
  const [pane, setPane] = useState(savedPane);
  const [view, setView] = useState("panes"); // "panes" | "team"
  const [inviteId, setInviteId] = useState(startInvite);
  const [inviteError, setInviteError] = useState("");
  const [emailLink, setEmailLink] = useState(isEmailLinkVisit);
  const [sheetOpen, setSheetOpen] = useState(() => isEmailLinkVisit() || !!startInvite());
  const [toast, setToast] = useState(null);
  const [piccoloTarget, setPiccoloTarget] = useState(null); // { jobId, autoDraft, key }
  const [pictalkTarget, setPictalkTarget] = useState(null); // { jobId, key }
  const [embed] = useState(() => readEmbed()); // { embedded, companyId, projectId }, read once on load

  const showToast = (text) => text && setToast((t) => ({ text, id: (t?.id ?? 0) + 1 }));
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const choosePane = (next) => {
    setPane(next);
    setView("panes");
    try {
      localStorage.setItem(PANE_KEY, next);
    } catch {
      // remembered for this visit only
    }
    window.scrollTo(0, 0);
  };

  // A signed-in person with an invite link joins that team (the function checks the email)
  const signedIn = user && !user.isAnonymous && profile?.loaded && !profile.missing;
  useEffect(() => {
    if (!inviteId || !signedIn || emailLink) return;
    let live = true;
    acceptInvite(inviteId)
      .then((r) => {
        if (!live) return;
        clearInvite();
        setInviteId(null);
        setInviteError("");
        showToast(`You're on the ${r.orgName} team as ${roleLabel(r.role)}`);
      })
      .catch((err) => {
        if (!live) return;
        clearInvite();
        setInviteId(null);
        setInviteError(errorText(err));
        setSheetOpen(true);
      });
    return () => {
      live = false;
    };
  }, [inviteId, signedIn, emailLink]);

  // A guest merge that was cut off (signal dropped) finishes the next time the app opens
  const signedInUid = user && !user.isAnonymous ? user.uid : null;
  useEffect(() => {
    if (!signedInUid) return;
    retryGuestMerge()
      .then((r) => r?.jobs && showToast(`We added your ${r.jobs} guest job${r.jobs === 1 ? "" : "s"} to your account`))
      .catch((err) => showToast(err.message));
  }, [signedInUid]);

  // Who the next stop is for, picked in the Procore panel's search (name, company, title; no contact details)
  const [recipients, setRecipients] = useState([]);
  const isAdmin = profile?.role === "admin" && profile?.status === "active" && !!profile?.orgId;
  const guest = !user || user.isAnonymous;
  const chip = guest ? "Sign in to SiteSnap" : (user.displayName || user.email || "Account").split(/[ @]/)[0];
  const sendToPiccolo = PICCOLO
    ? (jobId) => {
        setPiccoloTarget((t) => ({ jobId, autoDraft: true, key: (t?.key ?? 0) + 1 }));
        choosePane("piccolo");
      }
    : undefined;
  const openInPiccolo = PICCOLO
    ? (job) => {
        setPiccoloTarget((t) => ({ jobId: job.id, ownerUid: job.ownerUid, key: (t?.key ?? 0) + 1 }));
        choosePane("piccolo");
      }
    : undefined;

  return (
    <>
      <EmbedStrip embed={embed} />
      {/* Procore sign-in, project picker and Who is this for? search, only in a top-level tab
          (its login page can't load in an iframe). Hidden where there's no /api (dev server). */}
      {!embed.embedded && (
        <ProcorePanel companyId={embed.companyId} projectId={embed.projectId} recipients={recipients} onRecipients={setRecipients} />
      )}
      {!PICCOLO ? (
        // SiteSnap AI: no panes, just who's signed in
        <nav className="pane-bar account-bar" aria-label="Account">
          <p className="account-state">{guest ? "Not signed in" : `Signed in as ${user.displayName || user.email || "you"}`}</p>
          <button className={`account-chip${guest ? " is-guest" : ""}`} onClick={() => setSheetOpen(true)}>
            {guest ? "Sign in to SiteSnap" : "Account"}
          </button>
        </nav>
      ) : (
      <nav className="pane-bar" aria-label="Switch between SiteSnap AI and Piccolo">
        <div className="pane-switch" role="tablist">
          {[
            ["pictalk", "SiteSnap AI"],
            ["piccolo", "Piccolo"],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={pane === id && view === "panes"}
              className={pane === id && view === "panes" ? "is-on" : ""}
              onClick={() => choosePane(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className={`account-chip${user?.isAnonymous ? " is-guest" : ""}`} onClick={() => setSheetOpen(true)}>
          {chip}
        </button>
      </nav>
      )}

      <div className="pane-body" hidden={pane !== "pictalk" || view !== "panes"}>
        <App
          recipients={recipients}
          onClearRecipients={() => setRecipients([])}
          onSendToPiccolo={sendToPiccolo}
          openJob={pictalkTarget}
          canDeleteJobs={!!profile?.canDeleteJobs}
          embedded={embed.embedded}
        />
      </div>
      {PICCOLO && pane === "piccolo" && view === "panes" && (
        <PiccoloPane
          key={piccoloTarget?.key ?? 0}
          uid={user?.uid}
          isGuest={!user || user.isAnonymous}
          profile={profile}
          target={piccoloTarget}
          onAccount={() => setSheetOpen(true)}
          onOpenInPicTalk={(jobId) => {
            setPictalkTarget((t) => ({ jobId, key: (t?.key ?? 0) + 1 }));
            choosePane("pictalk");
          }}
          onNotice={showToast}
        />
      )}
      {view === "team" && isAdmin && (
        <main className="app">
          <AdminConsole
            uid={user.uid}
            profile={profile}
            onBack={() => setView("panes")}
            onNotice={showToast}
            onOpenJob={openInPiccolo}
          />
        </main>
      )}

      {sheetOpen && (
        <AccountSheet
          user={user}
          profile={profile}
          inviteId={inviteId}
          inviteError={inviteError}
          emailLink={emailLink}
          onEmailLinkDone={() => setEmailLink(false)}
          onTeam={() => {
            setSheetOpen(false);
            setView("team");
            window.scrollTo(0, 0);
          }}
          onNotice={showToast}
          onClose={() => {
            setSheetOpen(false);
            setInviteError("");
          }}
        />
      )}

      <div className="toast-slot" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            {toast.text}
          </div>
        )}
      </div>
    </>
  );
}
