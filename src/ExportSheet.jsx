import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import { jobTitle } from "./jobStore";
import {
  buildJobExport, loadPhotos, recordExport, exportFileName, canShareFile, deliverFile, uploadExport,
  getSavedInitials, saveInitials, cleanInitials, PhotoLoadError, ANONYMOUS_NAME,
} from "./exportJob";
import { renderJobPdf } from "./renderJobPdf";

// Export a job as a PDF: ask for initials once, build with progress, then Share (phones)
// or Download (desktop). Sharing needs a fresh tap, so it's a separate button rather
// than happening automatically after the build.
export default function ExportSheet({ job, uid, onClose, onDone }) {
  const saved = getSavedInitials();
  const [step, setStep] = useState(saved === null ? "initials" : "building");
  const [initials, setInitials] = useState(saved ?? "");
  const [progress, setProgress] = useState(null); // { done, total }
  const [file, setFile] = useState(null);
  const [remoteUrl, setRemoteUrl] = useState(null); // uploaded copy, so downloads keep their name
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    if (step !== "building") return;
    let stop = false;
    (async () => {
      try {
        const { data, photoSources } = await buildJobExport({ uid, jobId: job.id, initials: cleanInitials(initials) });
        const photos = await loadPhotos(photoSources, (done, total) => !stop && setProgress({ done, total }));
        const blob = await renderJobPdf(data, photos);
        if (stop) return; // closed or restarted while building
        recordExport(uid, job.id);
        const pdf = new File([blob], exportFileName(data), { type: "application/pdf" });
        // Phones that can't share get the PDF through an uploaded copy, so the name sticks
        let url = null;
        if (!canShareFile(pdf) && navigator.onLine) {
          setPreparing(true);
          url = await uploadExport(uid, job.id, pdf).catch((err) => {
            console.warn("PDF upload failed; downloading from the page instead:", err);
            return null;
          });
          if (stop) return;
          setPreparing(false);
        }
        setRemoteUrl(url);
        setFile(pdf);
        setStep("ready");
      } catch (err) {
        if (stop) return;
        setPreparing(false);
        console.error("Export failed:", err);
        setProblem(
          err instanceof PhotoLoadError
            ? `${err.failed === err.total ? "The photos" : `${err.failed} of ${err.total} photos`} couldn't be loaded, so no PDF was made. Connect to the internet and try again.`
            : "Something went wrong building the PDF. Please try again."
        );
        setStep("problem");
      }
    })();
    return () => {
      stop = true;
    };
  }, [step, uid, job.id, initials]);

  const title = jobTitle(job);

  if (step === "initials") {
    return (
      <Sheet title="Your initials" onClose={onClose}>
        <form
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            setInitials(saveInitials(initials));
            setStep("building");
          }}
        >
          <p>These appear on your PDFs as who captured and exported the job. Optional, and saved on this phone.</p>
          <div className="detail-fields">
            <label>
              Initials
              <input
                value={initials}
                maxLength={4}
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                placeholder={`Blank = ${ANONYMOUS_NAME}`}
                onChange={(e) => setInitials(e.target.value.toUpperCase())}
              />
            </label>
          </div>
          <button type="submit" className="big-btn photo-btn">
            Continue
          </button>
          <button type="button" className="text-btn" onClick={onClose}>
            Cancel
          </button>
        </form>
      </Sheet>
    );
  }

  if (step === "building") {
    return (
      <Sheet title="Building PDF…" onClose={onClose}>
        <p className="progress-text" role="status" aria-live="polite">
          {preparing
            ? "Getting the download ready…"
            : progress && progress.total > 0
              ? `Building PDF… ${progress.done} of ${progress.total} photos`
              : "Getting the job ready…"}
        </p>
        <div className="progress-bar" aria-hidden="true">
          <span style={{ width: `${progress?.total ? (progress.done / progress.total) * 100 : 5}%` }} />
        </div>
        <button className="big-btn plain-btn" onClick={onClose}>
          Cancel
        </button>
      </Sheet>
    );
  }

  if (step === "problem") {
    return (
      <Sheet title="PDF not made" onClose={onClose}>
        <p>{problem}</p>
        <button className="big-btn photo-btn" onClick={() => { setProblem(""); setProgress(null); setStep("building"); }}>
          Try Again
        </button>
        <button className="big-btn plain-btn" onClick={onClose}>
          Close
        </button>
      </Sheet>
    );
  }

  // ready. Computers download first (Windows' share window can't save a file);
  // phones share first, since that's how a PDF gets sent from a phone.
  const share = canShareFile(file);
  const computer = window.matchMedia?.("(pointer: fine)").matches;
  const deliver = async (download) => {
    const how = await deliverFile(file, title, remoteUrl, { download });
    if (how !== "cancelled") onDone(how);
  };
  return (
    <Sheet title="PDF ready" onClose={onClose}>
      <p>{file.name}</p>
      {share && computer ? (
        <>
          <button className="big-btn photo-btn" onClick={() => deliver(true)}>
            Download PDF
          </button>
          <button className="big-btn plain-btn" onClick={() => deliver(false)}>
            Share PDF
          </button>
        </>
      ) : (
        <button className="big-btn photo-btn" onClick={() => deliver(false)}>
          {share ? "Share PDF" : "Download PDF"}
        </button>
      )}
      <button className="big-btn plain-btn" onClick={onClose}>
        Close
      </button>
      <button
        className="text-btn"
        onClick={() => {
          setFile(null);
          setStep("initials");
        }}
      >
        Change initials ({cleanInitials(initials) || ANONYMOUS_NAME})
      </button>
    </Sheet>
  );
}
