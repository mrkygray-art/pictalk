import { useEffect, useRef } from "react";

// Bottom sheet for questions. Tap outside or press Escape to close.
export default function Sheet({ title, onClose, children }) {
  const sheet = useRef(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    sheet.current?.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
    const onKey = (e) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="sheet-shade" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
