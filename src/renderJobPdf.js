// src/renderJobPdf.js — draws a job export (from buildJobExport) as a PDF with jsPDF.
// Kept separate from the data step so the same export object can also be saved as JSON.
// jsPDF is loaded only when someone exports, so the capture screen stays small and fast.

const PAGE = { w: 612, h: 792 }; // US Letter, in points
const M = 48; // page margin
const FOOTER_H = 30;
const CONTENT_W = PAGE.w - M * 2;
const BOTTOM = PAGE.h - M - FOOTER_H;
const MAX_PHOTO_H = 340;

const INK = [20, 20, 20];
const MUTED = [95, 95, 100];
const LINE = [200, 200, 205];

// The PDF's built-in fonts only cover basic Western characters; swap common
// typographic ones for plain equivalents so nothing prints as garbage.
function pdfSafe(text) {
  const swapped = String(text ?? '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '·')
    .split(String.fromCharCode(160)).join(' '); // non-breaking spaces
  // Keep tab, newlines, printable ASCII, and Latin-1 letters/symbols; drop the rest
  return Array.from(swapped)
    .filter((ch) => {
      const c = ch.codePointAt(0);
      return c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 161 && c <= 255);
    })
    .join('');
}

const fmtDateTime = (isoStr) =>
  isoStr
    ? new Date(isoStr).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
const fmtDate = (isoStr) =>
  isoStr ? new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

function audioNote(stop, now) {
  if (!stop.hasAudio) return 'No voice note';
  if (!stop.audioAvailableUntil) return 'Audio on file in PicTalk';
  return new Date(stop.audioAvailableUntil) > now
    ? `Audio on file in PicTalk until ${fmtDate(stop.audioAvailableUntil)}`
    : 'Audio recording expired';
}

function transcriptText(stop) {
  if (stop.transcript) return stop.transcript;
  switch (stop.transcriptStatus) {
    case 'no_speech': return 'No speech was heard in the voice note.';
    case 'failed': return "The voice note couldn't be written out.";
    case 'pending': return 'Transcript not ready yet.';
    default: return stop.hasAudio ? 'No transcript.' : null;
  }
}

/**
 * Render the export object to a PDF.
 * photos: Map of stop id -> { dataUrl, width, height } (already downscaled JPEGs).
 * Returns a Blob (application/pdf).
 */
export async function renderJobPdf(data, photos) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const now = new Date(data.exportedAt);
  let y = M;

  const ensure = (needed) => {
    if (y + needed > BOTTOM) {
      pdf.addPage();
      y = M;
    }
  };
  const text = (str, { size = 11, bold = false, color = INK, gap = 4, indent = 0, width = CONTENT_W - indent } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lineH = size * 1.3;
    for (const line of pdf.splitTextToSize(pdfSafe(str), width)) {
      ensure(lineH);
      pdf.text(line, M + indent, y + size);
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

  // ---------- cover block ----------
  text('PicTalk job report', { size: 10, bold: true, color: MUTED, gap: 2 });
  text(data.jobName, { size: 20, bold: true, gap: 10 });
  const rows = [
    ['Customer', data.customer],
    ['Location', data.location],
    ['Started', fmtDateTime(data.startedAt)],
    ['Finished', fmtDateTime(data.endedAt) || 'Still open'],
    ['Captured by', data.capturedBy],
    ['Stops', String(data.stopCount)],
  ].filter(([, v]) => v);
  for (const [label, value] of rows) {
    ensure(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...MUTED);
    pdf.text(pdfSafe(label), M, y + 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...INK);
    const lines = pdf.splitTextToSize(pdfSafe(value), CONTENT_W - 90);
    pdf.text(lines, M + 90, y + 11);
    y += Math.max(1, lines.length) * 14.3 + 3;
  }
  y += 6;
  rule();

  // ---------- approved AI summary (only when approved) ----------
  const s = data.summary;
  if (s) {
    // Where an item came from: " (Stop 1, 3, Field notes)"
    const stopsNote = (nums, notes = []) => {
      const parts = [...(nums.length ? [`Stop ${nums.join(', ')}`] : []), ...notes];
      return parts.length ? ` (${parts.join(', ')})` : '';
    };
    const heading = (label) => text(label, { size: 13, bold: true, gap: 4 });
    heading('Summary');
    text(s.text, { size: 11, gap: 10 });
    if (s.actionItems.length) {
      heading('Action items');
      for (const item of s.actionItems) {
        text(`${item.priority.toUpperCase()}  ${item.text}${stopsNote(item.stops, item.notes)}`, { size: 11, gap: 3, indent: 10 });
      }
      y += 7;
    }
    text(`Summary drafted by AI from the voice notes${s.usedWrapUpNotes ? ' and wrap-up notes' : ''}; reviewed and approved by ${s.approvedBy}${s.approvedAt ? ` on ${fmtDateTime(s.approvedAt)}` : ''}.`, { size: 9, color: MUTED, gap: 6 });
    rule();
  }

  // ---------- wrap-up notes (when the job has any) ----------
  const w = data.wrapUpNotes;
  if (w) {
    text('Wrap-up notes', { size: 13, bold: true, gap: 4 });
    for (const [label, body] of [['Field notes', w.field], ['Customer comments', w.customer]]) {
      if (!body) continue;
      text(label, { size: 11, bold: true, color: MUTED, gap: 2 });
      text(body, { size: 11, gap: 8 });
    }
    text('Text only. The original audio is kept in PicTalk for 5 days.', { size: 9, color: MUTED, gap: 6 });
    rule();
  }

  // ---------- one section per stop ----------
  for (const stop of data.stops) {
    const photo = photos.get(stop.id);
    let photoW = 0, photoH = 0;
    if (photo) {
      const scale = Math.min(CONTENT_W / photo.width, MAX_PHOTO_H / photo.height);
      photoW = photo.width * scale;
      photoH = photo.height * scale;
    }
    // Keep a stop's heading and photo together on one page
    ensure(28 + (photo ? photoH + 10 : 0));
    text(`Stop ${stop.index}${stop.timestamp ? ` · ${fmtDateTime(stop.timestamp)}` : ''}`, { size: 14, bold: true, gap: 6 });
    if (photo) {
      pdf.addImage(photo.dataUrl, 'JPEG', M, y, photoW, photoH, `stop-${stop.id}`, 'NONE');
      y += photoH + 10;
    }
    const t = transcriptText(stop);
    if (t) text(t, { size: 11, gap: 4 });
    if (stop.photoDescription) {
      text('Photo description', { size: 9, bold: true, color: MUTED, gap: 2 });
      text(stop.photoDescription, { size: 10, gap: 4 });
    }
    text(audioNote(stop, now), { size: 9, color: MUTED, gap: 8 });
    rule();
  }

  // ---------- footer on every page ----------
  const total = pdf.getNumberOfPages();
  const footer = pdfSafe(`Exported ${fmtDateTime(data.exportedAt)} by ${data.exportedBy} · Rev ${data.revision}`);
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...MUTED);
    pdf.text(footer, M, PAGE.h - M + 8);
    pdf.text(`Page ${p} of ${total}`, PAGE.w - M, PAGE.h - M + 8, { align: 'right' });
  }

  return pdf.output('blob');
}
