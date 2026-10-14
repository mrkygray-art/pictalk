// Plain-words formatting for the feed and conversation screens
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "";
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function namesLine(people, max = 3) {
  const names = (people ?? []).map((p) => p.name).filter(Boolean);
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} other${names.length - max === 1 ? "" : "s"}`;
}

export function summaryLine(c) {
  const lm = c.lastMessage ?? {};
  const replies = Math.max(0, (c.messageCount ?? 1) - 1);
  return [
    lm.photoCount ? `${lm.photoCount} photo${lm.photoCount === 1 ? "" : "s"}` : null,
    lm.hasVoice ? "voice note" : null,
    replies ? `${replies} repl${replies === 1 ? "y" : "ies"}` : null,
  ].filter(Boolean).join(" · ");
}
