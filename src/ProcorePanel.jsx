import { useEffect, useMemo, useRef, useState } from "react";
import {
  FILTERS, groupByCompany, pickProject, readCache, readLastProject, readProjectsCache, recipientOf, searchPeople,
  STALE_MS, updatedLabel, writeCache, writeLastProject, writeProjectsCache,
} from "./directorySearch";

// Procore for the top-level tab ("Capture in a new tab"), never inside the iframe: Procore's login
// page can't load in one. Sign in, pick one of your Procore projects, then find who a photo or
// question is for by name, title or company (Who do I message?). Talks only to this site's
// /api/procore/* functions; the tokens stay in an httpOnly cookie the page can't read.
// Typing and tapping only: no microphone, so it works the same wherever it ends up.
const RESULT = {
  denied: "Procore sign-in was cancelled.",
  error: "Procore sign-in didn't work. Try again.",
};

// Where a person's role came from (api/_responsibilities.js), shown small under the name
const SOURCE = {
  project_team: "Procore project team",
  job_title: "Procore title",
  permission_template: "Procore permissions",
  tag: "Tagged in SiteSnap",
};

const PLACEHOLDER = { name: "Search by name", title: "Search by title, like foreman", company: "Search by company", all: "Search name, title or company" };
const SHOW_MAX = 60; // results shown at once; typing narrows the rest

async function getJson(url) {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  const type = resp.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { status: 0, body: null }; // no /api here (e.g. the dev server)
  return { status: resp.status, body: await resp.json() };
}


