// Runs the capture classifier (functions/classifier.js) against the real Claude API on the spec's sample
// utterances, with the sandbox project's lists, and checks each against what the spec expects.
// Run: ANTHROPIC_API_KEY=... node scripts/classify-eval.cjs   (about 5 short calls)
const path = require("path");
const Anthropic = require(path.join(__dirname, "..", "functions", "node_modules", "@anthropic-ai", "sdk"));
const c = require("../functions/classifier.js");

const context = {
  projectName: "1234 - Sandbox Test Project",
  // The sandbox company's 22 Observation types (from the Step 1 test)
  observationTypes: [
    ["Commissioning", "Commissioning"], ["Air Quality", "Environmental"], ["Cultural Heritage", "Environmental"], ["Hazardous Materials", "Environmental"],
    ["Noise", "Environmental"], ["Spill", "Environmental"], ["Storm Water", "Environmental"], ["Vegetation", "Environmental"],
    ["Waste Management", "Environmental"], ["Wildlife", "Environmental"], ["Corrective Action", "Quality"], ["Deficiency", "Quality"],
    ["Non-Conformance", "Quality"], ["Pre-Punch", "Quality"], ["Corrective Action", "Safety"], ["Near Miss", "Safety"],
    ["Preventative Action", "Safety"], ["Safety Hazard", "Safety"], ["Safety Notice", "Safety"], ["Safety Violation", "Safety"],
    ["Service Call", "Warranty"], ["Work to Complete", "Work to Complete"],
  ].map(([name, category], i) => ({ id: 1000 + i, name, category })),
  trades: ["Concrete", "Drywall", "Electrical", "Fire Protection", "HVAC", "Painting", "Plumbing", "Roofing"].map((name, i) => ({ id: i + 1, name })),
  locations: [],
  people: [
    { id: 481274, name: "Edward Gray", company: "Kyco", title: null },
    { id: 900, name: "Lisa Hubbard", company: null, title: null },
    { id: 901, name: "John Bohaman", company: null, title: null },
    { id: 902, name: "Jim Henson", company: null, title: null },
    { id: 903, name: "Test Architect", company: null, title: null },
    { id: 904, name: "Test Subcontractor", company: null, title: null },
  ],
};
const NOW = new Date(2026, 9, 14, 9, 0); // Wednesday

const CASES = [
  ["Paint touch up on the wall by the stairwell on level two.", (r) => r.record_type === "punch_item" && r.trade?.name === "Painting" && /level 2|level two/i.test(r.location_text ?? "") && /stair/i.test(r.location_text ?? "")],
  ["Fire caulking is missing around the pipe penetrations in the electrical room.", (r) => r.record_type === "observation" && r.priority === "high" && /electrical room/i.test(r.location_text ?? "")],
  ["Duct is in the way of our conduit, we need to reroute, two guys half a day.", (r) => r.record_type === "observation" && r.impact_mentioned && /two guys|half a day/i.test(r.impact_notes ?? "")],
  ["Tell Lisa the drywall in room 204 needs to be redone by Friday.", (r) => r.record_type === "punch_item" && r.assignees.some((a) => a.name === "Lisa Hubbard") && r.due_date === "2026-10-16" && /204/.test(r.location_text ?? "")],
  ["Something's off back there.", (r) => r.low_confidence && !r.trade && !r.assignees.length],
];

(async () => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let passed = 0;
  for (const [transcript, ok] of CASES) {
    const input = { transcript, context, now: NOW };
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5", max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: c.SCHEMA } },
      system: c.SYSTEM, messages: [{ role: "user", content: c.buildPrompt(input) }],
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const r = c.fromModelText(text, input);
    const good = ok(r);
    if (good) passed++;
    console.log(`${good ? "PASS" : "FAIL"}  "${transcript}"`);
    console.log(`      ${r.record_type}${r.suggested_record_type !== r.record_type ? ` (suggested ${r.suggested_record_type})` : ""} · conf ${r.confidence} · "${r.title}" · type ${r.observation_type?.name ?? "-"} · trade ${r.trade?.name ?? "-"} · where "${r.location_text ?? "-"}" · ${r.priority ?? "-"} · to ${r.assignees.map((a) => a.name).join(", ") || "-"} · due ${r.due_date ?? "-"}${r.impact_mentioned ? ` · impact "${r.impact_notes}"` : ""}`);
    console.log(`      missing: ${r.missing_fields.join(", ") || "none"}${r.fallback ? " · FALLBACK" : ""}`);
  }
  console.log(`\n${passed} of ${CASES.length} sample utterances classified as the spec expects`);
})().catch((e) => { console.error(e.message); process.exit(1); });
