import { useEffect, useRef, useState } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "./firebase";
import App from "./App";
import PiccoloPane from "./piccolo/PiccoloPane";
import AccountSheet from "./AccountSheet";
import AdminConsole from "./admin/AdminConsole";
import { watchProfile, ensureProfile, acceptInvite, isEmailLinkVisit, roleLabel, errorText, retryGuestMerge } from "./accountStore";
import { watchJobs } from "./jobStore";

const PANE_KEY = "pictalk-pane";
const BANNER_KEY = "pictalk-guest-banner"; // dismissed for this visit
const DAY = 24 * 60 * 60 * 1000;

// Guests: a privacy line, then "save your work" after a finished job, then a warning the
// day before a job is deleted (that one can't be dismissed).
function GuestBanner({ uid, onSave }) {
  const [jobs, setJobs] = useState({ uid: null, list: [] });
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(BANNER_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [now] = useState(() => Date.now());
  useEffect(() => (uid ? watchJobs(uid, (list) => setJobs({ uid, list })) : undefined), [uid]);
  const own = (jobs.uid === uid ? jobs.list : []).filter((j) => !j.isDemo);
  const soon = own.filter((j) => j.expiresAt && j.expiresAt - now < DAY).length;
  const finished = own.some((j) => j.status === "finished");
  const hide = () => {
    setHidden(true);
    try {
      sessionStorage.setItem(BANNER_KEY, "1");
    } catch {
      // hidden until the app is reopened
    }
  };

  if (soon) {
    return (
      <div className="guest-banner is-urgent" role="alert">
        <p>
          {soon === 1 ? "A job" : `${soon} jobs`} will be deleted within a day. Save your work to keep {soon === 1 ? "it" : "them"}.
        </p>
        <button className="link-btn" onClick={onSave}>
          Save my work
        </button>
      </div>
    );
  }
  if (hidden) return null;
  return (
    <div className="guest-banner" role="status">
      <p>
        {finished
          ? "Save your work so it follows you. Guest jobs are deleted after 7 days."
          : "Guest mode: jobs are deleted after 7 days. Don't capture anything sensitive until you save your work."}
      </p>
      <div className="guest-banner-actions">
        <button className="link-btn" onClick={onSave}>
          Save my work
        </button>
        <button className="text-btn" onClick={hide} aria-label="Hide this message">
          Not now
        </button>
      </div>
    </div>
  );
}
const INVITE_KEY = "pictalk-invite";

function savedPane() {
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
    const stale = profile.missing || profile.isAnonymous !== user.isAnonymous;
    if (!stale || asked.current === key) return;
    asked.current = key;
    ensureProfile().catch((err) => {
      asked.current = ""; // try again next time (e.g. back online)
      console.warn("Profile setup failed:", err);
    });
  }, [user, profile]);

  return { user, profile };
}

// The two panes (PicTalk capture, Piccolo quoting) over the same account and the same jobs.
// PicTalk stays mounted while Piccolo shows, so a recording or an open sheet isn't lost.
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

  const isAdmin = profile?.role === "admin" && profile?.status === "active" && !!profile?.orgId;
  const chip = !user || user.isAnonymous ? "Save my work" : (user.displayName || user.email || "Account").split(/[ @]/)[0];

  return (
    <>
      <nav className="pane-bar" aria-label="Switch between PicTalk and Piccolo">
        <div className="pane-switch" role="tablist">
          {[
            ["pictalk", "PicTalk"],
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

      {user?.isAnonymous && view === "panes" && <GuestBanner uid={user.uid} onSave={() => setSheetOpen(true)} />}

      <div className="pane-body" hidden={pane !== "pictalk" || view !== "panes"}>
        <App
          onSendToPiccolo={(jobId) => {
            setPiccoloTarget((t) => ({ jobId, autoDraft: true, key: (t?.key ?? 0) + 1 }));
            choosePane("piccolo");
          }}
          openJob={pictalkTarget}
        />
      </div>
      {pane === "piccolo" && view === "panes" && (
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
            onOpenJob={(job) => {
              setPiccoloTarget((t) => ({ jobId: job.id, ownerUid: job.ownerUid, key: (t?.key ?? 0) + 1 }));
              choosePane("piccolo");
            }}
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
