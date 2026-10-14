// Feature switches for this build. Piccolo (the work order / parts / quote pane) is off for
// SiteSnap AI; its code stays. Turn it on with VITE_FEATURE_PICCOLO=1 (a switch, not a secret).
export const PICCOLO = import.meta.env.VITE_FEATURE_PICCOLO === "1";

// SiteSnap AI is project messaging (sign in with Procore, conversations, New Message). The earlier
// job / stop screens (My Jobs, Start New Job, Save This Stop, End Job, Recent jobs, the ? help and its
// guide, Reset Example Jobs) stay in the code and come back with VITE_FEATURE_JOBS=1.
export const JOBS = import.meta.env.VITE_FEATURE_JOBS === "1";
export const MESSAGING = !JOBS;
