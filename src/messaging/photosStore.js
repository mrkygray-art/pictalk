// Project photos: Procore's Photos tool is the system of record, read through /api/procore/photos.
// Nothing is stored here; the photo files themselves are cached by the browser (photo-file sends a week's
// private cache header).

async function getJson(url) {
  let r;
  try {
    r = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("No signal. Photos load when you're back online.");
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message || "Couldn't load photos. Try again."), { status: r.status });
  return body;
}

const ids = (project) => ({ companyId: project.companyId, projectId: project.projectId });

export const loadAlbums = (project) =>
  getJson(`/api/procore/photos?${new URLSearchParams({ ...ids(project), view: "albums" })}`).then((b) => b.albums ?? []);

export const loadPhotos = (project, { albumId, page = 1 } = {}) =>
  getJson(`/api/procore/photos?${new URLSearchParams({ ...ids(project), view: "photos", page: String(page), ...(albumId ? { albumId: String(albumId) } : {}) })}`);

// ---- grouping (By day / By area / By trade), all on the photos already loaded ----

/** YYYY-MM-DD of a time in the project's time zone (the phone's own when Procore didn't say) */
export function dayOf(iso, timeZone) {
  if (!iso) return "";
  const d = new Date(iso);
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined }).format(d); }
  catch { return new Intl.DateTimeFormat("en-CA").format(d); }
}

export function dayLabel(day, timeZone, now = new Date()) {
  if (!day) return "No date";
  const today = dayOf(now.toISOString(), timeZone);
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000).toISOString(), timeZone);
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = y === Number(today.slice(0, 4));
  return date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Groups in first-seen order (photos come newest first). A photo with several trades shows under each. */
export function groupPhotos(photos, by, timeZone) {
  const groups = new Map();
  const add = (key, label, p) => {
    if (!groups.has(key)) groups.set(key, { key, label, photos: [] });
    groups.get(key).photos.push(p);
  };
  for (const p of photos) {
    if (by === "day") {
      const day = dayOf(p.createdAt, timeZone);
      add(day, dayLabel(day, timeZone), p);
    } else if (by === "area") {
      if (p.location) add(`l${p.location.id}`, p.location.name, p);
      else add("none", "No area set", p);
    } else if (by === "trade") {
      if (p.trades.length) for (const t of p.trades) add(`t${t.id}`, t.name, p);
      else add("none", "No trade set", p);
    }
  }
  // "No area / trade set" goes last
  const list = [...groups.values()];
  return [...list.filter((g) => g.key !== "none"), ...list.filter((g) => g.key === "none")];
}

/** Which chips to offer: By area / By trade only once a loaded photo carries one (never faked) */
export const hasArea = (photos) => photos.some((p) => p.location);
export const hasTrade = (photos) => photos.some((p) => p.trades.length);

export function timeLine(iso, timeZone) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: timeZone || undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
}