export default function ProcorePanel({ companyId: linkCompanyId, projectId: linkProjectId, recipients = [], onRecipients }) {
  const [state, setState] = useState({ step: "loading" }); // loading | hidden | signin | ready | failed
  const [result] = useState(() => RESULT[new URLSearchParams(window.location.search).get("procore")] ?? "");
  const [project, setProject] = useState(null); // { companyId, companyName, projectId, name }
  const [choosing, setChoosing] = useState(false);
  const [dir, setDir] = useState(null); // { people, at, canTag, labels, compact, rolesAvailable }
  const [dirError, setDirError] = useState("");
  const [loadingDir, setLoadingDir] = useState(false);
  const [filter, setFilter] = useState("name");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true); // the search card; Done folds it to the "To:" line
  const searchRef = useRef(null);
  // Procore calls one after another: a token refresh replaces the refresh token, so two at once could clash
  const chain = useRef(Promise.resolve());
  const queue = (fn) => (chain.current = chain.current.then(fn, fn));

  // The open project, for answers that arrive after the user switched to another one
  const current = useRef(null);
  // Open a project: the saved directory at once, then a fresh copy from Procore
  function choose(p, projects) {
    setChoosing(!p && (projects?.length ?? 0) > 1);
    if (!p) return;
    current.current = p;
    setProject(p);
    writeLastProject(p);
    setQuery("");
    setDirError("");
    setOpen(true);
    const cached = readCache(p.companyId, p.projectId);
    setDir(cached);
    loadDirectory(p);
  }

  function loadDirectory(p) {
    setLoadingDir(true);
    return queue(async () => {
      const q = new URLSearchParams({ companyId: p.companyId, projectId: p.projectId });
      let r;
      try {
        r = await getJson(`/api/procore/directory?${q}`);
      } catch {
        r = null; // no signal: keep the saved copy
      }
      setLoadingDir(false);
      if (!r) return setDirError(readCache(p.companyId, p.projectId) ? "" : "No signal, and this project's people aren't saved on this phone yet.");
      if (r.status === 401) return setState((s) => ({ ...s, step: "signin" })); // the chosen project is remembered
      if (r.status !== 200) return setDirError(r.body?.message ?? "Couldn't load the project's people.");
      const fresh = {
        people: r.body.people ?? [], at: Date.now(), canTag: !!r.body.canTag, labels: r.body.labels ?? [],
        compact: !!r.body.compact, rolesAvailable: r.body.rolesAvailable !== false,
      };
      writeCache(p.companyId, p.projectId, fresh);
      setDir((d) => (sameProject(p) ? fresh : d));
      setDirError("");
    });
  }
  const sameProject = (p) => current.current && current.current.projectId === p.projectId && current.current.companyId === p.companyId;


  // Signed in? Then which projects?
  useEffect(() => {
    let live = true;
    queue(async () => {
      const last = readLastProject();
      const ids = new URLSearchParams();
      const meCompany = linkCompanyId || last?.companyId;
      if (meCompany) ids.set("companyId", meCompany);
      let me;
      try {
        me = await getJson(`/api/procore/me?${ids}`);
      } catch {
        // No signal: carry on with what this phone remembers
        const cached = readProjectsCache();
        if (!live) return;
        if (!cached) return setState({ step: "failed", message: "No signal, and no Procore projects saved on this phone yet." });
        setState({ step: "ready", me: null, projects: cached, offline: true });
        return choose(pickProject(cached, { companyId: linkCompanyId, projectId: linkProjectId }, last), cached);
      }
      if (!live) return;
      if (me.status === 0) return setState({ step: "hidden" });
      if (me.status === 401) return setState({ step: "signin" });
      if (me.status !== 200) return setState({ step: "failed", message: me.body?.message });
      const list = await getJson("/api/procore/projects").catch(() => null);
      if (!live) return;
      if (list?.status === 401) return setState({ step: "signin" });
      const projects = list?.status === 200 ? list.body.projects : readProjectsCache();
      if (list?.status === 200) writeProjectsCache(projects);
      if (!projects) return setState({ step: "ready", me: me.body, projects: [], message: list?.body?.message ?? "Couldn't load your Procore projects." });
      setState({ step: "ready", me: me.body, projects, offline: list?.status !== 200 });
      choose(pickProject(projects, { companyId: linkCompanyId, projectId: linkProjectId }, last), projects);
    }).catch(() => live && setState({ step: "failed" }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCompanyId, linkProjectId]);

  // Refresh in the background when the saved copy is over an hour old (checked every few minutes)
  useEffect(() => {
    if (!project) return;
    const t = setInterval(() => {
      const c = readCache(project.companyId, project.projectId);
      if (!c || Date.now() - c.at > STALE_MS) loadDirectory(project);
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // The search box is ready to type in once a project is open
  useEffect(() => {
    if (project && open && !choosing && dir) searchRef.current?.focus({ preventScroll: true });
  }, [project, open, choosing, dir]);

  const results = useMemo(() => searchPeople(dir?.people ?? [], query, filter), [dir, query, filter]);
  const shown = results.slice(0, SHOW_MAX);
  const picked = new Set(recipients.map((r) => r.procoreUserId));
  const toggle = (p) => {
    const id = String(p.id);
    onRecipients?.(picked.has(id) ? recipients.filter((r) => r.procoreUserId !== id) : [...recipients, recipientOf(p)].slice(0, 10));
  };

  // A PM sets or clears a responsibility tag (server checks they're the project's PM)
  const [tagError, setTagError] = useState("");
  const setTag = async (userId, label) => {
    setTagError("");
    try {
      const resp = await fetch("/api/procore/responsibility", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ companyId: project.companyId, projectId: project.projectId, userId, label: label || null }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) return setTagError(body.message ?? "Couldn't save that tag.");
      setDir((d) => {
        const next = {
          ...d,
          people: d.people.map((p) => {
            if (p.id !== userId) return p;
            const fromTag = p.roleSource === "tag" || p.roleSource === null;
            return { ...p, tag: body.tag, ...(fromTag ? { role: body.tag, roleSource: body.tag ? "tag" : null } : {}) };
          }),
        };
        writeCache(project.companyId, project.projectId, next);
        return next;
      });
    } catch {
      setTagError("Couldn't reach SiteSnap. Check your signal and try again.");
    }
  };

  const connect = () => {
    const ids = new URLSearchParams();
    const c = project?.companyId || linkCompanyId;
    const p = project?.projectId || linkProjectId;
    if (c) ids.set("companyId", c);
    if (p) ids.set("projectId", p);
    window.location.assign(`/api/procore/login?${ids}`); // this tab is top-level, so a plain redirect works
  };

  if (state.step === "hidden") return null;

  const person = (p) => {
    const on = picked.has(String(p.id));
    const sub = [p.title || p.role, filter === "company" ? null : p.company].filter(Boolean).join(" · ");
    return (
      <li key={p.id}>
        <button type="button" className={`dir-person${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(p)}>
          <span className="dir-check" aria-hidden="true">{on ? "✓" : ""}</span>
          <span className="dir-who">
            <strong>{p.name ?? "Unnamed"}</strong>
            {sub && <span>{sub}</span>}
            {p.roleSource && p.roleSource !== "job_title" && <small>{SOURCE[p.roleSource]}</small>}
          </span>
        </button>
        {dir?.canTag && (p.roleSource === null || p.roleSource === "tag") && (
          <label className="procore-tag">
            Responsibility
            <select value={p.tag ?? ""} onChange={(e) => setTag(p.id, e.target.value)}>
              <option value="">Not tagged</option>
              {dir.labels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
      </li>
    );
  };

  const projects = state.projects ?? [];
  const multiCompany = new Set(projects.map((p) => p.companyId)).size > 1;

  return (
    <section className="procore-panel" aria-label="Procore">
      {result && state.step !== "signin" && <p className="procore-note">{result}</p>}
      {state.step === "loading" && <p className="procore-note">Checking Procore…</p>}
      {state.step === "failed" && <p className="procore-note">{state.message ?? "Couldn't reach Procore. Try again later."}</p>}
      {state.step === "signin" && (
        <>
          {result && <p className="procore-note">{result}</p>}
          <p className="procore-note">Sign in with Procore to find people on your projects.</p>
          <button className="procore-btn" onClick={connect}>Connect Procore</button>
        </>
      )}
      {state.step === "ready" && (
        <>
          <p className="procore-note procore-connected">
            {state.me ? `Connected to Procore as ${state.me.name ?? state.me.email ?? "you"}` : "Offline: using what this phone saved"}
          </p>
          {state.message && <p className="procore-note">{state.message}</p>}
          {projects.length === 0 && !state.message && (
            <p className="procore-note">You're not on any Procore projects yet. Ask your project manager to add you in Procore.</p>
          )}

          {project && !choosing && (
            <div className="dir-project">
              <div>
                <small>Procore project</small>
                <strong>{project.name}</strong>
              </div>
              {projects.length > 1 && (
                <button type="button" className="stop-more" onClick={() => setChoosing(true)}>Switch Project</button>
              )}
            </div>
          )}

          {choosing && (
            <div className="dir-projects">
              <h2>Pick a project</h2>
              <ul>
                {projects.map((p) => (
                  <li key={`${p.companyId}_${p.projectId}`}>
                    <button type="button" className={`dir-project-btn${project?.projectId === p.projectId && project?.companyId === p.companyId ? " is-on" : ""}`} onClick={() => choose(p, projects)}>
                      <strong>{p.name}</strong>
                      {multiCompany && p.companyName && <span>{p.companyName}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {project && <button type="button" className="text-btn" onClick={() => setChoosing(false)}>Keep {project.name}</button>}
            </div>
          )}

          {project && !choosing && !open && (
            <div className="dir-to">
              <p>{recipients.length ? <>To: <strong>{recipients.map((r) => r.name).join(", ")}</strong></> : "Not sent to anyone yet"}</p>
              <button type="button" className="stop-more" onClick={() => setOpen(true)}>{recipients.length ? "Change" : "Find Someone"}</button>
            </div>
          )}

          {project && !choosing && open && (
            <div className="dir-search">
              <h2>Who is this for?</h2>
              <input
                ref={searchRef}
                type="search"
                className="dir-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={PLACEHOLDER[filter]}
                aria-label={PLACEHOLDER[filter]}
                autoComplete="off"
                enterKeyHint="search"
              />
              <div className="dir-filters" role="group" aria-label="Search by">
                {FILTERS.map(([id, label]) => (
                  <button key={id} type="button" className={filter === id ? "is-on" : ""} aria-pressed={filter === id} onClick={() => { setFilter(id); searchRef.current?.focus({ preventScroll: true }); }}>
                    {label}
                  </button>
                ))}
              </div>

              <p className="dir-meta">
                {dir ? `${results.length} ${results.length === 1 ? "person" : "people"}` : loadingDir ? "Loading people…" : ""}
                {dir && ` · Updated ${updatedLabel(dir.at)}`}
                {loadingDir && dir && " · Refreshing…"}
              </p>
              <button type="button" className="text-btn dir-refresh" onClick={() => loadDirectory(project)} disabled={loadingDir}>Refresh Directory</button>
              {dirError && <p className="procore-note procore-error" role="alert">{dirError}</p>}
              {dir?.compact && <p className="procore-note">Procore only shows you names and companies on this project, so Title search may find no one.</p>}
              {tagError && <p className="procore-note procore-error" role="alert">{tagError}</p>}
              {dir?.canTag && <p className="procore-note">You're this project's PM: tag people Procore has no role for.</p>}

              {dir && dir.people.length === 0 && <p className="procore-note">No one is on this project's directory yet.</p>}
              {dir && dir.people.length > 0 && results.length === 0 && (
                <p className="procore-note">No matches in {project.name}. Try another filter.</p>
              )}
              {dir && results.length > 0 && (filter === "company" ? (
                <div className="dir-groups">
                  {groupByCompany(shown).map((g) => (
                    <div key={g.company ?? "none"}>
                      <h3>{g.company ?? "No company in Procore"}</h3>
                      <ul className="dir-list">{g.people.map(person)}</ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="dir-list">{shown.map(person)}</ul>
              ))}
              {results.length > SHOW_MAX && <p className="procore-note">Showing {SHOW_MAX} of {results.length}. Keep typing to narrow it down.</p>}

              {recipients.length > 0 && (
                <div className="dir-picked" aria-label="Sending to">
                  {recipients.map((r) => (
                    <button key={r.procoreUserId} type="button" className="place-chip is-on" onClick={() => onRecipients?.(recipients.filter((x) => x.procoreUserId !== r.procoreUserId))} aria-label={`Remove ${r.name}`}>
                      {r.name} ×
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="save-btn dir-done" onClick={() => setOpen(false)}>
                {recipients.length ? `Done · ${recipients.length} selected` : "Done"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
