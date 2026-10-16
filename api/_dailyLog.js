// Daily log by voice (docs/closeout-and-daily-log-spec.md, Feature B): the Procore side, in one place.
// Paths, field names and the plain-words errors for the four sections SiteSnap writes. Field names are the
// best known shape (Procore's support docs + the sandbox check page /api/procore/test-dailylog); when the check
// shows a different name, change it here only.
//   Manpower   POST /rest/v1.0/projects/{id}/manpower_logs  { manpower_log: { date, num_workers, num_hours, contact_id, location_id, notes } }
//              (the company is contact_id: vendor_id is ignored by Procore and leaves the company blank)
//   Delays     POST /rest/v1.0/projects/{id}/delay_logs     { delay_log: { date, delay_type (the key, see delayTypeKey), start_time, end_time, vendor_id, location_id, comments } }
//   Deliveries POST /rest/v1.0/projects/{id}/delivery_logs  { delivery_log: { date, time_hour, time_minute, delivery_from, contents, comments } }
//   Notes      POST /rest/v1.0/projects/{id}/notes_logs     { notes_log: { date, comment, location_id } }
//   Lists:     GET  …/{section path}?log_date=YYYY-MM-DD (no date = today only)
// Photos go with the entry as multipart attachments ({root}[attachments][]). SiteSnap never sets an entry's
// status (pending / approved): Procore sets it from the project's settings.

export const SECTIONS = {
  manpower: { path: "manpower_logs", root: "manpower_log", label: "Manpower", noun: "manpower" },
  delays: { path: "delay_logs", root: "delay_log", label: "Delays", noun: "delays" },
  deliveries: { path: "delivery_logs", root: "delivery_log", label: "Deliveries", noun: "deliveries" },
  notes: { path: "notes_logs", root: "notes_log", label: "Notes", noun: "notes" },
};
export const SECTION_KEYS = Object.keys(SECTIONS);

// Where a project's delay types might be read (the first that answers with a list wins). Never created by SiteSnap.
export const delayTypePaths = (companyId, projectId) => [
  `/rest/v1.0/projects/${projectId}/daily_logs/delay_log_types`,
  `/rest/v1.0/projects/${projectId}/delay_log_types`,
  `/rest/v1.0/companies/${companyId}/delay_log_types`,
];

// What Procore's delay_type takes: the type's key ("weather", "existing_conditions"), as in Procore's examples.
// Sending the display name ("Weather") makes an entry with No Delay Type (sandbox, 2026-10-16). Built-in types'
// keys are their names in snake case (translation_key).
export const delayTypeKey = (t) => {
  const s = String(t ?? "").trim();
  return /^[a-z0-9_]+$/.test(s) ? s : s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
};

// A delay type's name: the sandbox answers display_name / english_or_display_name (no name), e.g.
// { id, display_name: "Existing Conditions", translation_key: "existing_conditions", visible: true }
export const delayTypeName = (t) => t?.name || t?.display_name || t?.english_or_display_name || t?.title || "";

// Procore projects keep a Rails time zone name ("Pacific Time (US & Canada)"); the phone needs an IANA one
const RAILS_ZONES = {
  "Pacific Time (US & Canada)": "America/Los_Angeles", "Mountain Time (US & Canada)": "America/Denver", Arizona: "America/Phoenix",
  "Central Time (US & Canada)": "America/Chicago", "Eastern Time (US & Canada)": "America/New_York", Alaska: "America/Anchorage",
  Hawaii: "Pacific/Honolulu", "Atlantic Time (Canada)": "America/Halifax", UTC: "UTC",
};
export function ianaZone(tz) {
  const z = RAILS_ZONES[tz] ?? tz;
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return z; } catch { return "America/Los_Angeles"; }
}
/** The project's own date, YYYY-MM-DD (B6: the project's time zone, not the phone's) */
export const projectDay = (tz, now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: ianaZone(tz) }).format(now);

// ---------- what the phone sends, cleaned ----------

const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const id = (v) => (/^\d{1,20}$/.test(String(v ?? "")) ? Number(v) : null);
const num = (v, max) => { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) && n >= 0 && n <= max ? n : null; };
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const time = (v) => (TIME.test(String(v ?? "")) ? String(v) : null);

