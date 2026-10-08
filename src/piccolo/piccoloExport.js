// Piccolo exports: the same content from either a final (v1, v2, …) or the current version
// (marked DRAFT). Guests' exports are marked DEMO. PDF drawing is in renderPiccoloPdf.js.
import { quoteTotals } from "./piccoloStore";

/**
 * One shape for every export. `from` is a final doc, or the working copy plus the job's
 * current summary, notes, and stops (for a draft export).
 */
export function exportSource({ job, final, working, summary, notes, stops, orgName, isGuest }) {
  const base = final || working;
  const quote = base.quote || {};
  const start = new Date(job.startedAt || Date.now());
  const ymd = `${String(start.getFullYear()).slice(2)}${String(start.getMonth() + 1).padStart(2, "0")}${String(start.getDate()).padStart(2, "0")}`;
  return {
    kind: final ? "final" : "draft",
    version: final?.version ?? null,
    finalizedAt: final?.finalizedAt ?? null,
    finalizedByName: final?.finalizedByName ?? null,
    watermark: isGuest ? "DEMO" : final ? null : "DRAFT",
    orgName: orgName || null,
    quoteNumber: `${quote.prefix || "Q-"}${ymd}-${final ? `v${final.version}` : "DRAFT"}`,
    job: final?.job || { name: job.name, customer: job.customer || null, location: job.location || null, startedAt: job.startedAt, endedAt: job.endedAt || null },
    workOrder: base.workOrder,
    bom: [...(base.bom || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    quote,
    totals: quoteTotals(base.bom, quote),
    questions: base.questions || [],
    summary: final ? final.summary : summary || null,
    notes: final ? final.notes : { field: notes?.field?.text?.trim() || null, customer: notes?.customer?.text?.trim() || null },
    stops: final
      ? final.stops
      : (stops || []).map((s, i) => ({ id: s.id, index: i + 1, words: s.words || null, photoDescription: s.photoDescription || null })),
    mediaManifest: final?.mediaManifest || [],
  };
}

/** "Piccolo_Acme-Corp_Main-office_Quote_v2.pdf" (or _DRAFT / _DEMO). ASCII only. */
export function piccoloFileName(src, what, ext) {
  const part = (v) =>
    String(v || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9\s-]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .slice(0, 40)
      .replace(/-+$/, "");
  const who = [part(src.job.customer), part(src.job.location)].filter(Boolean);
  const tag = src.watermark || (src.version ? `v${src.version}` : "DRAFT");
  return ["Piccolo", ...(who.length ? who : ["Job"]), what, tag].join("_") + "." + ext;
}

// ---------- CSV ----------
const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; // also blocks spreadsheet formulas
};
const csv = (rows) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"; // BOM so Excel reads UTF-8
const price = (n) => (Number.isFinite(n) ? n.toFixed(2) : "");

/** Parts list (no labor). Includes your cost; leave it out before sending to a customer. */
export function partsCsv(src) {
  const rows = [["Line", "Description", "Qty", "Unit", "Part number", "Part # checked", "Where", "Type", "Your cost (each)", "Notes", "Source"]];
  src.bom
    .filter((l) => l.category !== "labor")
    .forEach((l, i) =>
      rows.push([
        i + 1, l.description, l.qty, l.unit, l.partNumber, l.partNumberStatus === "ai_suggested" ? "VERIFY" : l.partNumber ? "yes" : "",
        l.location, l.category, price(l.unitCost), l.notes, l.source?.basis || "",
      ])
    );
  return csv(rows);
}

/** Customer-facing quote lines and totals (no costs). */
export function quoteCsv(src) {
  const rows = [["Line", "Description", "Qty", "Unit", "Unit price", "Line total", "Type"]];
  src.bom.forEach((l, i) =>
    rows.push([i + 1, l.description, l.qty, l.unit, price(l.unitPrice), Number.isFinite(l.unitPrice) ? price(l.unitPrice * l.qty) : "", l.category])
  );
  const t = src.totals;
  rows.push([], ["", "Subtotal", "", "", "", price(t.subtotal)], ["", `Markup (${src.quote.markupPct || 0}%)`, "", "", "", price(t.markup)]);
  rows.push(["", `Tax (${src.quote.taxPct || 0}%)`, "", "", "", price(t.tax)], ["", "Total", "", "", "", price(t.total)]);
  if (t.unpriced) rows.push(["", `${t.unpriced} line(s) not priced yet`]);
  if (src.watermark) rows.push(["", src.watermark]);
  return csv(rows);
}

/** The full job package as JSON, with media links when the server could sign them. */
export function packageJson(src, { links = {}, expiresAt = null } = {}) {
  const out = {
    exportedAt: new Date().toISOString(),
    source: src.kind === "final" ? `final v${src.version}` : "current version (draft)",
    watermark: src.watermark,
    quoteNumber: src.quoteNumber,
    job: src.job,
    summary: src.summary,
    notes: src.notes,
    stops: src.stops,
    workOrder: src.workOrder,
    bom: src.bom,
    quote: { ...src.quote, totals: src.totals },
    questions: src.questions,
    media: src.mediaManifest.map((m) => ({ ...m, url: (m.storagePath && links[m.storagePath]) || null })),
    mediaLinksExpireAt: expiresAt ? new Date(expiresAt).toISOString() : null,
  };
  return JSON.stringify(out, null, 2);
}
