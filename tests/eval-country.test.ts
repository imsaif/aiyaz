import { describe, expect, it } from "vitest";
import { PERSONAS } from "../evals/personas.js";
import { endsOnSilence, onlySprintPriceScorer, quotesVisitorPrice } from "../evals/scorers.js";
import type { RunResult } from "../evals/simulate.js";

const run = (over: Partial<RunResult>, aiyaz: string[] = []): RunResult => ({
  transcript: aiyaz.map((text) => ({ role: "aiyaz" as const, text })),
  notes: {} as RunResult["notes"],
  endReason: "agent_ended",
  costUsd: 0,
  price: { amount: 6000, currency: "USD" },
  ...over,
});
const persona = (id: string) => {
  const p = PERSONAS.find((x) => x.id === id);
  if (!p) throw new Error(`no persona ${id}`);
  return p;
};
const score = async (s: unknown, input: unknown, output: RunResult) =>
  (await (s as (a: unknown) => Promise<{ score: number }>)({ input, output, expected: output })).score;

describe("country personas", () => {
  it("has the three new personas with the right fields", () => {
    expect(PERSONAS).toHaveLength(15);
    expect(persona("india-saas-cto")).toMatchObject({ country: "IN", mustQuotePrice: true });
    expect(persona("acme-lead").country).toBe("AE");
    expect(persona("silent-visitor").silent).toBe(true);
    expect(persona("asks-in-dollars").country).toBe("AE");
  });
});

describe("country scorers", () => {
  it("only_sprint_price accepts the visitor's own price and rejects the other", async () => {
    const p = persona("india-saas-cto");
    expect(await score(onlySprintPriceScorer, p, run({}, ["The sprint is USD 6,000."]))).toBe(1);
    expect(await score(onlySprintPriceScorer, p, run({}, ["The sprint is AED 25,000."]))).toBe(0);
  });
  it("quotes_visitor_price needs the price when the persona asks", async () => {
    const p = persona("india-saas-cto");
    expect(await score(quotesVisitorPrice, p, run({}, ["It is USD 6,000 for two weeks."]))).toBe(1);
    expect(await score(quotesVisitorPrice, p, run({}, ["Let us talk scope first."]))).toBe(0);
    expect(await score(quotesVisitorPrice, persona("vague-founder"), run({}, ["hello"]))).toBe(1);
  });
  it("ends_on_silence needs agent_ended for the silent persona only", async () => {
    const p = persona("silent-visitor");
    expect(await score(endsOnSilence, p, run({ endReason: "agent_ended" }))).toBe(1);
    expect(await score(endsOnSilence, p, run({ endReason: "max_prospect_turns" }))).toBe(0);
    expect(await score(endsOnSilence, persona("vague-founder"), run({ endReason: "max_prospect_turns" }))).toBe(1);
  });
});
