// Voice + photo -> Procore record (SPEC_voice-photo-to-procore-record), Step 2: classifyCapture.
// The app sends what the foreman said plus the project's own lists (Observation types, trades,
// locations, people: names, companies and titles only, no email or phone) and gets back a draft for
// the confirmation card. functions/classifier.js decides what's kept; nothing is written anywhere.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const Anthropic = require("@anthropic-ai/sdk");
const { reserveGlobalAi, piccoloCallable } = require("./budget");
const { photoHelpers } = require("./photo");
const { requireMember } = require("./messaging");
const classifier = require("./classifier");

const { ANTHROPIC_API_KEY } = photoHelpers;
const MODEL = "claude-opus-5-5";
const fake = () => process.env.FUNCTIONS_EMULATOR === "true" && process.env.PICTALK_FAKE_AI === "1";

// The lists, trimmed to what the classifier needs (and capped, so a huge project can't blow up the prompt)
function cleanContext(c = {}) {
  // ids stay numbers (Procore's), everything else short text
  const val = (k, v) => (v == null ? null : k === "id" && Number.isFinite(Number(v)) ? Number(v) : String(v).slice(0, 120));
  const pick = (list, keys, max) => (Array.isArray(list) ? list : []).slice(0, max).map((x) => Object.fromEntries(keys.map((k) => [k, val(k, x?.[k])])));
  return {
    projectName: String(c.projectName ?? "").slice(0, 120),
    timeZone: typeof c.timeZone === "string" ? c.timeZone.slice(0, 60) : undefined,
    observationTypes: pick(c.observationTypes, ["id", "name", "category"], 100),
    trades: pick(c.trades, ["id", "name"], 200),
    locations: pick(c.locations, ["id", "name"], 500),
    people: pick(c.people, ["id", "name", "company", "title", "role"], 2000),
  };
}

async function classify(transcript, context, now = new Date()) {
  const input = { transcript, context, now };
  if (fake()) return classifier.validate(classifier.fakeAnswer(input), input);
  try {
    await reserveGlobalAi("classify");
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: classifier.SCHEMA } },
      system: classifier.SYSTEM,
      messages: [{ role: "user", content: classifier.buildPrompt(input) }],
    });
    if (response.stop_reason === "refusal") return classifier.fallback(transcript, "refusal");
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return classifier.fromModelText(text, input);
  } catch (err) {
    if (err instanceof HttpsError) throw err; // the daily AI limit
    logger.error("Classifier call failed", { error: err.message });
    return classifier.fallback(transcript, "model unavailable");
  }
}
exports.classify = classify;

exports.classifyCapture = onCall(
  piccoloCallable({ region: "us-west2", secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: "512MiB" }),
  async (request) => {
    const { key, transcript, context } = request.data ?? {};
    await requireMember(request, key);
    const words = String(transcript ?? "").slice(0, 8000);
    if (!words.trim()) throw new HttpsError("invalid-argument", "Say or type what you see first.");
    return classify(words, cleanContext(context));
  },
);