/** One review-screen entry -> only the fields SiteSnap sends, or throws with a plain message. */
export function cleanEntry(section, e = {}) {
  if (section === "manpower") {
    const workers = num(e.workers, 1000);
    if (workers == null || !Number.isInteger(workers)) throw new Error("Add how many workers.");
    return { company: id(e.company), workers, hours: num(e.hours, 24), location: id(e.location), trade: text(e.trade, 60), comment: text(e.comment, 1000) };
  }
  if (section === "delays") {
    const out = { type: text(e.type, 80), start: time(e.start), end: time(e.end), company: id(e.company), location: id(e.location), comment: text(e.comment, 1000) };
    if (!out.type && !out.comment) throw new Error("Say what held things up.");
    return out;
  }
  if (section === "deliveries") {
    const out = { what: text(e.what, 200), time: time(e.time), from: text(e.from, 120), comment: text(e.comment, 1000) };
    if (!out.what) throw new Error("Add what was delivered.");
    return out;
  }
  if (section === "notes") {
    const out = { text: text(e.text, 4000), location: id(e.location) };
    if (!out.text) throw new Error("The note is empty.");
    return out;
  }
  throw new Error("Unknown part of the Daily Log.");
}

/** The Procore fields for one cleaned entry. Blank fields are left out. */
export function procoreFields(section, e, { date }) {
  const f = { date };
  const put = (k, v) => { if (v !== null && v !== undefined && v !== "") f[k] = v; };
  if (section === "manpower") {
    put("num_workers", e.workers);
    put("num_hours", e.hours);
    put("contact_id", e.company);
    put("location_id", e.location);
    put("notes", [e.trade, e.comment].filter(Boolean).join(" · "));
  } else if (section === "delays") {
    put("delay_type", delayTypeKey(e.type));
    put("start_time", e.start);
    put("end_time", e.end);
    put("vendor_id", e.company);
    put("location_id", e.location);
    put("comments", e.comment);
  } else if (section === "deliveries") {
    if (e.time) { put("time_hour", Number(e.time.slice(0, 2))); put("time_minute", Number(e.time.slice(3))); }
    put("delivery_from", e.from);
    put("contents", e.what);
    put("comments", e.comment);
  } else {
    put("comment", e.text);
    put("location_id", e.location);
  }
  return f;
}

/** The request: JSON without photos, multipart with them ({root}[field], {root}[attachments][]) */
export function requestFor(section, fields, photos = []) {
  const { root } = SECTIONS[section];
  if (!photos.length) return { body: { [root]: fields } };
  return {
    form: () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(`${root}[${k}]`, String(v));
      photos.forEach((p, i) => form.append(`${root}[attachments][]`, new Blob([p.bytes], { type: p.type }), `SiteSnap-daily-log-${i + 1}.${p.type === "image/png" ? "png" : "jpg"}`));
      return form;
    },
  };
}

/** A Procore manpower line -> who and how many (for "You already logged X today") */
export function manpowerLine(m) {
  const co = m?.contact ?? m?.vendor ?? null;
  return { id: m?.id ?? null, companyId: co?.id ?? null, companyName: co?.name ?? null, workers: Number(m?.num_workers) || 0, status: m?.status ?? null };
}

// ---------- Procore's answer in plain words (spec section 0) ----------

export function procoreMessage(r) {
  const e = r?.json?.errors ?? r?.json?.message ?? r?.json?.error;
  if (!e) return "";
  if (typeof e === "string") return e;
  if (Array.isArray(e)) return e.join(", ");
  return Object.entries(e).map(([k, v]) => `${k === "base" ? "" : `${k.replace(/_/g, " ")} `}${[].concat(v).join(", ")}`.trim()).join("; ");
}

/** { status, code, message, retryAfter? } for a refused write */
export function friendlyError(section, r, now = Date.now()) {
  const noun = SECTIONS[section]?.noun ?? "entries";
  if (r.status === 401) return { status: 401, code: "not_connected", message: "Sign in to Procore again, then tap Retry." };
  if (r.status === 403) return { status: 403, code: "no_access", message: `You don't have permission to add ${noun} to the Daily Log on this project.` };
  if (r.status === 404) return { status: 404, code: "no_daily_log", message: "The Daily Log isn't turned on for this project in Procore." };
  if (r.status === 429) {
    const reset = Number(r.headers?.["x-rate-limit-reset"]);
    const retryAfter = Number.isFinite(reset) && reset > 0 ? Math.min(60, Math.max(2, Math.ceil(reset - now / 1000))) : 10;
    return { status: 429, code: "busy", message: "Procore is busy, trying again in a moment.", retryAfter };
  }
  if (r.status === 422 || r.status === 400) {
    const said = procoreMessage(r);
    return { status: 422, code: "procore_refused", message: said ? `Procore said: ${said}. Fix it and tap Retry.` : "Procore didn't accept this entry. Check it and tap Retry." };
  }
  return { status: 502, code: "procore_failed", message: "Procore didn't save it. Tap Retry." };
}
