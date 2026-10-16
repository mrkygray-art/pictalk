// Daily log by voice (docs/closeout-and-daily-log-spec.md, B4): organizeDailyLog. The app sends what the foreman
// said plus the project's own lists (companies, delay types, locations: names and ids only) and gets back the
// four sections for the review screen. functions/dailyLogParser.js decides what's kept; nothing is written
// anywhere, and the words are never logged.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const Anthropic = require("@anthropic-ai/sdk");
const { reserveGlobalAi, piccoloCallable } = require("./budget");
const { photoHelpers } = require("./photo");
const { requireMember } = require("./messaging");
const parser = require("./dailyLogParser");

const { ANTHROPIC_API_KEY } = photoHelpers;
const MODEL = "claude-opus-5-5";
const fake = () => process.env.FUNCTIONS_EMULATOR === "true" && process.env.PICTALK_FAKE_AI === "1";

// The lists, trimmed to what the parser needs (and capped, so a huge project can't blow up the prompt)
function cleanContext(c = {}) {
  const val = (k, v) => (v == null ? null : k === "id" && Number.isFinite(Number(v)) ? Number(v) : String(v).slice(0, 120));
  const pick = (list, max) => (Array.isArray(list) ? list : []).slice(0, max).map((x) => ({ id: val("id", x?.id), name: val("name", x?.name) })).filter((x) => x.name);
  const mine = c.myCompany && c.myCompany.name ? { id: val("id", c.myCompany.id), name: val("name", c.myCompany.name) } : null;
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(c.date ?? "")) ? c.date : "",
    timeZone: typeof c.timeZone === "string" ? c.timeZone.slice(0, 60) : "",
    myCompany: mine,
    companies: pick(c.companies, 300),
    delayTypes: pick(c.delayTypes, 60),
    locations: pick(c.locations, 500),
  };
}

async function organize(transcript, context) {
  const input = { transcript, context };
  if (fake()) return parser.validate(parser.fakeAnswer(input), input);
  await reserveGlobalAi("dailyLog"); // the daily AI limit: the app shows its message
  // B4: on invalid output retry once, then fall back to one Note
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: parser.SCHEMA } },
        system: parser.SYSTEM,
        messages: [{ role: "user", content: parser.buildPrompt(input) }],
      });
      if (response.stop_reason === "refusal") return parser.fallback(transcript, "refusal");
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      return parser.validate(JSON.parse(text), input);
    } catch (err) {
      logger.error("Daily log organize failed", { attempt, error: err.message });
    }
  }
  return parser.fallback(transcript, "model unavailable");
}
exports.organize = organize;

exports.organizeDailyLog = onCall(
  piccoloCallable({ region: "us-west2", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: "512MiB" }),
  async (request) => {
    const { key, transcript, context } = request.data ?? {};
    await requireMember(request, key);
    const words = String(transcript ?? "").slice(0, 8000);
    if (!words.trim()) throw new HttpsError("invalid-argument", "Say or type your update first.");
    return organize(words, cleanContext(context));
  },
);
