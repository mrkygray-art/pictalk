import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon, CameraIcon } from "./icons";
import { groupPhotos, hasArea, hasTrade, loadAlbums, loadPhotos, timeLine } from "./photosStore";
import { discardPhoto, lastSavedPhoto, onPhotoQueueChange, pendingPhotos, retryPhoto } from "./photoQueue";
import SnapFlow from "./SnapFlow";

// Project photos (docs/sitesnap-project-home-and-photos-spec.md, section 2): Procore's Photos tool, read-only.
// By day (default) / By area / By trade group the project's photos, newest first; Albums lists Procore's albums.
// Snap (camera straight away) saves into that day's "Field photos" album through the upload queue (photoQueue.js).

// A list of photos that loads more as you scroll (a button too, for when scrolling can't tell)
const FIRST = { photos: [], nextPage: 1, timeZone: null, loading: false, error: "" };
function usePhotoPages(project, albumId) {
  const [state, setState] = useState(FIRST);
  const busy = useRef(false);
  const more = useCallback(async () => {
    if (busy.current || !state.nextPage) return;
    busy.current = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const b = await loadPhotos(project, { albumId, page: state.nextPage });
      setState((s) => ({ photos: [...s.photos, ...b.photos.filter((p) => !s.photos.some((x) => x.id === p.id))], nextPage: b.nextPage, timeZone: s.timeZone ?? b.timeZone, loading: false, error: "" }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    } finally {
      busy.current = false;
    }
  }, [project, albumId, state.nextPage]);
  const reload = useCallback(() => setState((s) => ({ ...FIRST, timeZone: s.timeZone })), []);
  return [state, more, reload];
}

// Photos still on this phone: "2 waiting to upload", and any Procore refused, with Retry / Remove
function Waiting({ projectKey }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    let live = true;
    const load = () => pendingPhotos(projectKey).then((l) => live && setList(l)).catch(() => {});
    load();
    const off = onPhotoQueueChange(load);
    return () => { live = false; off(); };
  }, [projectKey]);
  const waiting = list.filter((p) => p.status !== "failed");
  const failed = list.filter((p) => p.status === "failed");
  if (!list.length) return null;
  return (
    <div className="ph-waiting" role="status">
      {waiting.length > 0 && <p><strong>{waiting.length} waiting to upload</strong>{navigator.onLine ? "" : " · no signal"}</p>}
      {failed.map((p) => (
        <div key={p.captureId} className="ph-failed">
          <p>{p.error}</p>
          <button type="button" className="stop-more" onClick={() => retryPhoto(p.captureId)}>Retry</button>
          <button type="button" className="text-btn inline is-danger" onClick={() => { if (window.confirm("Remove this photo? It isn't in Procore, and it can't be brought back.")) discardPhoto(p.captureId); }}>Remove</button>
        </div>
      ))}
    </div>
  );
}

function MoreOnScroll({ state, onMore }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !state.nextPage || state.error || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), { rootMargin: "400px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [state.nextPage, state.error, onMore]);
  if (state.error) return <div className="ph-more"><p className="procore-note">{state.error}</p><button type="button" className="stop-more" onClick={onMore}>Try Again</button></div>;
  if (!state.nextPage) return null;
  return <div className="ph-more" ref={ref}>{state.loading ? <p className="ph-muted">Loading photos…</p> : <button type="button" className="stop-more" onClick={onMore}>Load More</button>}</div>;
}

