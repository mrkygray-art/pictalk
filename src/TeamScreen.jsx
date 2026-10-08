import { useEffect, useState } from "react";
import {
  TEAM_ROLES, roleLabel, createInvite, revokeInvite, updateMember, watchTeam, watchInvites, watchOrg, inviteLink, errorText,
} from "./accountStore";

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function RolePicker({ value, onChange, disabled, label = "Role" }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {TEAM_ROLES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}: {r.about}
          </option>
        ))}
      </select>
    </label>
  );
}

// Copy (or share, on phones) an invite link. Admins send it themselves for now.
async function sendLink(id, email, onNotice) {
  const url = inviteLink(id);
  try {
    await navigator.clipboard.writeText(url);
    onNotice(`Invite link copied. Send it to ${email}.`);
  } catch {
    if (navigator.share) await navigator.share({ title: "Join my team on PicTalk", url }).catch(() => {});
    else window.prompt("Copy this invite link:", url);
  }
}

// Admins only (the rules and functions check too): invite people, change roles, turn access off
export default function TeamScreen({ uid, profile, onBack, onNotice, embedded = false }) {
  const orgId = profile.orgId;
  const [team, setTeam] = useState({ orgId: null, list: [] });
  const [invites, setInvites] = useState({ orgId: null, list: [] });
  const [org, setOrg] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("estimator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState(null); // the invite just made: { id, email }

  useEffect(() => watchTeam(orgId, (list) => setTeam({ orgId, list })), [orgId]);
  useEffect(() => watchInvites(orgId, (list) => setInvites({ orgId, list })), [orgId]);
  useEffect(() => watchOrg(orgId, setOrg), [orgId]);

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

  const people = (team.orgId === orgId ? team.list : [])
    .slice()
    .sort((a, b) => (a.status === b.status ? (a.email || "").localeCompare(b.email || "") : a.status === "active" ? -1 : 1));
  const waiting = (invites.orgId === orgId ? invites.list : []).filter((i) => i.status === "pending");

  return (
    <>
      {!embedded && (
        <>
          <button className="link-btn" onClick={onBack}>
            <BackIcon />
            Back
          </button>
          <h1 className="page-title">Team</h1>
          {org?.name && <p className="subtitle">{org.name}</p>}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <form
        className="sheet-form team-box"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const address = email.trim();
            const { inviteId } = await createInvite(address, role);
            setEmail("");
            setLatest({ id: inviteId, email: address });
          });
        }}
      >
        <h2>Invite someone</h2>
        <div className="detail-fields">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" maxLength={254} />
          </label>
          <RolePicker value={role} onChange={setRole} />
        </div>
        <button type="submit" className="save-btn" disabled={busy || !email.includes("@")}>
          Create Invite Link
        </button>
        <p className="demo-note">You'll get a link to send them. They sign in with this email to join.</p>
        {latest && (
          <div className="invite-ready" role="status">
            <p>
              Invite ready for <strong>{latest.email}</strong>. Copy the link and send it to them.
            </p>
            <button type="button" className="big-btn photo-btn" onClick={() => sendLink(latest.id, latest.email, onNotice)}>
              Copy Invite Link
            </button>
          </div>
        )}
      </form>

      {waiting.length > 0 && (
        <section className="team-list" aria-label="Waiting invites">
          <h2>Waiting to join</h2>
          {waiting.map((i) => (
            <div key={i.id} className="team-row">
              <strong>{i.email}</strong>
              <span>{roleLabel(i.role)}</span>
              <div className="team-actions">
                <button className="link-btn" onClick={() => sendLink(i.id, i.email, onNotice)}>
                  Copy Link
                </button>
                <button className="text-btn is-danger" disabled={busy} onClick={() => run(() => revokeInvite(i.id))}>
                  Cancel invite
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="team-list" aria-label="People">
        <h2>People</h2>
        {people.map((p) => (
          <div key={p.uid} className={`team-row${p.status === "active" ? "" : " is-off"}`}>
            <strong>
              {p.displayName || p.email || "Team member"}
              {p.uid === uid && <span className="pill">You</span>}
            </strong>
            {p.displayName && p.email && <span>{p.email}</span>}
            {p.status !== "active" && <span>Access turned off</span>}
            <div className="detail-fields">
              <RolePicker
                value={p.role}
                disabled={busy}
                onChange={(next) =>
                  run(async () => {
                    await updateMember(p.uid, { role: next });
                    onNotice(`${p.displayName || p.email} is now ${roleLabel(next)}`);
                  })
                }
              />
            </div>
            <button
              className="text-btn"
              disabled={busy}
              onClick={() => run(() => updateMember(p.uid, { status: p.status === "active" ? "disabled" : "active" }))}
            >
              {p.status === "active" ? "Turn off access" : "Turn access back on"}
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
