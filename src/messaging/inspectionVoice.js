// Inspections by voice (sitesnap-inspections-spec.md section 5): what the foreman's words mean on a question.
// Plain function, no imports, so tests can run it in Node.
/** Voice commands: "pass", "fail", "not applicable" / "N/A" choose that answer; anything else is a note */
export function voiceCommand(words) {
  const t = String(words ?? "").toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(section )?(is )?(not applicable|n ?\/? ?a|n a|na)( section)?$/.test(t) && /section/.test(t)) return { section: "na" };
  if (/^(it )?(passes|passed|pass|conforming|good|ok|okay)$/.test(t)) return { counts: "pass" };
  if (/^(it )?(fails|failed|fail|deficient)$/.test(t)) return { counts: "fail" };
  if (/^(not applicable|n ?\/? ?a|n a|na|doesn't apply|does not apply)$/.test(t)) return { counts: "na" };
  return null;
}
