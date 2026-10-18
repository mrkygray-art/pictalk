// Feature switches for this build. Piccolo (the work order / parts / quote pane) is off for
// SiteSnap AI; its code stays. Turn it on with VITE_FEATURE_PICCOLO=1 (a switch, not a secret).
export const PICCOLO = import.meta.env.VITE_FEATURE_PICCOLO === "1";

// SiteSnap AI is project messaging (sign in with Procore, conversations, New Message). The earlier
// job / stop screens (My Jobs, Start New Job, Save This Stop, End Job, Recent jobs, the ? help and its
// guide, Reset Example Jobs) stay in the code and come back with VITE_FEATURE_JOBS=1.
export const JOBS = import.meta.env.VITE_FEATURE_JOBS === "1";
export const MESSAGING = !JOBS;

// Ask: the SiteSnap Guide in a panel on the sign-in screen and the project home (docs/ask-guide-spec.md).
// Off unless VITE_FEATURE_ASK=1; off = no Ask button and no panel.
export const ASK = import.meta.env.VITE_FEATURE_ASK === "1";

// The AI photo description (the purple box): hidden for now, functions and saved text kept.
// Set to true to bring back the "Describe photo with AI" button and the description in threads.
export const SHOW_AI_PHOTO_DESCRIPTION = false;
