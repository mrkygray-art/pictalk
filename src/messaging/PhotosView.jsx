import { useCallback, useEffect, useRef, useState } from "react";
import { BackIcon, CameraIcon } from "./icons";
import { dayLabel, dayOf, groupPhotos, hasArea, hasTrade, loadAlbums, loadPhotos, photoDay, photoTime, timeLine } from "./photosStore";
import { autoFileOn, discardPhoto, lastSavedPhoto, linkLabel, onPhotoQueueChange, pendingPhotos, retryPhoto, setAutoFile } from "./photoQueue";
import SnapFlow from "./SnapFlow";
import { useDemo } from "./demo";

// Project photos (docs/sitesnap-project-home-and-photos-spec.md, section 2): Procore's Photos tool, read-only.
// By day (default) / By area / By trade group the project's photos, newest first; Albums lists Procore's albums.
// Snap (camera straight away) saves into that day's "Field photos" album through the upload queue (photoQueue.js).
// Built for 100+ photos on a phone: the tabs + Snap bar and each day's header stay pinned while scrolling, a day
// shows at most DAY_PREVIEW photos with "See all N" (DayView), and Go to a day opens any date. By day uses the
// day a photo was taken (Procore's taken_at), else the day it reached Procore.

const DAY_PREVIEW = 9; // 3 rows

// A list of photos that loads more as you scroll (a button too, for when scrolling can't tell)
const FIRST = { photos: [], nextPage: 1, timeZone: null, loading: false, error: "" };
function usePhotoPages(project, albumId, day) {
  const [state, setState] = useState(FIRST);
  const busy = useRef(false);
  const more = useCallback(async () => {
    if (busy.current || !state.nextPage) return;
    busy.current = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const b = await loadPhotos(project, { albumId, day, page: state.nextPage });
      setState((s) => ({ photos: [...s.photos, ...b.photos.filter((p) => !s.photos.some((x) => x.id === p.id))], nextPage: b.nextPage, timeZone: s.timeZone ?? b.timeZone, loading: false, error: "" }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    } finally {
      busy.current = false;
    }
  }, [project, albumId, day, state.nextPage]);
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
            {p.linked && <span className="ph-grid-tag">{linkLabel(p.linked)}</span>}
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
        {photo.linked && <p className="ph-linked">Linked to {linkLabel(photo.linked)}</p>}
        <p className="ph-full-who"><strong>{photo.by || "Someone"}</strong> · {photo.takenAt ? `taken ${timeLine(photo.takenAt, timeZone)}` : timeLine(photo.createdAt, timeZone)}</p>
        {photo.takenAt && photo.createdAt && dayOf(photo.takenAt, timeZone) !== dayOf(photo.createdAt, timeZone) && <p className="ph-muted">Added to Procore {timeLine(photo.createdAt, timeZone)}</p>}
        <p className="ph-muted">{photo.albumName ? `Album: ${photo.albumName}` : ""}{photo.albumPrivate ? " (private)" : ""}</p>
        {where && <p className="ph-muted">{where}</p>}
        {photo.description && <p className="msg-words">{photo.description}</p>}
      </div>
    </div>
  );
}

