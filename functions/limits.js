// Accounts with no daily per-account AI limits (Piccolo drafts, job summaries, photo
// descriptions): the app owner's, listed by email in UNLIMITED_AI_EMAILS (comma-separated).
// Set it in functions/.env, which is git-ignored, so the address never reaches the public
// repo. Per-job / per-stop limits and the global daily cap (budget.js) still apply.
const { getAuth } = require("firebase-admin/auth");

const listed = () =>
  String(process.env.UNLIMITED_AI_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** True when the signed-in account's verified email is on the list. */
async function isUnlimited(uid) {
  const emails = listed();
  if (!emails.length || !uid) return false;
  try {
    const user = await getAuth().getUser(uid);
    return !!user.email && user.emailVerified && emails.includes(user.email.toLowerCase());
  } catch {
    return false;
  }
}

exports.isUnlimited = isUnlimited;
