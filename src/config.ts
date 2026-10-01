// Every setting lives here. Anything that might change later is an env var.

export type SprintPrice = { amount: number; currency: "AED" };

export type Settings = {
  agentName: string;
  sprintPrice: SprintPrice;
  promptVersion: string;
  knowledgePack: string | null;
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
};

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const num = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${raw}"`);
  return n;
};

export function loadSettings(): Settings {
  return {
    agentName: env("AIYAZ_AGENT_NAME", "Aiyaz"),
    // Decided 2026-10-01: the sprint is priced in AED for UAE companies.
    sprintPrice: { amount: 25000, currency: "AED" },
    promptVersion: env("AIYAZ_PROMPT_VERSION", "v2"),
    // "none" turns the market briefing pack off.
    knowledgePack: env("AIYAZ_KNOWLEDGE", "uae.v1") === "none" ? null : env("AIYAZ_KNOWLEDGE", "uae.v1"),
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
  };
}
