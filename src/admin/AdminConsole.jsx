import { useEffect, useState } from "react";
import Sheet from "../Sheet";
import TeamScreen from "../TeamScreen";
import { jobTitle } from "../jobStore";
import { deliverFile } from "../exportJob";
import { watchOrg, watchTeam, roleLabel, errorText } from "../accountStore";
import { AssignSheet } from "../piccolo/TeamViews";
import {
  SALES, salesLabel, salesStatusOf, watchCustomers, watchOrgJobs, watchActivity, saveCustomer, saveOrgSettings,
  updateTeamJob, orgStorageUsage, exportAll, jobsCsv, watchLearning, clearLearning,
} from "./adminStore";

const TABS = [
  ["people", "People"],
  ["jobs", "Jobs"],
  ["customers", "Customers"],
  ["settings", "Settings"],
  ["activity", "Activity"],
  ["data", "Data"],
];
const DAY = 24 * 60 * 60 * 1000;
const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const nameOf = (team, uid) => {
  const p = team.find((x) => x.uid === uid);
  return p ? p.displayName || p.email : "Someone";
};

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

// ---------- Jobs ----------

function JobSheet({ job, customers, orgId, onOpen, onNotice, onClose }) {
  const [sales, setSales] = useState(salesStatusOf(job));
  const [customerId, setCustomerId] = useState(job.customerId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assigning, setAssigning] = useState(false);
  if (assigning) return <AssignSheet job={job} orgId={orgId} onNotice={onNotice} onClose={onClose} />;
  return (
    <Sheet title={jobTitle(job)} onClose={() => !busy && onClose()}>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="detail-fields">
        <label>
          Sales status
          <select value={sales} onChange={(e) => setSales(e.target.value)}>
            {SALES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Not linked</option>
            {customers
              .filter((c) => !c.archived || c.id === job.customerId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <button
        className="save-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await updateTeamJob(job.ownerUid, job.id, { salesStatus: sales, customerId: customerId || null });
            onNotice("Job saved");
            onClose();
          } catch (err) {
            setError(errorText(err) || "Couldn't save. Please try again.");
            setBusy(false);
          }
        }}
      >
        Save
      </button>
      <button className="big-btn plain-btn" onClick={() => setAssigning(true)}>
        Assign People
      </button>
      <button className="big-btn photo-btn" onClick={() => onOpen(job)}>
        Open in Piccolo
      </button>
      <button className="text-btn" onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}

function JobsTab({ jobs, customers, team, orgId, onOpen, onNotice }) {
  const [f, setF] = useState({ sales: "", customer: "", person: "", days: "" });
  const [open, setOpen] = useState(null);
  const [now] = useState(() => Date.now());
  const shown = jobs
    .filter((j) => !f.sales || salesStatusOf(j) === f.sales)
    .filter((j) => !f.customer || j.customerId === f.customer)
    .filter((j) => !f.person || j.ownerUid === f.person || (j.assignedTo || []).includes(f.person))
    .filter((j) => !f.days || (j.startedAt || 0) > now - Number(f.days) * DAY)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const counts = Object.fromEntries(SALES.map(([id]) => [id, jobs.filter((j) => salesStatusOf(j) === id).length]));
  return (
    <>
      <div className="adm-stats">
        {SALES.map(([id, label]) => (
          <button key={id} className={`adm-stat${f.sales === id ? " is-on" : ""}`} onClick={() => setF({ ...f, sales: f.sales === id ? "" : id })}>
            <strong>{counts[id]}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="detail-fields adm-filters">
        <label>
          Customer
          <select value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Person
          <select value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}>
            <option value="">Everyone</option>
            {team.map((p) => (
              <option key={p.uid} value={p.uid}>
                {p.displayName || p.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          When
          <select value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
            <option value="">Any time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
      </div>
      {shown.length === 0 && <p className="empty">No jobs match.</p>}
      {shown.map((j) => (
        <button key={`${j.ownerUid}/${j.id}`} className="job-card" onClick={() => setOpen(j)}>
          <strong>
            {jobTitle(j)}
            <span className={`pill is-${salesStatusOf(j)}`}>{salesLabel(salesStatusOf(j))}</span>
          </strong>
          <span>
            {customers.find((c) => c.id === j.customerId)?.name || "No customer linked"} · captured by {nameOf(team, j.ownerUid)}
          </span>
          {(j.assignedTo || []).length > 0 && <span>Assigned: {j.assignedTo.map((u) => nameOf(team, u)).join(", ")}</span>}
        </button>
      ))}
      {open && <JobSheet job={open} customers={customers} orgId={orgId} onOpen={onOpen} onNotice={onNotice} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------- Customers ----------

function CustomerSheet({ customer, onSave, onClose }) {
  const [c, setC] = useState(() => ({
    ...customer,
    contacts: customer.contacts?.length ? customer.contacts : [{ name: "", phone: "", email: "" }],
  }));
  const [busy, setBusy] = useState(false);
  const setContact = (i, k, v) => setC({ ...c, contacts: c.contacts.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  return (
    <Sheet title={customer.id ? "Edit customer" : "New customer"} onClose={() => !busy && onClose()}>
      <form
        className="sheet-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSave(c);
        }}
      >
        <div className="detail-fields">
          <label>
            Name
            <input value={c.name || ""} maxLength={120} onChange={(e) => setC({ ...c, name: e.target.value })} autoCapitalize="words" />
          </label>
          <label>
            Address
            <input value={c.address || ""} maxLength={300} onChange={(e) => setC({ ...c, address: e.target.value })} />
          </label>
          <label>
            Notes (the AI sees these when drafting this customer's jobs)
            <textarea className="words-field" rows={3} maxLength={2000} value={c.notes || ""} onChange={(e) => setC({ ...c, notes: e.target.value })} />
          </label>
        </div>
        {c.contacts.map((x, i) => (
          <fieldset key={i} className="adm-contact detail-fields">
            <legend>Contact {i + 1}</legend>
            <label>
              Name
              <input value={x.name} maxLength={100} onChange={(e) => setContact(i, "name", e.target.value)} />
            </label>
            <div className="pc-field-row">
              <label>
                Phone
                <input value={x.phone} maxLength={40} inputMode="tel" onChange={(e) => setContact(i, "phone", e.target.value)} />
              </label>
              <label>
                Email
                <input value={x.email} maxLength={254} type="email" onChange={(e) => setContact(i, "email", e.target.value)} />
              </label>
            </div>
          </fieldset>
        ))}
        {c.contacts.length < 5 && (
          <button type="button" className="pc-add" onClick={() => setC({ ...c, contacts: [...c.contacts, { name: "", phone: "", email: "" }] })}>
            + Add a contact
          </button>
        )}
        <button type="submit" className="save-btn" disabled={busy || !c.name?.trim()}>
          Save Customer
        </button>
        {customer.id && (
          <button
            type="button"
            className="big-btn plain-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSave({ ...c, archived: !c.archived });
            }}
          >
            {c.archived ? "Restore Customer" : "Archive Customer"}
          </button>
        )}
        <button type="button" className="text-btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}

function CustomersTab({ customers, jobs, orgId, uid, onNotice }) {
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const shown = customers.filter((c) => showArchived || !c.archived).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <button className="pc-add pc-add-block" onClick={() => setEditing({ name: "", address: "", notes: "", contacts: [] })}>
        + Add a customer
      </button>
      {shown.length === 0 && <p className="empty">No customers yet.</p>}
      {shown.map((c) => (
        <button key={c.id} className={`job-card${c.archived ? " is-archived" : ""}`} onClick={() => setEditing(c)}>
          <strong>
            {c.name}
            {c.archived && <span className="pill is-lost">Archived</span>}
          </strong>
          {c.address && <span>{c.address}</span>}
          <span>
            {jobs.filter((j) => j.customerId === c.id).length} jobs
            {c.contacts?.[0] ? ` · ${c.contacts[0].name || c.contacts[0].phone || c.contacts[0].email}` : ""}
          </span>
        </button>
      ))}
      {customers.some((c) => c.archived) && (
        <button className="text-btn" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "Hide archived customers" : "Show archived customers"}
        </button>
      )}
      {editing && (
        <CustomerSheet
          customer={editing}
          onClose={() => setEditing(null)}
          onSave={async (c) => {
            try {
              await saveCustomer(orgId, uid, c);
              onNotice(c.archived && !editing.archived ? "Customer archived" : "Customer saved");
            } catch (err) {
              onNotice(errorText(err) || "Couldn't save the customer.");
            }
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

// ---------- Settings ----------

function SettingsTab({ org, onNotice }) {
  const d = org.defaults || {};
  const [f, setF] = useState({
    name: org.name || "",
    quotePrefix: d.quotePrefix ?? "Q-",
    markupPct: String(d.markupPct ?? 0),
    taxPct: String(d.taxPct ?? 0),
    laborRate: d.laborRate ? String(d.laborRate) : "",
    terms: d.terms || "",
    aiPriceEstimates: !!d.aiPriceEstimates,
    learnFromEdits: d.learnFromEdits !== false,
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form
      className="sheet-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const nums = { markupPct: Number(f.markupPct || 0), taxPct: Number(f.taxPct || 0), laborRate: f.laborRate === "" ? null : Number(f.laborRate) };
        if (!f.name.trim()) return setError("Add a company name.");
        if ([nums.markupPct, nums.taxPct].some((n) => !Number.isFinite(n) || n < 0) || nums.taxPct > 100 || (nums.laborRate !== null && (!Number.isFinite(nums.laborRate) || nums.laborRate < 0))) {
          return setError("Markup, tax, and labor rate need to be numbers (tax up to 100).");
        }
        setError("");
        try {
          await saveOrgSettings(org.id, f.name.trim().slice(0, 100), {
            quotePrefix: f.quotePrefix.trim().slice(0, 12),
            markupPct: nums.markupPct,
            taxPct: nums.taxPct,
            laborRate: nums.laborRate,
            terms: f.terms.trim().slice(0, 2000),
            aiPriceEstimates: f.aiPriceEstimates,
            learnFromEdits: f.learnFromEdits,
          });
          onNotice("Settings saved. New drafts use them.");
        } catch (err) {
          setError(errorText(err) || "Couldn't save the settings.");
        }
      }}
    >
      {error && <p className="error" role="alert">{error}</p>}
      <section className="pc-block detail-fields">
        <h3>Company</h3>
        <label>
          Company name
          <input value={f.name} maxLength={100} onChange={set("name")} />
        </label>
      </section>
      <section className="pc-block detail-fields">
        <h3>Quotes</h3>
        <div className="pc-field-row">
          <label>
            Quote number prefix
            <input value={f.quotePrefix} maxLength={12} onChange={set("quotePrefix")} autoCapitalize="characters" />
          </label>
          <label>
            Labor rate ($/hr)
            <input value={f.laborRate} inputMode="decimal" placeholder="Blank" maxLength={8} onChange={set("laborRate")} />
          </label>
        </div>
        <div className="pc-field-row">
          <label>
            Default markup %
            <input value={f.markupPct} inputMode="decimal" maxLength={6} onChange={set("markupPct")} />
          </label>
          <label>
            Default tax %
            <input value={f.taxPct} inputMode="decimal" maxLength={6} onChange={set("taxPct")} />
          </label>
        </div>
        <label>
          Default terms
          <textarea className="words-field" rows={3} maxLength={2000} value={f.terms} onChange={set("terms")} />
        </label>
        <p className="pc-hint">New drafts use these. The labor rate fills in labor lines measured in hours.</p>
      </section>
      <section className="pc-block">
        <h3>AI</h3>
        <label className="adm-toggle">
          <input type="checkbox" checked={f.aiPriceEstimates} onChange={set("aiPriceEstimates")} />
          <span>
            <strong>AI price estimates</strong>
            <br />
            When on, drafts fill in typical prices marked ESTIMATE. They must be checked before a quote goes out: finalizing warns about them, and the
            quote PDF says so.
          </span>
        </label>
        <label className="adm-toggle">
          <input type="checkbox" checked={f.learnFromEdits} onChange={set("learnFromEdits")} />
          <span>
            <strong>Learn from finalized quotes</strong>
            <br />
            New drafts reuse your company's wording, part numbers, and last prices from earlier finals. Only your company's quotes are used. Turn off
            to stop remembering and using them; the Data tab can clear what's remembered.
          </span>
        </label>
        <p className="pc-hint">Drafts use Claude. Each draft records the model and prompt version, so changes can be compared later.</p>
      </section>
      <button type="submit" className="save-btn">
        Save Settings
      </button>
    </form>
  );
}

// ---------- Activity (audit log) ----------

const ACTIONS = {
  "org.create": "started the company",
  "invite.create": "invited someone",
  "invite.update": "changed an invite",
  "invite.accept": "joined the team",
  "invite.revoke": "cancelled an invite",
  "member.update": "changed a team member",
  "job.share": "shared a job",
  "job.unshare": "stopped sharing a job",
  "job.assign": "assigned a job",
  "job.update": "updated a job",
  "piccolo.finalize": "finalized a job",
  "piccolo.export": "exported a job",
  "org.settings": "company settings changed",
  "account.mergeGuest": "added guest jobs to their account",
  "learning.clear": "cleared what drafts learned",
  "job.delete": "deleted a job",
};

function ActivityTab({ entries, team, jobs }) {
  const [person, setPerson] = useState("");
  const [jobId, setJobId] = useState("");
  const shown = entries.filter((e) => (!person || e.uid === person) && (!jobId || e.jobId === jobId));
  const jobName = (id) => {
    const j = jobs.find((x) => x.id === id);
    return j ? jobTitle(j) : null;
  };
  const detail = (e) => {
    if (e.action === "member.update" && e.after) return `${nameOf(team, e.target)} → ${roleLabel(e.after.role)}${e.after.status === "disabled" ? " (access off)" : ""}`;
    if (e.action === "invite.create" && e.after) return `${e.after.email} as ${roleLabel(e.after.role)}`;
    if (e.action === "piccolo.finalize" && e.after) return `v${e.after.version}`;
    if (e.action === "piccolo.export" && e.after) return `${e.after.what.toUpperCase()}, ${e.after.version}`;
    if (e.action === "job.update" && e.after) return salesLabel(e.after.salesStatus);
    return "";
  };
  return (
    <>
      <div className="detail-fields adm-filters">
        <label>
          Person
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {team.map((p) => (
              <option key={p.uid} value={p.uid}>
                {p.displayName || p.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Job
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">All jobs</option>
            {jobs.map((j) => (
              <option key={`${j.ownerUid}/${j.id}`} value={j.id}>
                {jobTitle(j)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 && <p className="empty">Nothing yet.</p>}
      <ul className="adm-log">
        {shown.map((e) => (
          <li key={e.id}>
            <span className="adm-when">{when(e.at)}</span>
            <span>
              {e.uid && <strong>{nameOf(team, e.uid)} </strong>}
              {ACTIONS[e.action] || e.action}
              {detail(e) ? `: ${detail(e)}` : ""}
              {e.jobId && jobName(e.jobId) ? ` · ${jobName(e.jobId)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- Data ----------

function LearningBlock({ org, onNotice }) {
  const [learning, setLearning] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => watchLearning(org.id, setLearning), [org.id]);
  const s = learning?.stats || {};
  const lines = learning?.lines || [];
  const pct = s.linesDrafted ? Math.round((100 * (s.linesKept || 0)) / s.linesDrafted) : null;
  const off = org.defaults?.learnFromEdits === false;
  return (
    <section className="pc-block">
      <h3>What drafts learn</h3>
      {off && <p className="pc-hint">Learning is off (Settings). Drafts don't use what's below.</p>}
      {s.finals ? (
        <>
          <p className="pc-text">
            {s.finals} final{s.finals === 1 ? "" : "s"} so far. {lines.length} remembered line{lines.length === 1 ? "" : "s"} (wording, part numbers, last
            prices) go into new drafts.
          </p>
          {pct !== null && (
            <p className="pc-text">
              Of {s.linesDrafted} AI-drafted lines, {pct}% were finalized unchanged, {s.linesChanged || 0} edited, and {s.linesRemoved || 0} removed.{" "}
              {s.linesAdded || 0} more {s.linesAdded === 1 ? "was" : "were"} added by hand.
            </p>
          )}
          {lines.length > 0 && (
            <ul className="adm-learned">
              {lines.slice(0, 8).map((l, i) => (
                <li key={i}>
                  {l.description}
                  {l.partNumber ? ` · ${l.partNumber}` : ""}
                </li>
              ))}
              {lines.length > 8 && <li className="pc-hint">and {lines.length - 8} more</li>}
            </ul>
          )}
          {confirm ? (
            <div className="sheet-actions">
              <button
                className="big-btn danger-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await clearLearning();
                    onNotice("Cleared. New drafts start fresh.");
                  } catch (err) {
                    onNotice(errorText(err) || "Couldn't clear it.");
                  } finally {
                    setBusy(false);
                    setConfirm(false);
                  }
                }}
              >
                {busy ? "Clearing…" : "Yes, Forget All of It"}
              </button>
              <button className="big-btn plain-btn" disabled={busy} onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="big-btn plain-btn" onClick={() => setConfirm(true)}>
              Forget Remembered Lines
            </button>
          )}
        </>
      ) : (
        <p className="pc-empty">Nothing yet. Each finalized quote teaches new drafts your wording, part numbers, and prices.</p>
      )}
    </section>
  );
}

function DataTab({ org, team, customers, jobs, onNotice }) {
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState("");
  const mb = (b) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
  const download = async (kind) => {
    setBusy(kind);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const safe = (org.name || "Company").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40);
      const file =
        kind === "json"
          ? new File([JSON.stringify(await exportAll(org, team, customers, jobs), null, 2)], `Piccolo_${safe}_All-Data_${day}.json`, { type: "application/json" })
          : new File([jobsCsv(jobs, customers, team)], `Piccolo_${safe}_Jobs_${day}.csv`, { type: "text/csv" });
      await deliverFile(file, file.name, null, { download: true });
      onNotice("Downloaded");
    } catch (err) {
      console.error("Export failed:", err);
      onNotice("Couldn't build the export. Please try again.");
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <div className="adm-stats">
        {[
          ["People", team.filter((p) => p.status === "active").length],
          ["Jobs", jobs.length],
          ["Customers", customers.filter((c) => !c.archived).length],
          ["Finalized", jobs.filter((j) => j.piccoloStatus === "finalized").length],
        ].map(([label, n]) => (
          <div key={label} className="adm-stat">
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="pc-block">
        <h3>Storage</h3>
        {usage ? (
          <p className="pc-text">
            {mb(usage.bytes)} for {usage.jobs} jobs: photos {mb(usage.photos)}, voice notes {mb(usage.audio)}, finals {mb(usage.finals)}.
          </p>
        ) : (
          <p className="pc-empty">Photos, voice notes, and finalized copies for the company's shared jobs.</p>
        )}
        <button
          className="big-btn plain-btn"
          disabled={busy === "usage"}
          onClick={async () => {
            setBusy("usage");
            try {
              setUsage(await orgStorageUsage());
            } catch (err) {
              onNotice(errorText(err) || "Couldn't check storage.");
            } finally {
              setBusy("");
            }
          }}
        >
          {busy === "usage" ? "Checking…" : "Check Storage Used"}
        </button>
      </section>
      <LearningBlock org={org} onNotice={onNotice} />
      <section className="pc-block">
        <h3>Export everything</h3>
        <p className="pc-empty">Company settings, team, customers, and every shared job with its Piccolo work order, parts, quote, and finals.</p>
        <button className="big-btn photo-btn" disabled={!!busy} onClick={() => download("json")}>
          {busy === "json" ? "Building…" : "All Data (JSON)"}
        </button>
        <button className="big-btn plain-btn" disabled={!!busy} onClick={() => download("csv")}>
          {busy === "csv" ? "Building…" : "Jobs List (CSV)"}
        </button>
      </section>
    </>
  );
}

/** The company admin's console. The rules and functions check the role too. */
export default function AdminConsole({ uid, profile, onBack, onOpenJob, onNotice }) {
  const orgId = profile.orgId;
  const [tab, setTab] = useState("people");
  const [org, setOrg] = useState(null);
  const [team, setTeam] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [activity, setActivity] = useState([]);
  useEffect(() => watchOrg(orgId, setOrg), [orgId]);
  useEffect(() => watchTeam(orgId, setTeam), [orgId]);
  useEffect(() => watchOrgJobs(orgId, setJobs), [orgId]);
  useEffect(() => watchCustomers(orgId, setCustomers), [orgId]);
  useEffect(() => watchActivity(orgId, setActivity), [orgId]);

  return (
    <>
      <button className="link-btn" onClick={onBack}>
        <BackIcon />
        Back
      </button>
      <h1 className="page-title">Admin</h1>
      {org?.name && <p className="subtitle">{org.name}</p>}
      <div className="pc-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "people" && <TeamScreen uid={uid} profile={profile} onNotice={onNotice} embedded />}
      {tab === "jobs" && <JobsTab jobs={jobs} customers={customers} team={team} orgId={orgId} onOpen={onOpenJob} onNotice={onNotice} />}
      {tab === "customers" && <CustomersTab customers={customers} jobs={jobs} orgId={orgId} uid={uid} onNotice={onNotice} />}
      {tab === "settings" && org && <SettingsTab key={org.updatedAt} org={org} onNotice={onNotice} />}
      {tab === "activity" && <ActivityTab entries={activity} team={team} jobs={jobs} />}
      {tab === "data" && org && <DataTab org={org} team={team} customers={customers} jobs={jobs} onNotice={onNotice} />}
    </>
  );
}
