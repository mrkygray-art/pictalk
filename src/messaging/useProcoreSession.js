import { useCallback, useEffect, useRef, useState } from "react";
import { onIdTokenChanged, signInWithCustomToken, signOut as fbSignOut } from "firebase/auth";
import { auth } from "../firebase";
import {
  clearMe, pickProject, readCache, readLastProject, readMe, readProjectsCache, STALE_MS, writeCache, writeLastProject, writeMe, writeProjectsCache,
} from "../directorySearch";

// Everyone signs in with Procore. The Procore tokens stay in an httpOnly cookie on our server;
// POST /api/procore/session answers with a Firebase sign-in for this Procore user (claim procoreUserId)
// and records their project memberships, which the Firestore rules check.
// Offline, a phone that signed in before keeps its Firebase sign-in and its saved projects and directory.

async function api(url, init) {
  const resp = await fetch(url, { headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const type = resp.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { status: 0, body: null }; // no /api here (the dev server)
  return { status: resp.status, body: await resp.json() };
}

export function useProcoreSession({ linkCompanyId, linkProjectId } = {}) {
  const [state, setState] = useState({ step: "loading" }); // loading | signin | ready | failed | unavailable
  const [me, setMe] = useState(readMe);
  const [projects, setProjects] = useState(() => readProjectsCache() ?? []);
  const [project, setProject] = useState(null);
  const [dir, setDir] = useState(null);
  const [dirError, setDirError] = useState("");
  const [loadingDir, setLoadingDir] = useState(false);
  const [fbUser, setFbUser] = useState(undefined); // undefined = not known yet
  const chain = useRef(Promise.resolve()); // Procore calls one after another (refresh tokens rotate)
  const queue = (fn) => (chain.current = chain.current.then(fn, fn));
  const current = useRef(null);

  useEffect(() => onIdTokenChanged(auth, (u) => setFbUser(u ?? null)), []);

  const loadDirectory = useCallback((p) => {
    setLoadingDir(true);
    return queue(async () => {
      let r = null;
      try { r = await api(`/api/procore/directory?${new URLSearchParams({ companyId: p.companyId, projectId: p.projectId })}`); } catch { /* no signal */ }
      setLoadingDir(false);
      if (!r) return setDirError(readCache(p.companyId, p.projectId) ? "" : "No signal, and this project's people aren't saved on this phone yet.");
      if (r.status === 401) return setState({ step: "signin" });
      if (r.status !== 200) return setDirError(r.body?.message ?? "Couldn't load the project's people.");
      const fresh = {
        people: r.body.people ?? [], at: Date.now(), canTag: !!r.body.canTag, labels: r.body.labels ?? [],
        compact: !!r.body.compact, rolesAvailable: r.body.rolesAvailable !== false,
      };
      writeCache(p.companyId, p.projectId, fresh);
      if (current.current?.projectId === p.projectId && current.current?.companyId === p.companyId) setDir(fresh);
      setDirError("");
    });
  }, []);

  const choose = useCallback((p) => {
    if (!p) return;
    current.current = p;
    setProject(p);
    writeLastProject(p);
    setDirError("");
    setDir(readCache(p.companyId, p.projectId));
    loadDirectory(p);
  }, [loadDirectory]);

  // Sign in (or refresh who I am and which projects I'm on)
  useEffect(() => {
    let live = true;
    queue(async () => {
      let r = null;
      try { r = await api("/api/procore/session", { method: "POST", body: "{}" }); } catch { /* no signal */ }
      if (!live) return;
      const last = readLastProject();
      if (!r) {
        // Offline: carry on if this phone signed in before
        const cached = readProjectsCache();
        if (auth.currentUser && readMe() && cached) {
          setState({ step: "ready", offline: true });
          choose(pickProject(cached, { companyId: linkCompanyId, projectId: linkProjectId }, last));
        } else setState({ step: "failed", message: "No signal. Connect once to sign in with Procore." });
        return;
      }
      if (r.status === 0) return setState({ step: "unavailable" });
      if (r.status === 401) return setState({ step: "signin" });
      if (r.status !== 200) return setState({ step: "failed", message: r.body?.message ?? "Couldn't reach Procore. Try again." });
      try {
        await signInWithCustomToken(auth, r.body.token);
      } catch {
        return setState({ step: "failed", message: "Couldn't sign in to SiteSnap. Try again." });
      }
      if (!live) return;
      writeMe(r.body.me);
      setMe(r.body.me);
      writeProjectsCache(r.body.projects);
      setProjects(r.body.projects);
      setState({ step: "ready" });
      choose(pickProject(r.body.projects, { companyId: linkCompanyId, projectId: linkProjectId }, last));
    });
    return () => { live = false; };
  }, [linkCompanyId, linkProjectId, choose]);

  // Refresh the directory in the background when the saved copy is over an hour old
  useEffect(() => {
    if (!project) return;
    const t = setInterval(() => {
      const c = readCache(project.companyId, project.projectId);
      if (!c || Date.now() - c.at > STALE_MS) loadDirectory(project);
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [project, loadDirectory]);

  const connect = (fresh = false) => {
    const ids = new URLSearchParams();
    if (fresh === true) ids.set("fresh", "1");
    const c = project?.companyId || linkCompanyId;
    const p = project?.projectId || linkProjectId;
    if (c) ids.set("companyId", c);
    if (p) ids.set("projectId", p);
    window.location.assign(`/api/procore/login?${ids}`);
  };

  const signOut = async () => {
    // Forget the Procore connection on the server too, so a reload doesn't sign straight back in
    await fetch("/api/procore/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    await fbSignOut(auth).catch(() => {});
    clearMe();
    setMe(null);
    setState({ step: "signin" });
  };

  const signedIn = state.step === "ready" && !!fbUser && !!me;
  return { state, me, projects, project, choose, dir, dirError, loadingDir, refreshDirectory: () => project && loadDirectory(project), connect, signOut, signedIn };
}
