import { useState } from "react";
import Sheet from "../Sheet";
import { canShareFile, deliverFile } from "../exportJob";
import { finalMediaLinks } from "./piccoloStore";
import { exportSource, piccoloFileName, partsCsv, quoteCsv, packageJson } from "./piccoloExport";

const fmt = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Check, then save the current version as the next final. Guests are asked to sign in first. */
export function FinalizeSheet({ warnings, nextVersion, isGuest, onAccount, onFinalize, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (isGuest) {
    return (
      <Sheet title="Save your work to finalize" onClose={onClose}>
        <p>A final is a permanent record of this job, with its photos and audio. Sign in to keep it. You can still export a copy marked DEMO.</p>
        <button className="big-btn photo-btn" onClick={onAccount}>
          Save My Work
        </button>
        <button className="text-btn" onClick={onClose}>
          Not now
        </button>
      </Sheet>
    );
  }
  return (
    <Sheet title={`Finalize version ${nextVersion}?`} onClose={() => !busy && onClose()}>
      <p>
        This saves the work order, parts list, and quote as version {nextVersion}, with the job's photos, audio, and notes. It can't be changed later; new
        edits become version {nextVersion + 1}.
      </p>
      {warnings.length > 0 && (
        <div className="pc-warnings" role="alert">
          <strong>Before you finalize:</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w.kind}>{w.text}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button
        className="big-btn photo-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onFinalize();
          } catch (err) {
            setError(err.message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving photos and audio…" : warnings.length ? `Finalize Anyway (v${nextVersion})` : `Finalize v${nextVersion}`}
      </button>
      <button className="big-btn plain-btn" disabled={busy} onClick={onClose}>
        {warnings.length ? "Go Back and Fix" : "Cancel"}
      </button>
    </Sheet>
  );
}

const FORMATS = [
  ["pdf", "PDF", "pdf", "application/pdf"],
  ["parts", "Parts list (CSV)", "csv", "text/csv"],
  ["quote", "Quote (CSV)", "csv", "text/csv"],
  ["json", "Full package (JSON)", "json", "application/json"],
];

/**
 * Export the current version (marked DRAFT) or any final as PDF, CSV, or JSON, then share
 * or download it. Sharing needs a fresh tap, so it's a second step like PicTalk's PDF.
 */
export function ExportSheet({ jobId, ownerUid, base, finals, isGuest, initialChoice, onClose, onDone }) {
  const [choice, setChoice] = useState(initialChoice || (finals[0] ? finals[0].id : "current"));
  const [sections, setSections] = useState({ workorder: true, bom: true, quote: true });
  const [busy, setBusy] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");

  const final = finals.find((f) => f.id === choice) || null;
  const src = exportSource({ ...base, final, isGuest });

  const build = async (format) => {
    setBusy(format);
    setError("");
    try {
      const [, label, ext, type] = FORMATS.find((f) => f[0] === format);
      let body;
      let name;
      if (format === "pdf") {
        const { renderPiccoloPdf } = await import("./renderPiccoloPdf");
        body = await renderPiccoloPdf(src, sections);
        const what = sections.workorder && sections.bom && sections.quote ? "Job-Package" : [sections.workorder && "Work-Order", sections.bom && "Parts", sections.quote && "Quote"].filter(Boolean).join("-");
        name = piccoloFileName(src, what, ext);
      } else if (format === "parts") {
        body = partsCsv(src);
        name = piccoloFileName(src, "Parts", ext);
      } else if (format === "quote") {
        body = quoteCsv(src);
        name = piccoloFileName(src, "Quote", ext);
      } else {
        const links = final && !isGuest ? await finalMediaLinks(jobId, final.id, ownerUid) : {};
        body = packageJson(src, links);
        name = piccoloFileName(src, "Package", ext);
      }
      setFile({ file: new File([body], name, { type }), label });
    } catch (err) {
      console.error("Piccolo export failed:", err);
      setError("Couldn't build that file. Please try again.");
    } finally {
      setBusy("");
    }
  };

  if (file) {
    const share = canShareFile(file.file);
    const computer = window.matchMedia?.("(pointer: fine)").matches;
    const deliver = async (download) => {
      const how = await deliverFile(file.file, file.file.name, null, { download });
      if (how !== "cancelled") onDone(how);
    };
    return (
      <Sheet title={`${file.label} ready`} onClose={onClose}>
        <p className="pc-file-name">{file.file.name}</p>
        {share && computer ? (
          <>
            <button className="big-btn photo-btn" onClick={() => deliver(true)}>
              Download
            </button>
            <button className="big-btn plain-btn" onClick={() => deliver(false)}>
              Share
            </button>
          </>
        ) : (
          <button className="big-btn photo-btn" onClick={() => deliver(false)}>
            {share ? "Share" : "Download"}
          </button>
        )}
        <button className="big-btn plain-btn" onClick={() => setFile(null)}>
          Export Something Else
        </button>
        <button className="text-btn" onClick={onClose}>
          Close
        </button>
      </Sheet>
    );
  }

  const noSections = !sections.workorder && !sections.bom && !sections.quote;
  return (
    <Sheet title="Export" onClose={() => !busy && onClose()}>
      <div className="detail-fields">
        <label>
          Which version
          <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!!busy}>
            {finals.map((f) => (
              <option key={f.id} value={f.id}>
                Final v{f.version} · {fmt(f.finalizedAt)}
              </option>
            ))}
            <option value="current">Current version (marked DRAFT)</option>
          </select>
        </label>
      </div>
      {isGuest && <p className="pc-hint">Guest exports are marked DEMO. Save your work to export clean copies.</p>}
      <fieldset className="pc-checks">
        <legend>In the PDF</legend>
        {[
          ["workorder", "Work order (no prices)"],
          ["bom", "Parts list"],
          ["quote", "Quote"],
        ].map(([k, label]) => (
          <label key={k}>
            <input type="checkbox" checked={sections[k]} onChange={(e) => setSections({ ...sections, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      {FORMATS.map(([id, label]) => (
        <button
          key={id}
          className={id === "pdf" ? "big-btn photo-btn" : "big-btn plain-btn"}
          disabled={!!busy || (id === "pdf" && noSections)}
          onClick={() => build(id)}
        >
          {busy === id ? "Building…" : label}
        </button>
      ))}
      <p className="pc-hint">The parts list CSV includes your costs; the quote CSV and PDF don't.</p>
      <button className="text-btn" disabled={!!busy} onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}
