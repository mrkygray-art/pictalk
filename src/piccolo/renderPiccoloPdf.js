// Draws a Piccolo export (from exportSource) as a PDF with jsPDF: any of the work order
// (no prices), the parts list, and the quote. Drafts are stamped DRAFT and guests' copies
// DEMO on every page. jsPDF loads only when someone exports.
import { pdfSafe } from "../renderJobPdf";

const PAGE = { w: 612, h: 792 }; // US Letter, in points
const M = 48;
const FOOTER_H = 30;
const CONTENT_W = PAGE.w - M * 2;
const BOTTOM = PAGE.h - M - FOOTER_H;
const INK = [20, 20, 20];
const MUTED = [95, 95, 100];
const LINE = [200, 200, 205];

const money = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "TBD");
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export async function renderPiccoloPdf(src, sections = { workorder: true, bom: true, quote: true }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true });
  let y = M;
  let first = true;

  const ensure = (needed) => {
    if (y + needed > BOTTOM) {
      pdf.addPage();
      y = M;
    }
  };
  const text = (str, { size = 11, bold = false, color = INK, gap = 4, x = 0, width = CONTENT_W - x } = {}) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lineH = size * 1.3;
    for (const line of pdf.splitTextToSize(pdfSafe(str), width)) {
      ensure(lineH);
      pdf.text(line, M + x, y + size);
      y += lineH;
    }
    y += gap;
  };
  const rule = () => {
    ensure(12);
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.75);
    pdf.line(M, y + 4, PAGE.w - M, y + 4);
    y += 14;
  };
  const heading = (label) => {
    ensure(40);
    text(label, { size: 13, bold: true, gap: 4 });
  };
  const bullets = (items, { answers = false } = {}) => {
    for (const it of items || []) {
      text(`-  ${it.text}`, { size: 11, gap: 2, x: 8 });
      if (answers && it.answered && it.answer) text(`Answer: ${it.answer}`, { size: 10, color: MUTED, gap: 2, x: 20 });
    }
    y += 6;
  };

  // Title block at the start of each section, on a new page after the first
  const cover = (title) => {
    if (!first) {
      pdf.addPage();
      y = M;
    }
    first = false;
    text(src.orgName || "Piccolo", { size: 10, bold: true, color: MUTED, gap: 2 });
    text(title, { size: 22, bold: true, gap: 8 });
    const rows = [
      ["Customer", src.job.customer],
      ["Location", src.job.location],
      ["Quote #", src.quoteNumber],
      ["Site visit", fmtDate(src.job.startedAt)],
      ["Version", src.kind === "final" ? `Final v${src.version}, ${fmtDate(src.finalizedAt)}${src.finalizedByName ? ` by ${src.finalizedByName}` : ""}` : "Draft (not finalized)"],
    ].filter(([, v]) => v);
    for (const [label, value] of rows) {
      ensure(16);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(...MUTED);
      pdf.text(pdfSafe(label), M, y + 11);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...INK);
      const lines = pdf.splitTextToSize(pdfSafe(value), CONTENT_W - 90);
      pdf.text(lines, M + 90, y + 11);
      y += Math.max(1, lines.length) * 14.3 + 3;
    }
    y += 6;
    rule();
  };

  // A simple table: columns { label, w, align, get }; the "wrap" column wraps
  const table = (cols, rows) => {
    const head = () => {
      ensure(20);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...MUTED);
      let x = M;
      for (const c of cols) {
        pdf.text(pdfSafe(c.label), c.align === "right" ? x + c.w - 4 : x, y + 9, { align: c.align === "right" ? "right" : "left" });
        x += c.w;
      }
      y += 14;
      pdf.setDrawColor(...LINE);
      pdf.line(M, y, PAGE.w - M, y);
      y += 4;
    };
    head();
    for (const r of rows) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      const cells = cols.map((c) => pdf.splitTextToSize(pdfSafe(c.get(r) ?? ""), c.w - 8));
      const h = Math.max(...cells.map((l) => l.length)) * 13 + 6;
      if (y + h > BOTTOM) {
        pdf.addPage();
        y = M;
        head();
      }
      let x = M;
      pdf.setTextColor(...INK);
      cols.forEach((c, i) => {
        pdf.text(cells[i], c.align === "right" ? x + c.w - 4 : x, y + 10, { align: c.align === "right" ? "right" : "left" });
        x += c.w;
      });
      y += h;
    }
    y += 6;
  };

  const parts = src.bom.filter((l) => l.category !== "labor");
  const wo = src.workOrder || {};

  if (sections.workorder) {
    cover("Work order");
    if (wo.scope) {
      heading("Scope of work");
      text(wo.scope, { gap: 10 });
    }
    for (const loc of wo.locations || []) {
      heading(loc.name);
      bullets(loc.tasks);
    }
    if (parts.length) {
      heading("Devices and materials");
      bullets(parts.map((l) => ({ text: `${l.qty} ${l.unit}  ${l.description}${l.partNumber ? ` (${l.partNumber})` : ""}${l.location ? ` - ${l.location}` : ""}` })));
    }
    if (wo.installNotes?.length) {
      heading("Installation notes");
      bullets(wo.installNotes);
    }
    if (wo.constraints?.length) {
      heading("Customer requirements");
      bullets(wo.constraints);
    }
    if (src.questions.length) {
      heading("Open questions");
      bullets(src.questions, { answers: true });
    }
  }

  if (sections.bom) {
    cover("Parts list");
    table(
      [
        { label: "#", w: 24, get: (r) => String(r.n) },
        { label: "Qty", w: 44, align: "right", get: (r) => String(r.qty) },
        { label: "Unit", w: 40, get: (r) => r.unit },
        { label: "Description", w: 190, get: (r) => r.description },
        { label: "Part #", w: 110, get: (r) => (r.partNumber ? `${r.partNumber}${r.partNumberStatus === "ai_suggested" ? " (verify)" : ""}` : "") },
        { label: "Where", w: CONTENT_W - 408, get: (r) => r.location },
      ],
      parts.map((l, i) => ({ ...l, n: i + 1 }))
    );
    if (!parts.length) text("No parts.", { color: MUTED });
  }

  if (sections.quote) {
    cover("Quote");
    table(
      [
        { label: "#", w: 24, get: (r) => String(r.n) },
        { label: "Description", w: 250, get: (r) => r.description },
        { label: "Qty", w: 60, align: "right", get: (r) => `${r.qty} ${r.unit}` },
        { label: "Unit price", w: 90, align: "right", get: (r) => money(r.unitPrice) },
        { label: "Total", w: CONTENT_W - 424, align: "right", get: (r) => (Number.isFinite(r.unitPrice) ? money(r.unitPrice * r.qty) : "TBD") },
      ],
      src.bom.map((l, i) => ({ ...l, n: i + 1 }))
    );
    const t = src.totals;
    const total = (label, value, bold = false) => {
      ensure(16);
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(bold ? 12 : 11);
      pdf.setTextColor(...INK);
      pdf.text(pdfSafe(label), PAGE.w - M - 140, y + 11, { align: "right" });
      pdf.text(pdfSafe(value), PAGE.w - M, y + 11, { align: "right" });
      y += bold ? 18 : 15;
    };
    total("Subtotal", money(t.subtotal));
    total(`Markup (${src.quote.markupPct || 0}%)`, money(t.markup));
    total(`Tax (${src.quote.taxPct || 0}%)`, money(t.tax));
    total("Total", money(t.total), true);
    y += 6;
    if (t.unpriced) text(`${t.unpriced} line${t.unpriced === 1 ? " is" : "s are"} not priced yet (TBD) and not included in the total.`, { size: 10, color: MUTED });
    if (src.bom.some((l) => l.priceSource === "ai_estimate")) text("Some prices are AI estimates and must be confirmed.", { size: 10, bold: true });
    if (src.bom.some((l) => l.priceSource === "sample")) text("Sample prices for demonstration only.", { size: 10, bold: true });
    if (src.quote.terms) {
      heading("Terms");
      text(src.quote.terms);
    }
  }

  // Watermark (DRAFT / DEMO) and footer on every page
  const pages = pdf.getNumberOfPages();
  const footer = pdfSafe(`Piccolo · ${src.quoteNumber}${src.watermark ? ` · ${src.watermark}` : ""}`);
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    if (src.watermark) {
      const faint = pdf.GState ? new pdf.GState({ opacity: 0.12 }) : null;
      if (faint) pdf.setGState(faint);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(110);
      pdf.setTextColor(faint ? 200 : 235, 40, 40);
      pdf.text(src.watermark, PAGE.w / 2, PAGE.h / 2 + 40, { align: "center", angle: 35 });
      if (faint) pdf.setGState(new pdf.GState({ opacity: 1 }));
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...MUTED);
    pdf.text(footer, M, PAGE.h - M + 8);
    pdf.text(`Page ${p} of ${pages}`, PAGE.w - M, PAGE.h - M + 8, { align: "right" });
  }
  return pdf.output("blob");
}
