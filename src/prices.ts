// US dollars per 1M tokens. Cache writes bill at 1.25x input, cache reads at 0.1x input.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// Priced by the model that actually served the call. An unknown model throws:
// it must never silently count as $0 against the cost cap.
export function costUsd(model: string, usage: Usage): number {
  const price = MODEL_PRICES[model];
  if (!price) throw new Error(`No price for model "${model}"; add it to MODEL_PRICES`);
  const perToken = (p: number) => p / 1_000_000;
  return (
    usage.input_tokens * perToken(price.input) +
    (usage.cache_creation_input_tokens ?? 0) * perToken(price.input) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * perToken(price.input) * 0.1 +
    usage.output_tokens * perToken(price.output)
  );
}
