// Deepgram speech-to-text (batch / pre-recorded). Shared by stop transcription and
// wrap-up notes. The API key is a Functions secret and never leaves the server.
const { defineSecret } = require("firebase-functions/params");

const DEEPGRAM_API_KEY = defineSecret("DEEPGRAM_API_KEY");
const MODEL = "nova-3";

// Trade vocabulary Deepgram should favor. One list for every transcription path.
const KEYTERMS = [
  "Verkada", "Avigilon", "Axis", "Hanwha", "Genetec", "Milestone",
  "Brivo", "Openpath", "Lenel", "HID", "Aiphone", "Ubiquiti", "Meraki",
  "Cat6", "IDF", "MDF", "PoE", "PoE switch", "NVR", "VMS",
  "mag lock", "REX", "door contact", "card reader", "conduit", "J-hook",
];

/**
 * Transcribe one recording. Returns { text, confidence, duration, model }.
 * In the Functions emulator with PICTALK_FAKE_STT=1, returns a stand-in transcript
 * (no Deepgram call, no cost). FUNCTIONS_EMULATOR is only set by the emulator.
 */
async function transcribeAudio(audio, contentType) {
  if (process.env.FUNCTIONS_EMULATOR === "true" && process.env.PICTALK_FAKE_STT === "1") {
    return { text: `Test transcript (${audio.length} bytes of audio).`, confidence: 1, duration: null, model: "emulator-stand-in" };
  }
  const params = new URLSearchParams({ model: MODEL, smart_format: "true" });
  KEYTERMS.forEach((t) => params.append("keyterm", t));
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY.value()}`,
      "Content-Type": contentType || "audio/webm",
    },
    body: audio,
  });
  if (!res.ok) {
    throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  }
  const result = await res.json();
  const alt = result?.results?.channels?.[0]?.alternatives?.[0] || {};
  return {
    text: (alt.transcript || "").trim(),
    confidence: alt.confidence ?? null,
    duration: result?.metadata?.duration ?? null,
    model: MODEL,
  };
}

module.exports = { DEEPGRAM_API_KEY, KEYTERMS, MODEL, transcribeAudio };
