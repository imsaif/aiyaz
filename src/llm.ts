import Anthropic from "@anthropic-ai/sdk";

export type CreateParams = Anthropic.MessageCreateParamsNonStreaming;
export type LLMResult = { message: Anthropic.Message; fallbackUsed: boolean };

// The only way the rest of the code talks to a model, so tests can use a fake.
export interface LLMClient {
  create(params: CreateParams): Promise<LLMResult>;
}

export class FatalLLMError extends Error {}

// Worth retrying: network trouble, timeouts, rate limits, overload and 5xx.
// Everything else (400, 401, 403, 404, 413) is a bug or a config problem.
export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError) return typeof err.status === "number" && err.status >= 500;
  return false;
}

// Thinking stays off on Sonnet/Opus for low latency; Haiku gets no thinking key.
export function withModel(params: CreateParams, model: string): CreateParams {
  const { thinking: _drop, ...rest } = params;
  return model.startsWith("claude-haiku")
    ? { ...rest, model }
    : { ...rest, model, thinking: { type: "disabled" } };
}

export class AnthropicLLM implements LLMClient {
  private readonly client: Anthropic;
  constructor(timeoutMs: number, apiKey = process.env.ANTHROPIC_API_KEY) {
    // FallbackLLM owns retries, so the SDK's own retries are off.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
  }
  async create(params: CreateParams): Promise<LLMResult> {
    return { message: await this.client.messages.create(params), fallbackUsed: false };
  }
}

// One attempt on the main model, one retry, then one attempt on the fallback.
export class FallbackLLM implements LLMClient {
  constructor(
    private readonly inner: LLMClient,
    private readonly mainModel: string,
    private readonly fallbackModel: string,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async create(params: CreateParams): Promise<LLMResult> {
    const attempts = [this.mainModel, this.mainModel, this.fallbackModel];
    let lastError: unknown;
    for (const [i, model] of attempts.entries()) {
      try {
        const { message } = await this.inner.create(withModel(params, model));
        return { message, fallbackUsed: model !== this.mainModel };
      } catch (err) {
        if (!isRetryable(err)) throw new FatalLLMError(String(err));
        lastError = err;
        if (i === 0) await this.sleep(500 + Math.random() * 500);
      }
    }
    throw lastError;
  }
}
