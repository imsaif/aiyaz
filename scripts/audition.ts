// Renders the Aiyaz lines in several ElevenLabs voices and two models, so a person can compare by ear.
// Calls the ElevenLabs HTTP API directly, so it does not need LiveKit. Prints voice names and ids only,
// never the key. Sends each voice+model ONE request (all lines joined by short pauses) to keep credits low.
import { mkdirSync, writeFileSync } from "node:fs";
import { forCountry, loadSettings } from "../src/config.js";
import { WRAP_UP } from "../src/conversation.js";
import { formatPrice, openingLine } from "../src/prompt.js";

const base = loadSettings();
const LINES = [
  openingLine(base, null),
  "Got it. When the assistant gives a wrong answer, what does your customer do next?",
  "My guess is the model is answering from memory instead of your own data. Does that match what you see?",
  `The sprint is a fixed price of ${formatPrice(forCountry(base, "AE").sprintPrice)}.`,
  `The sprint is a fixed price of ${formatPrice(forCountry(base, "IN").sprintPrice)}.`,
  WRAP_UP.time_limit,
];

// Warm, natural, professional female voices from the ElevenLabs premade library.
const DEFAULT_VOICES: Array<{ name: string; id: string }> = [
  { name: "sarah", id: "EXAVITQu4vr4xnSDxMaL" },
  { name: "jessica", id: "cgSgspJ2msm6clMCkdW9" },
  { name: "alice", id: "Xb7hH8MSUJpSbSDYk0k2" },
  { name: "bella", id: "hpp4J3VqNfWAUOO0d1Us" },
];
const override = (process.env.AUDITION_ELEVEN_VOICE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const VOICES = override.length ? override.map((id) => ({ name: id, id })) : DEFAULT_VOICES;

// Fast slot is what a live call wants; the flash id falls back to turbo if the API rejects it.
const MODELS = [
  { slot: "flash", ids: ["eleven_flash_v2_5", "eleven_turbo_v2_5"] },
  { slot: "multilingual", ids: ["eleven_multilingual_v2"] },
];

// Natural conversational delivery: some variation, no exaggerated style.
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.75, style: 0, use_speaker_boost: true };
const TEXT = LINES.join(' <break time="0.9s" /> ');

const key = process.env.ELEVEN_API_KEY;
if (!key) {
  console.error("ELEVEN_API_KEY is not set");
  process.exit(1);
}

mkdirSync("auditions", { recursive: true });
let characters = 0;
for (const voice of VOICES) {
  for (const model of MODELS) {
    for (const modelId of model.ids) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ text: TEXT, model_id: modelId, voice_settings: VOICE_SETTINGS }),
      });
      if (!res.ok) {
        console.error(`${voice.name} ${modelId} ${res.status}: ${await res.text()}`);
        continue;
      }
      const file = `auditions/${voice.name}__${modelId}__all.mp3`;
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      characters += TEXT.length;
      console.log(`wrote ${file}`);
      break;
    }
  }
}
console.log(`characters sent: ${characters}`);
