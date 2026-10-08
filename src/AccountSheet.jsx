import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import {
  continueWithGoogle, sendEmailLink, pendingLinkEmail, emailLinkInfo, finishEmailLink, cancelEmailLink, signOutToGuest,
  createOrg, watchOrg, roleLabel, errorText,
} from "./accountStore";
import { isSignInWithEmailLink } from "firebase/auth";
import { auth } from "./firebase";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-2 3.2-4.8 3.2-8.2z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.3-.4-2s.1-1.4.4-2V7.1H2a11 11 0 0 0 0 9.8L5.7 14z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2 7.1L5.7 10C6.6 7.4 9.1 5.4 12 5.4z" />
    </svg>
  );
}

// Guest: attach Google or an emailed link to this same account
function SaveWork({ inviteId, onSignedIn }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState(pendingLinkEmail);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const google = () =>
    run(async () => {
      const result = await continueWithGoogle();
      onSignedIn(result);
    });

  const sendLink = (e) => {
    e.preventDefault();
    run(async () => {
      await sendEmailLink(email, { inviteId });
      setSentTo(email.trim());
    });
  };

  // iPhone: Mail opens links in Safari, not the home-screen app, so the link can be pasted here
  const finishPasted = (e) => {
    e.preventDefault();
    const href = pasted.trim();
    if (!isSignInWithEmailLink(auth, href)) return setError("That isn't the sign-in link. Copy the whole link from the email.");
    run(async () => {
      const result = await finishEmailLink(sentTo, { href });
      onSignedIn(result);
    });
  };

  return (
    <>
      <p>
        {inviteId
          ? "You've been invited to join a team. Sign in with the email address the invite was sent to."
          : "You're using PicTalk as a guest on this device. Guest jobs are deleted after 7 days. Sign in to keep them in your account and open them on other devices. The jobs you have now come with you."}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p className="sent-note" role="status">Saving your work…</p>}
      <button className="big-btn google-btn" onClick={google} disabled={busy}>
        <GoogleIcon />
        Continue with Google
      </button>
      {sentTo ? (
        <form className="sheet-form" onSubmit={finishPasted}>
          <p className="sent-note">
            We sent a sign-in link to <strong>{sentTo}</strong>. Open the email on this device and tap the link.
          </p>
          <div className="detail-fields">
            <label>
              Did it open in a different app, like Safari? Copy the link from the email and paste it here:
              <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the link" autoComplete="off" />
            </label>
          </div>
          <button type="submit" className="save-btn" disabled={busy || !pasted.trim()}>
            Finish Signing In
          </button>
          <button type="button" className="text-btn" onClick={() => setSentTo("")}>
            Use a different email
          </button>
        </form>
      ) : (
        <form className="sheet-form" onSubmit={sendLink}>
          <p className="or-line">or</p>
          <div className="detail-fields">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                enterKeyHint="send"
                maxLength={254}
              />
            </label>
          </div>
          <button type="submit" className="big-btn plain-btn" disabled={busy || !email.includes("@")}>
            Email Me a Link
          </button>
        </form>
      )}
    </>
  );
}

// Opened from the emailed link: finish signing in, or explain why it can't here
function FinishLink({ onSignedIn, onCancel }) {
  const [info, setInfo] = useState(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [link] = useState(() => window.location.href); // before it's cleaned from the address bar

  const finish = async (address, anyway = false) => {
    setBusy(true);
    setError("");
    try {
      onSignedIn(await finishEmailLink(address, { anyway }));
    } catch (err) {
      if (err.kind === "other-browser") setInfo((i) => ({ ...i, otherBrowser: true }));
      setError(errorText(err));
      setBusy(false);
    }
  };

  useEffect(() => {
    emailLinkInfo().then((i) => {
      setInfo(i);
      setEmail(i.email);
      if (i.email && !i.otherBrowser) finish(i.email); // the usual case: same browser, nothing to ask
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info || (busy && !info.otherBrowser)) return <p>Signing you in…</p>;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Press and hold the link in the email and choose Copy.");
    }
  };

  return (
    <>
      {info.otherBrowser ? (
        <>
          <p>
            This link opened in a different browser or app than the one you started in. Your guest jobs are there, so
            finish signing in there: copy this link, go back to PicTalk, tap Save my work, and paste it.
          </p>
          <button className="big-btn photo-btn" onClick={copyLink}>
            {copied ? "Link Copied" : "Copy This Link"}
          </button>
        </>
      ) : (
        <p>Confirm your email address to finish signing in.</p>
      )}
      {error && !info.otherBrowser && <p className="error" role="alert">{error}</p>}
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          finish(email, info.otherBrowser);
        }}
      >
        <div className="detail-fields">
          <label>
            {info.otherBrowser ? "Or sign in here anyway (jobs from the other browser stay there):" : "Email"}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" />
          </label>
        </div>
        <button type="submit" className={info.otherBrowser ? "big-btn plain-btn" : "save-btn"} disabled={busy || !email.includes("@")}>
          {info.otherBrowser ? "Sign In Here Anyway" : "Finish Signing In"}
        </button>
      </form>
      <button
        className="text-btn"
        onClick={() => {
          cancelEmailLink();
          onCancel();
        }}
      >
        Cancel
      </button>
    </>
  );
}

