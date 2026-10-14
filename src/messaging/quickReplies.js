// Quick replies: one tap to answer a message, no photo, voice or typing needed (a photo, voice note or
// note can go with one). Ky wants these checked with real tradespeople, so they live here only:
// change a label or the order here and every screen follows. A new `code` needs nothing else
// (the Firestore rules only check its length).
//   code:   saved on the message (status.code); keep it stable once people use it
//   label:  the button, in plain trades words
//   told:   what the sender sees in the thread and on the feed card
export const QUICK_REPLIES = [
  { code: "done", label: "Done", told: "Marked done" },
  { code: "on_it", label: "On it", told: "On it" },
  { code: "delayed", label: "Delayed", told: "Delayed" },
  { code: "need_info", label: "Need info", told: "Needs info" },
  { code: "waiting_materials", label: "Waiting on materials", told: "Waiting on materials" },
  { code: "waiting_someone", label: "Waiting on someone", told: "Waiting on someone" },
  { code: "cant_do", label: "Can't do this", told: "Can't do this" },
  { code: "on_my_way", label: "On my way", told: "On my way" },
];

// Shown as buttons; the rest sit behind More, so the screen stays clean
export const MAIN_REPLIES = ["done", "on_it", "delayed", "need_info"];

// Delayed asks why and for a new date; both optional, so it never holds anyone up
export const DELAY_REASONS = ["Weather", "Materials", "Manpower", "Waiting on another trade", "Inspection", "Other"];

export const replyFor = (code) => QUICK_REPLIES.find((r) => r.code === code) ?? null;

/** The status saved on a message: { code, label, reason?, newDate? } */
export function statusOf(reply, extra = {}) {
  const st = { code: reply.code, label: reply.told };
  if (extra.reason) st.reason = extra.reason.slice(0, 60);
  if (extra.newDate) st.newDate = extra.newDate.slice(0, 20);
  return st;
}
