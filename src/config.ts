// Every setting lives here. Anything that might change later is an env var.

export type Currency = "AED" | "USD";
export type SprintPrice = { amount: number; currency: Currency };
// Which price and pack a visitor gets. Must match priceFor() in the site's price-core.js.
export type PriceKey = "AE" | "other" | "unknown";

export type Settings = {
  agentName: string;
  sprintPrice: SprintPrice;
  promptVersion: string;
  knowledgePack: string | null;
  prices: Record<PriceKey, SprintPrice>;
  packs: Record<PriceKey, string | null>;
  // Two-letter country of the visitor, or null when unknown.
  country: string | null;
  arabicEnabled: boolean;
  arabicJudgeProvider: "anthropic" | "hf";
  arabicJudgeModel: string;
  dialectGate: "fail" | "report";
  conversationModel: string;
  fallbackModel: string;
  judgeModel: string;
  simulatorModel: string;
  maxSeconds: number;
  maxTurns: number;
  costCapUsd: number;
  maxInputChars: number;
  maxToolRounds: number;
  requestTimeoutMs: number;
  maxOutputTokens: number;
  forbiddenNames: string[];
  traceFile: string;
  summaryTo: string;
  summaryFrom: string;
  transcriptDays: number;
  // Deepgram + TTS estimate per call minute, counted in the daily total. Measured in the voice spike.
  voiceUsdPerMinute: number;
};

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const num = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${raw}"`);
  return n;
};

// Decided 2026-10-05: USD 6,000 for every known country outside the UAE; AED 25,000 in the
// UAE and when the country cannot be read (the UAE is the current test market).
const PRICES: Record<PriceKey, SprintPrice> = {
  AE: { amount: 25000, currency: "AED" },
  other: { amount: 6000, currency: "USD" },
  unknown: { amount: 25000, currency: "AED" },
};

// AIYAZ_KNOWLEDGE unset: pack by country. "none": no pack. Any other value: that pack for everyone.
function packsFromEnv(): Record<PriceKey, string | null> {
  const forced = process.env.AIYAZ_KNOWLEDGE;
  if (forced === "none") return { AE: null, other: null, unknown: null };
  if (forced) return { AE: forced, other: forced, unknown: forced };
  return { AE: "uae.v1", other: "general.v1", unknown: "uae.v1" };
}

export function normCountry(country: string | null | undefined): string | null {
  const c = (country ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export function priceKey(country: string | null | undefined): PriceKey {
  const c = normCountry(country);
  if (!c) return "unknown";
  return c === "AE" ? "AE" : "other";
}

// The settings for one visitor: their price and their market pack.
export function forCountry(settings: Settings, country: string | null | undefined): Settings {
  const key = priceKey(country);
  return {
    ...settings,
    country: normCountry(country),
    sprintPrice: settings.prices[key],
    knowledgePack: settings.packs[key],
  };
}

export function loadSettings(): Settings {
  return {
    agentName: env("AIYAZ_AGENT_NAME", "Aiyaz"),
    promptVersion: env("AIYAZ_PROMPT_VERSION", "v3"),
    // The unknown visitor until forCountry() is applied.
    sprintPrice: PRICES.unknown,
    knowledgePack: packsFromEnv().unknown,
    prices: { ...PRICES },
    packs: packsFromEnv(),
    country: null,
    // Off until the Gulf Arabic review passes (spec section 4).
    arabicEnabled: env("AIYAZ_ARABIC", "false") === "true",
    // Spike 2026-10-01: no HF token yet, so the judge runs on Claude (not open source).
    // Set AIYAZ_ARABIC_JUDGE=hf with HF_TOKEN to use ALLaM instead.
    arabicJudgeProvider: env("AIYAZ_ARABIC_JUDGE", "anthropic") === "hf" ? "hf" : "anthropic",
    arabicJudgeModel: env(
      "AIYAZ_ARABIC_JUDGE_MODEL",
      env("AIYAZ_ARABIC_JUDGE", "anthropic") === "hf" ? "humain-ai/ALLaM-7B-Instruct-preview" : "claude-sonnet-5",
    ),
    // Spike: CAMeL hit 55% on Gulf lines, so a non-Gulf label is reported, not failed.
    // A reply labelled MSA always fails.
    dialectGate: env("AIYAZ_DIALECT_GATE", "report") === "fail" ? "fail" : "report",
    // Confirmed by Imran 2026-09-28.
    conversationModel: env("AIYAZ_CONVERSATION_MODEL", "claude-sonnet-5"),
    fallbackModel: env("AIYAZ_FALLBACK_MODEL", "claude-haiku-4-5"),
    judgeModel: env("AIYAZ_JUDGE_MODEL", "claude-sonnet-5"),
    simulatorModel: env("AIYAZ_SIMULATOR_MODEL", "claude-sonnet-5"),
    maxSeconds: num("AIYAZ_MAX_SECONDS", 600),
    maxTurns: num("AIYAZ_MAX_TURNS", 20),
    // Starting value; revisit once evals measure a real median.
    costCapUsd: num("AIYAZ_COST_CAP_USD", 1),
    maxInputChars: num("AIYAZ_MAX_INPUT_CHARS", 4000),
    maxToolRounds: num("AIYAZ_MAX_TOOL_ROUNDS", 4),
    requestTimeoutMs: num("AIYAZ_REQUEST_TIMEOUT_MS", 30_000),
    maxOutputTokens: num("AIYAZ_MAX_OUTPUT_TOKENS", 1024),
    forbiddenNames: ["Imran"],
    traceFile: env("AIYAZ_TRACE_FILE", "traces.jsonl"),
    summaryTo: env("AIYAZ_SUMMARY_TO", ""),
    summaryFrom: env("AIYAZ_SUMMARY_FROM", "Aiyaz <work@getaiengineer.dev>"),
    // Spec assumption, Imran to confirm.
    transcriptDays: num("AIYAZ_TRANSCRIPT_DAYS", 30),
    voiceUsdPerMinute: num("AIYAZ_VOICE_USD_PER_MIN", 0.05),
  };
}