function StartCompany({ onNotice }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="sheet-form account-section"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await createOrg(name.trim());
          onNotice(`${name.trim()} is set up. You're its admin.`);
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Run a team?</h3>
      <p>Start a company to share jobs and invite people. You'll be its admin. Each email address can belong to one company.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="detail-fields">
        <label>
          Company name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoCapitalize="words" autoComplete="organization" />
        </label>
      </div>
      <button type="submit" className="big-btn plain-btn" disabled={busy || !name.trim()}>
        Start Company
      </button>
    </form>
  );
}

function AccountInfo({ user, profile, onTeam, onNotice, onClose }) {
  const [org, setOrg] = useState({ id: null });
  const [busy, setBusy] = useState(false);
  const orgId = profile?.status === "active" ? profile?.orgId : null;
  useEffect(() => (orgId ? watchOrg(orgId, (o) => setOrg(o || { id: orgId })) : undefined), [orgId]);
  const orgName = org.id === orgId ? org.name : "";

  return (
    <>
      <div className="account-who">
        <strong>{user.displayName || user.email}</strong>
        {user.displayName && <span>{user.email}</span>}
        <span>{orgId ? `${orgName || "Your company"} · ${roleLabel(profile.role)}` : "Personal account"}</span>
      </div>
      {profile?.orgId && profile.status === "disabled" && (
        <p className="limit-note">Your company turned off your access. Your own jobs are still here.</p>
      )}
      {orgId && profile.role === "admin" && (
        <button className="big-btn photo-btn" onClick={onTeam}>
          Manage Team
        </button>
      )}
      {profile?.loaded && !profile.missing && !profile.orgId && <StartCompany onNotice={onNotice} />}
      <p className="demo-note">Signing out keeps your jobs in your account. This device goes back to being a guest.</p>
      <button
        className="big-btn plain-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signOutToGuest();
            onNotice("Signed out");
            onClose();
          } catch (err) {
            onNotice(errorText(err) || "Couldn't sign out");
            setBusy(false);
          }
        }}
      >
        Sign Out
      </button>
    </>
  );
}

// "Save my work" for guests, the account page for everyone else, and the email-link landing
export default function AccountSheet({ user, profile, inviteId, inviteError, emailLink, onEmailLinkDone, onTeam, onNotice, onClose }) {
  const signedIn = (result) => {
    onEmailLinkDone();
    if (result?.joined) onNotice(`You joined ${result.joined.orgName} as ${roleLabel(result.joined.role)}`);
    else if (result?.merged?.jobs) onNotice(`We added your ${result.merged.jobs} guest job${result.merged.jobs === 1 ? "" : "s"} to your account`);
    else onNotice("Your work is saved to your account");
    onClose();
  };

  let title = "Your account";
  let body;
  if (emailLink) {
    title = "Finish signing in";
    body = <FinishLink onSignedIn={signedIn} onCancel={() => { onEmailLinkDone(); onClose(); }} />;
  } else if (!user || user.isAnonymous) {
    title = inviteId ? "Join your team" : "Save your work";
    body = <SaveWork inviteId={inviteId} onSignedIn={signedIn} />;
  } else {
    body = <AccountInfo user={user} profile={profile} onTeam={onTeam} onNotice={onNotice} onClose={onClose} />;
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {inviteError && <p className="error" role="alert">{inviteError}</p>}
      {body}
      {!emailLink && (
        <button className="text-btn" onClick={onClose}>
          Close
        </button>
      )}
    </Sheet>
  );
}