function Groups({ state, by, onOpen, onMore, onDay }) {
  if (!state.photos.length) {
    if (state.error) return <MoreOnScroll state={state} onMore={onMore} />;
    if (state.loading || state.nextPage === 1) return <p className="ph-muted">Loading photos…</p>;
    return <p className="empty">No photos on this project yet.</p>;
  }
  const groups = groupPhotos(state.photos, by, state.timeZone);
  // Photos come newest-added first, so with more pages to come, any day on or before the oldest day added so far
  // may still get photos (By area / By trade: the last group)
  const oldestAdded = state.photos.reduce((m, p) => { const d = dayOf(p.createdAt, state.timeZone); return d && (!m || d < m) ? d : m; }, "");
  return (
    <>
      {groups.map((g, i) => {
        const partial = !!state.nextPage && (by === "day" ? !g.key || g.key <= oldestAdded : i === groups.length - 1);
        const cut = by === "day" && g.key && (g.photos.length > DAY_PREVIEW || partial);
        return (
          <section key={g.key} className="ph-group">
            <h3>{g.label} <small>{g.photos.length}{partial ? "+" : ""} photo{g.photos.length === 1 && !partial ? "" : "s"}</small></h3>
            <Grid photos={by === "day" ? g.photos.slice(0, DAY_PREVIEW) : g.photos} onOpen={onOpen} />
            {cut && <button type="button" className="ph-all" onClick={() => onDay(g.key, g.photos)}>{g.photos.length > DAY_PREVIEW ? `See all ${g.photos.length}${partial ? "+" : ""} photos` : "See all photos"} ›</button>}
          </section>
        );
      })}
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
    // Empty albums (Procore's default "Unclassified", for one) have nothing to browse, so they're left out here;
    // Snap's album picker still offers them
    loadAlbums(project).then((a) => live && setAlbums(a.filter((x) => x.count !== 0))).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [project, attempt]);
  if (error) return <div className="ph-more"><p className="procore-note">{error}</p><button type="button" className="stop-more" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Try Again</button></div>;
  if (!albums) return <p className="ph-muted">Loading albums…</p>;
  if (!albums.length) return <p className="empty">No albums with photos on this project yet.</p>;
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

// One day's photos: the ones already loaded for it (seed) plus Procore's photos added that day or the next, kept
// when they were taken (else added) on that day. Opened from "See all" or Go to a day.
function DayView({ project, day, seed, timeZone, onBack, onOpen, snapButton }) {
  const [state, more] = usePhotoPages(project, null, day);
  useEffect(() => { if (state.nextPage === 1 && !state.loading && !state.error) more(); }, [state.nextPage, state.loading, state.error, more]);
  const tz = state.timeZone ?? timeZone;
  const seen = new Set();
  const photos = [...(seed ?? []), ...state.photos]
    .filter((p) => !seen.has(p.id) && seen.add(p.id) && photoDay(p, tz) === day)
    .sort((a, b) => String(photoTime(b) ?? "").localeCompare(String(photoTime(a) ?? "")));
  const loading = state.loading || state.nextPage === 1;
  return (
    <>
      <div className="ph-head">
        <button type="button" className="link-btn" onClick={onBack}><BackIcon /> Photos</button>
        {snapButton}
      </div>
      <h2 className="page-title">{dayLabel(day, tz)}</h2>
      <p className="ph-muted">{photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}${state.nextPage ? " so far" : ""}` : loading ? "Loading photos…" : "No photos for this day."}</p>
      {photos.length > 0 && <Grid photos={photos} onOpen={(p) => onOpen(p, tz)} />}
      <MoreOnScroll state={state} onMore={more} />
    </>
  );
}

// Spec section 4's setting, kept on this phone (on unless turned off)
function AutoFileSwitch() {
  const [on, setOn] = useState(autoFileOn);
  return (
    <label className="ph-autofile">
      <input type="checkbox" checked={on} onChange={(e) => { setAutoFile(e.target.checked); setOn(e.target.checked); }} />
      <span>Also save photos from reports and messages to the project's daily album</span>
    </label>
  );
}

export default function PhotosView({ session, onBack }) {
  const { project } = session;
  const projectKey = `${project.companyId}_${project.projectId}`;
  const [tab, setTab] = useState("day"); // day | area | trade | albums
  const [album, setAlbum] = useState(null);
  const [dayOpen, setDayOpen] = useState(null); // { day, seed } from See all / Go to a day
  const [jump, setJump] = useState("");
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

  const { demo, explain } = useDemo();
  const openCamera = () => (demo ? explain("Snapping a photo into Procore") : camera.current?.click());
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

  const today = dayOf(new Date().toISOString(), state.timeZone);
  const openPhoto = (photo, timeZone) => setOpen({ photo, timeZone: timeZone ?? state.timeZone });
  const snapButton = <button type="button" className="ph-snap" onClick={openCamera}><CameraIcon /> Snap</button>;
  return (
    <div className="ph">
      {open && <FullPhoto photo={open.photo} timeZone={open.timeZone} onClose={() => setOpen(null)} />}
      {cameraInput}
      {album ? (
        <AlbumView project={project} album={album} onBack={() => setAlbum(null)} onOpen={openPhoto} />
      ) : dayOpen ? (
        <DayView key={dayOpen.day} project={project} day={dayOpen.day} seed={dayOpen.seed} timeZone={state.timeZone} onBack={() => { setDayOpen(null); setJump(""); }} onOpen={openPhoto} snapButton={snapButton} />
      ) : (
        <>
          <div className="ph-head">
            <button type="button" className="link-btn" onClick={onBack}><BackIcon /> Home</button>
          </div>
          <h2 className="page-title">Project photos</h2>
          <Waiting projectKey={projectKey} />
          {/* Pinned while scrolling: the tabs and Snap */}
          <div className="ph-bar">
            <div className="dir-filters ph-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
              {tabs.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={shown === k} className={shown === k ? "is-on" : ""} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            <button type="button" className="ph-snap is-compact" onClick={openCamera} aria-label="Snap a photo"><CameraIcon /> Snap</button>
          </div>
          {shown === "day" && (
            <label className="msg-field ph-jump"><span>Go to a day</span>
              <input type="date" className="dir-input" max={today} value={jump}
                onChange={(e) => { setJump(e.target.value); if (e.target.value >= "2000-01-01") setDayOpen({ day: e.target.value, seed: state.photos }); }} />
            </label>
          )}
          {shown === "albums"
            ? <AlbumList key={albumsVersion} project={project} onOpenAlbum={setAlbum} />
            : <Groups state={state} by={shown} onOpen={(photo) => openPhoto(photo)} onMore={more} onDay={(day, seed) => { setDayOpen({ day, seed }); window.scrollTo(0, 0); }} />}
          <AutoFileSwitch />
          <p className="msg-footnote">Photos live in Procore's Photos tool. You see the ones Procore shows you.</p>
        </>
      )}
    </div>
  );
}
