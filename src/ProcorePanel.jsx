import { useEffect, useState } from "react";

// Procore connection for the top-level tab ("Capture in a new tab"), never inside the iframe:
// Procore's login page can't load in one. Talks only to this site's /api/procore/* functions;
// the tokens stay in an httpOnly cookie the page can't read.
const RESULT = {
  connected: "Connected to Procore.",
  denied: "Procore sign-in was cancelled.",
  error: "Procore sign-in didn't work. Try again.",
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
        ? { step: "ready", me: me.body, people: dir.body.people }
        : { step: "ready", me: me.body, people: null, message: dir.body?.message ?? "Couldn't load the project's people." });
    })().catch(() => live && setState({ step: "failed" }));
    return () => { live = false; };
  }, [companyId, projectId]);

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
          <p className="procore-note">
            Procore: {state.me.name ?? "signed in"}{state.me.email ? ` · ${state.me.email}` : ""}
          </p>
          {!projectId && <p className="procore-note">No Procore project in this link, so there's no people list.</p>}
          {state.message && <p className="procore-note">{state.message}</p>}
          {state.people && (
            <>
              <h2>Project people ({state.people.length})</h2>
              {state.people.length === 0 ? (
                <p className="procore-note">No one is on this project's directory yet.</p>
              ) : (
                <ul className="procore-people">
                  {state.people.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name ?? "Unnamed"}</strong>
                      <span>{[p.company, p.role].filter(Boolean).join(" · ") || "—"}</span>
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
