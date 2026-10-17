// Daily Log helpers shared by the review screen (DailyLogFlow), the entry card (DailyLogEntry) and Past logs.

export const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
export const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const label12 = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

// What each section sends (api/_dailyLog.js cleanEntry checks it again)
export function payload(section, e) {
  if (section === "manpower") return { company: e.company ?? null, workers: e.workers, hours: e.hours ?? null, location: e.location ?? null, trade: e.trade ?? "", comment: e.comment ?? "" };
  if (section === "delays") return { type: e.type ?? "", start: e.start ?? null, end: e.end ?? null, company: e.company ?? null, location: e.location ?? null, comment: e.comment ?? "" };
  if (section === "deliveries") return { what: e.what ?? "", time: e.time ?? null, from: e.from ?? "", comment: e.comment ?? "" };
  return { text: e.text ?? "", location: e.location ?? null };
}
// Missing must-haves, in plain words (shown on the card; Send waits until they're fixed)
export function problem(section, e) {
  if (section === "manpower" && !(Number.isInteger(Number(e.workers)) && e.workers !== "" && e.workers != null)) return "Add how many workers.";
  if (section === "delays" && !String(e.type ?? "").trim() && !String(e.comment ?? "").trim()) return "Say what held things up.";
  if (section === "deliveries" && !String(e.what ?? "").trim()) return "Add what was delivered.";
  if (section === "notes" && !String(e.text ?? "").trim()) return "The note is empty.";
  return "";
}
export const coName = (opts, id) => (opts?.companies ?? []).find((c) => Number(c.id) === Number(id))?.name ?? "";
export function entryLine(section, e, opts) {
  if (section === "manpower") return `Manpower: ${e.workers || "?"} workers · ${coName(opts, e.company) || "company not set"}`;
  if (section === "delays") return `Delay: ${[e.type, e.comment].filter(Boolean).join(" · ") || "delay"}`;
  if (section === "deliveries") return `Delivery: ${e.what || "delivery"}${e.time ? ` at ${label12(e.time)}` : ""}`;
  return `Note: ${String(e.text ?? "").slice(0, 60) || "note"}`;
}
