import { useEffect, useState } from "react";

// Procore connection for the top-level tab ("Capture in a new tab"), never inside the iframe:
// Procore's login page can't load in one. Talks only to this site's /api/procore/* functions;
// the tokens stay in an httpOnly cookie the page can't read.
// After sign-in (?procore=...); a successful one shows as "Connected to Procore as ..." below
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

async function getJson(url) {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  const type = resp.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { status: 0, body: null }; // no /api here (e.g. the dev server)
  return { status: resp.status, body: await resp.json() };
}

export default function ProcorePanel({ companyId, projectId }) {
  const [state, setState] = useState({ step: "loading" }); // loading | signin | ready | unavailable | failed
  const [result] = useState(() => RESULT[new URLSearchParams(window.location.search).get("procore")] ?? "");

  useEffect(() => {
    let live = true;
    (async () => {
      const ids = new URLSearchParams();
      if (companyId) ids.set("companyId", companyId);
      // One after the other: a token refresh replaces the refresh token, so two at once could clash
      const me = await getJson(`/api/procore/me?${ids}`);
      if (!live) return;
      if (me.status === 0) return setState({ step: "unavailable" });
      if (me.status === 401) return setState({ step: "signin" });
      if (me.status !== 200) return setState({ step: "failed", message: me.body?.message });
      if (!companyId || !projectId) return setState({ step: "ready", me: me.body, people: null });
      ids.set("projectId", projectId);
      const dir = await getJson(`/api/procore/directory?${ids}`);
      if (!live) return;
      if (dir.status === 401) return setState({ step: "signin" });
      setState(dir.status === 200
        ? { step: "ready", me: me.body, people: dir.body.people, canTag: !!dir.body.canTag, labels: dir.body.labels ?? [] }
        : { step: "ready", me: me.body, people: null, message: dir.body?.message ?? "Couldn't load the project's people." });
    })().catch(() => live && setState({ step: "failed" }));
    return () => { live = false; };
  }, [companyId, projectId]);

  // A PM sets or clears a responsibility tag (server checks they're the project's PM)
  const [tagError, setTagError] = useState("");
  const setTag = async (userId, label) => {
    setTagError("");
    try {
      const resp = await fetch("/api/procore/responsibility", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ companyId, projectId, userId, label: label || null }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) return setTagError(body.message ?? "Couldn't save that tag.");
      setState((s) => ({
        ...s,
        people: s.people.map((p) => {
          if (p.id !== userId) return p;
          const fromTag = p.roleSource === "tag" || p.roleSource === null;
          return { ...p, tag: body.tag, ...(fromTag ? { role: body.tag, roleSource: body.tag ? "tag" : null } : {}) };
        }),
      }));
    } catch {
      setTagError("Couldn't reach SiteSnap. Check your signal and try again.");
    }
  };

  const connect = () => {
    const ids = new URLSearchParams();
    if (companyId) ids.set("companyId", companyId);
    if (projectId) ids.set("projectId", projectId);
    window.location.assign(`/api/procore/login?${ids}`); // this tab is top-level, so a plain redirect works
  };

  return (
    <section className="procore-panel" aria-label="Procore">
      {result && state.step !== "signin" && <p className="procore-note">{result}</p>}
      {state.step === "loading" && <p className="procore-note">Checking Procore…</p>}
      {state.step === "unavailable" && <p className="procore-note">Procore sign-in isn't available on this site.</p>}
      {state.step === "failed" && <p className="procore-note">{state.message ?? "Couldn't reach Procore. Try again later."}</p>}
      {state.step === "signin" && (
        <>
          {result && <p className="procore-note">{result}</p>}
          <button className="procore-btn" onClick={connect}>Connect Procore</button>
        </>
      )}
      {state.step === "ready" && (
        <>
          <p className="procore-note procore-connected">
            Connected to Procore as {state.me.name ?? state.me.email ?? "you"}
          </p>
          {!projectId && <p className="procore-note">No Procore project in this link, so there's no people list.</p>}
          {state.message && <p className="procore-note">{state.message}</p>}
          {state.people && (
            <>
              <h2>Project people ({state.people.length})</h2>
              {state.canTag && <p className="procore-note">You're this project's PM: tag people Procore has no role for.</p>}
              {tagError && <p className="procore-note procore-error" role="alert">{tagError}</p>}
              {state.people.length === 0 ? (
                <p className="procore-note">No one is on this project's directory yet.</p>
              ) : (
                <ul className="procore-people">
                  {state.people.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name ?? "Unnamed"}</strong>
                      <span>
                        {p.company ?? "Company not set in Procore"} · {p.role ?? "Role not set in Procore"}
                      </span>
                      {p.roleSource && <small className="procore-source">{SOURCE[p.roleSource]}</small>}
                      {state.canTag && (p.roleSource === null || p.roleSource === "tag") && (
                        <label className="procore-tag">
                          Responsibility
                          <select value={p.tag ?? ""} onChange={(e) => setTag(p.id, e.target.value)}>
                            <option value="">Not tagged</option>
                            {state.labels.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
