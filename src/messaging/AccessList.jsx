import { useEffect, useState } from "react";
import { projectAccess, RECORD_LABEL } from "./recordStore";

// Who can't get Punch Items or Observations on this project, and why (their Procore permission template).
// Read only: changing someone's template is done in Procore (Directory, then Edit, then Permission Template).
export default function AccessList({ session, onBack }) {
  const { project, dir } = session;
  const [access, setAccess] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { projectAccess(project).then(setAccess).catch((e) => setError(e.message)); }, [project]);

  const people = dir?.people ?? [];
  const problems = (p) => {
    const a = access?.people?.[String(p.id)];
    if (!a) return [];
    if (!a.template) return ["No permission template in Procore, so they can't be assigned anything."];
    return ["punch_item", "observation"].filter((t) => a[t]?.ok === false).map((t) => `Can't get ${RECORD_LABEL[t]}s: ${a[t].why}.`);
  };
  const missing = people.map((p) => ({ p, list: problems(p) })).filter((x) => x.list.length);
  const byCompany = Object.entries(missing.reduce((g, x) => ((g[x.p.company || "No company"] ??= []).push(x), g), {})).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className="access-list">
      <h2 className="page-title">Who can't get records</h2>
      <p className="procore-note">People on {project.name} that Procore won't accept as the assignee of a Punch Item or an Observation, because of their permission template. Fix it in Procore: Directory, then the person, then Edit, then Permission Template.</p>
      {error && <p className="msg-status">{error}</p>}
      {!access && !error && <p className="msg-status">Checking Procore…</p>}
      {access && !access.levelsKnown && <p className="procore-note">Punch List access isn't known yet. Procore only shows it to admins, so it fills in the next time a Procore admin opens Report an Issue or this list.</p>}
      {access && (missing.length === 0
        ? <p className="msg-status">Everyone on the project can get Punch Items and Observations{access.levelsKnown ? "" : " (as far as SiteSnap can tell)"}.</p>
        : byCompany.map(([company, list]) => (
          <div key={company} className="access-group">
            <h3>{company}</h3>
            <ul>
              {list.map(({ p, list: why }) => (
                <li key={p.id}><strong>{p.name}</strong>{access.people[String(p.id)]?.template && <small>{access.people[String(p.id)].template}</small>}
                  {why.map((w) => <span key={w}>{w}</span>)}
                </li>
              ))}
            </ul>
          </div>
        )))}
      {access?.levelsAt && <p className="msg-footnote">Template access last read from Procore {new Date(access.levelsAt).toLocaleString()}.</p>}
      <button type="button" className="text-btn" onClick={onBack}>Back to Messages</button>
    </section>
  );
}