function Grid({ photos, onOpen }) {
  return (
    <ul className="ph-grid">
      {photos.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onOpen(p)} aria-label={p.description ? p.description.slice(0, 80) : "Open photo"}>
            <img src={p.thumb} alt="" loading="lazy" decoding="async" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function FullPhoto({ photo, timeZone, onClose }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const where = [photo.location?.name, photo.trades.map((t) => t.name).join(", ")].filter(Boolean).join(" · ");
  return (
    <div className="ph-full" role="dialog" aria-modal="true" aria-label="Photo">
      <button type="button" className="link-btn ph-full-back" onClick={onClose}><BackIcon /> Photos</button>
      <img src={failed ? photo.thumb : photo.full} alt={photo.description || "Project photo"} onError={() => setFailed(true)} />
      {failed && <p className="procore-note">Showing a smaller copy. The full photo couldn't load here; it's in Procore.</p>}
      <div className="ph-full-info">
        <p className="ph-full-who"><strong>{photo.by || "Someone"}</strong> · {timeLine(photo.createdAt, timeZone)}</p>
        <p className="ph-muted">{photo.albumName ? `Album: ${photo.albumName}` : ""}{photo.albumPrivate ? " (private)" : ""}</p>
        {where && <p className="ph-muted">{where}</p>}
        {photo.description && <p className="msg-words">{photo.description}</p>}
      </div>
    </div>
  );
}

function Groups({ state, by, onOpen, onMore }) {
  if (!state.photos.length) {
    if (state.error) return <MoreOnScroll state={state} onMore={onMore} />;
    if (state.loading || state.nextPage === 1) return <p className="ph-muted">Loading photos…</p>;
    return <p className="empty">No photos on this project yet.</p>;
  }
  return (
    <>
      {groupPhotos(state.photos, by, state.timeZone).map((g) => (
        <section key={g.key} className="ph-group">
          <h3>{g.label} <small>{g.photos.length} photo{g.photos.length === 1 ? "" : "s"}{state.nextPage ? " so far" : ""}</small></h3>
          <Grid photos={g.photos} onOpen={onOpen} />
        </section>
      ))}
      <MoreOnScroll state={state} onMore={onMore} />
    </>
  );
}

function AlbumList({ project, onOpenAlbum }) {
  const [albums, setAlbums] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    loadAlbums(project).then((a) => live && setAlbums(a)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [project, attempt]);
  if (error) return <div className="ph-more"><p className="procore-note">{error}</p><button type="button" className="stop-more" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Try Again</button></div>;
  if (!albums) return <p className="ph-muted">Loading albums…</p>;
  if (!albums.length) return <p className="empty">No albums on this project yet.</p>;
  return (
    <ul className="ph-albums">
      {albums.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => onOpenAlbum(a)}>
            {a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="ph-cover-empty" aria-hidden="true" />}
            <span className="ph-album-text">
              <strong>{a.name}{a.private ? " (private)" : ""}</strong>
              <small>{a.count} photo{a.count === 1 ? "" : "s"}{a.updatedAt ? ` · updated ${timeLine(a.updatedAt)}` : ""}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AlbumView({ project, album, onBack, onOpen }) {
  const [state, more] = usePhotoPages(project, album.id);
  useEffect(() => { if (state.nextPage === 1 && !state.loading && !state.error) more(); }, [state.nextPage, state.loading, state.error, more]);
  return (
    <>
      <div className="ph-head">
        <button type="button" className="link-btn" onClick={onBack}><BackIcon /> Albums</button>
      </div>
      <h2 className="page-title">{album.name}</h2>
      {state.photos.length ? <Grid photos={state.photos} onOpen={(p) => onOpen(p, state.timeZone)} /> : state.error ? null : state.loading || state.nextPage === 1 ? <p className="ph-muted">Loading photos…</p> : <p className="empty">No photos in this album yet.</p>}
      <MoreOnScroll state={state} onMore={more} />
    </>
  );
}

export default function PhotosView({ session, onBack }) {
  const { project } = session;
  const projectKey = `${project.companyId}_${project.projectId}`;
  const [tab, setTab] = useState("day"); // day | area | trade | albums
  const [album, setAlbum] = useState(null);
  const [open, setOpen] = useState(null); // { photo, timeZone }
  const [snap, setSnap] = useState(null); // { photo: File, n } while saving one
  const [albumsVersion, setAlbumsVersion] = useState(0);
  const camera = useRef(null);
  const [state, more, reload] = usePhotoPages(project, null);
  useEffect(() => { if (state.nextPage === 1 && !state.loading && !state.error) more(); }, [state.nextPage, state.loading, state.error, more]);
  // A photo reached Procore: show it
  const seen = useRef(lastSavedPhoto()?.at ?? 0);
  useEffect(() => onPhotoQueueChange(() => {
    const at = lastSavedPhoto()?.at ?? 0;
    if (at > seen.current) { seen.current = at; reload(); setAlbumsVersion((v) => v + 1); }
  }), [reload]);

  const openCamera = () => camera.current?.click();
  const cameraInput = (
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setSnap((s) => ({ photo: f, n: (s?.n ?? 0) + 1 })); }} />
  );
  if (snap) {
    return (
      <div className="ph">
        {cameraInput}
        <SnapFlow key={snap.n} session={session} photo={snap.photo} timeZone={state.timeZone} onSnapAnother={openCamera} onDone={() => setSnap(null)} />
      </div>
    );
  }

  // By area / By trade only once a photo carries one (spec 2.1: hide rather than fake)
  const tabs = [["day", "By day"], ...(hasArea(state.photos) ? [["area", "By area"]] : []), ...(hasTrade(state.photos) ? [["trade", "By trade"]] : []), ["albums", "Albums"]];
  const shown = tabs.some(([k]) => k === tab) ? tab : "day";

  return (
    <div className="ph">
      {open && <FullPhoto photo={open.photo} timeZone={open.timeZone} onClose={() => setOpen(null)} />}
      {album ? (
        <AlbumView project={project} album={album} onBack={() => setAlbum(null)} onOpen={(photo, timeZone) => setOpen({ photo, timeZone })} />
      ) : (
        <>
          {cameraInput}
          <div className="ph-head">
            <button type="button" className="link-btn" onClick={onBack}><BackIcon /> Home</button>
            <button type="button" className="ph-snap" onClick={openCamera}><CameraIcon /> Snap</button>
          </div>
          <h2 className="page-title">Project photos</h2>
          <Waiting projectKey={projectKey} />
          <div className="dir-filters ph-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={shown === k} className={shown === k ? "is-on" : ""} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          {shown === "albums"
            ? <AlbumList key={albumsVersion} project={project} onOpenAlbum={setAlbum} />
            : <Groups state={state} by={shown} onOpen={(photo) => setOpen({ photo, timeZone: state.timeZone })} onMore={more} />}
          <p className="msg-footnote">Photos live in Procore's Photos tool. You see the ones Procore shows you.</p>
        </>
      )}
    </div>
  );
}
