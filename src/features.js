// Feature switches for this build. Piccolo (the work order / parts / quote pane) is off for
// SiteSnap AI; its code stays. Turn it on with VITE_FEATURE_PICCOLO=1 (a switch, not a secret).
export const PICCOLO = import.meta.env.VITE_FEATURE_PICCOLO === "1";
