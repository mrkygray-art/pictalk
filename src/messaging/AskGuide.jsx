import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CloseIcon, QuestionIcon } from "./icons";

// Ask: the SiteSnap Guide (a separate chatbot service) in a panel (docs/ask-guide-spec.md). This only frames it:
// a fixed address, no referrer (SiteSnap's own link carries company and project ids), nothing about the person.
// One component for every screen size, laid out by CSS only, so rotating or resizing never moves or reloads the
// frame: a bottom sheet on phones (modal: dim backdrop, page locked, Tab stays inside), a right-side panel from
// 768 px wide and 501 px tall (not modal; the page stays usable). A phone in landscape stays a (full-height) sheet.
const GUIDE = "https://sitesnap-guide.mrkygray.workers.dev/";
const SLOW_MS = 10000;
const WIDE = "(min-width: 768px) and (min-height: 501px)";

export function AskButton({ onOpen, buttonRef }) {
  return (
    <button type="button" ref={buttonRef} className="ask-btn" onClick={onOpen} aria-haspopup="dialog">
      <span className="ask-btn-pill"><QuestionIcon />Ask</span>
    </button>
  );
}

// open: shown now. The parent renders this from the first open on and keeps it, so the conversation survives
// closing and reopening. returnTo: the Ask button's ref (focus goes back there on close).
export function AskPanel({ open, onClose, returnTo }) {
  const wide = useMedia(WIDE);
  const modal = !wide;
  const online = useOnline();
  const [frameOn, setFrameOn] = useState(false); // the iframe exists (first open with a connection), then stays
  const [load, setLoad] = useState("loading"); // loading | ready | failed
  const [attempt, setAttempt] = useState(0); // Try again makes a fresh frame
  const layer = useRef(null);
  const panel = useRef(null);
  const closeBtn = useRef(null);
  const wasOpen = useRef(false);

  if (open && online && !frameOn) setFrameOn(true);

  // 10 seconds without the frame loading = "could not load"
  useEffect(() => {
    if (!frameOn || !online || load !== "loading") return undefined;
    const t = setTimeout(() => setLoad("failed"), SLOW_MS);
    return () => clearTimeout(t);
  }, [frameOn, online, load, attempt]);

  // Focus into the panel on open, back to the Ask button on close
  useEffect(() => {
    if (open) closeBtn.current?.focus({ preventScroll: true });
    else if (wasOpen.current) returnTo?.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, returnTo]);

  // Phone sheet: the page behind doesn't scroll, and the sheet fits the part of the screen the keyboard leaves
  // (iOS Safari doesn't resize the page for the keyboard; visualViewport says what's visible)
  useEffect(() => {
    if (!open || !modal) return undefined;
    const root = document.documentElement;
    root.classList.add("ask-locked");
    const vv = window.visualViewport;
    const el = layer.current;
    const fit = () => {
      if (!vv || !el) return;
      el.style.setProperty("--ask-vh", `${vv.height}px`);
      el.style.setProperty("--ask-top", `${vv.offsetTop}px`);
    };
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    return () => {
      root.classList.remove("ask-locked");
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      el?.style.removeProperty("--ask-vh");
      el?.style.removeProperty("--ask-top");
    };
  }, [open, modal]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  // Phone (modal): Tab past either end wraps around inside the panel
  const wrapFocus = (e) => {
    const list = [...(panel.current?.querySelectorAll("button, a[href], iframe") ?? [])];
    (e.currentTarget.dataset.to === "first" ? list[0] : list[list.length - 1])?.focus();
  };
  const retry = () => {
    setAttempt((n) => n + 1);
    setLoad("loading");
  };

  return (
    <div ref={layer} className={`ask-layer${wide ? " is-wide" : ""}`} hidden={!open} onKeyDown={onKeyDown}>
      <div className="ask-shade" onClick={onClose} aria-hidden="true" />
      <section ref={panel} className="ask-panel" role="dialog" aria-modal={modal ? "true" : undefined} aria-labelledby="ask-title">
        <span className="ask-trap" tabIndex={modal ? 0 : -1} data-to="last" onFocus={wrapFocus} />
        <div className="ask-head">
          <h2 id="ask-title">Ask the SiteSnap Guide</h2>
          <button type="button" ref={closeBtn} className="ask-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <p className="ask-note">Questions are saved to improve this guide.</p>
        <div className="ask-body">
          {frameOn && (
            <iframe
              key={attempt}
              src={`${GUIDE}?embed=1`}
              title="SiteSnap Guide"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms"
              onLoad={() => setLoad("ready")}
            />
          )}
          {!online ? (
            <div className="ask-state"><p>The guide needs a connection. Your other SiteSnap features still work.</p></div>
          ) : load === "failed" ? (
            <div className="ask-state">
              <p>The guide could not load.</p>
              <button type="button" className="ask-retry" onClick={retry}>Try again</button>
              <a className="text-btn" href={GUIDE} target="_blank" rel="noopener noreferrer">Open in a new tab</a>
            </div>
          ) : load === "loading" ? (
            <div className="ask-state" role="status"><p>Loading the guide...</p></div>
          ) : null}
        </div>
        <span className="ask-trap" tabIndex={modal ? 0 : -1} data-to="first" onFocus={wrapFocus} />
      </section>
    </div>
  );
}

function useMedia(query) {
  return useSyncExternalStore(
    (change) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", change);
      return () => m.removeEventListener("change", change);
    },
    () => window.matchMedia(query).matches,
  );
}

function useOnline() {
  return useSyncExternalStore(
    (change) => {
      window.addEventListener("online", change);
      window.addEventListener("offline", change);
      return () => {
        window.removeEventListener("online", change);
        window.removeEventListener("offline", change);
      };
    },
    () => navigator.onLine,
  );
}
