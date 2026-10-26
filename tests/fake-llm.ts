import type Anthropic from "@anthropic-ai/sdk";
import type { CreateParams, LLMClient, LLMResult } from "../src/llm.js";

// A step may force a stop reason, for example a reply cut off at max_tokens.
type Step = Anthropic.ContentBlock[] | Error | { blocks: Anthropic.ContentBlock[]; stop: Anthropic.StopReason };

// Replays scripted responses and records every request it received.
export class FakeLLM implements LLMClient {
  readonly requests: CreateParams[] = [];
  constructor(private readonly steps: Step[]) {}

  async create(params: CreateParams): Promise<LLMResult> {
    this.requests.push(structuredClone(params));
    const step = this.steps.shift();
    if (!step) throw new Error("FakeLLM ran out of scripted responses");
    if (step instanceof Error) throw step;
    const blocks = Array.isArray(step) ? step : step.blocks;
    const message = {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: params.model,
      content: blocks,
      stop_reason: Array.isArray(step) ? (blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") : step.stop,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100 },
    } as unknown as Anthropic.Message;
    return { message, fallbackUsed: false };
  }
}

export const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Anthropic.ContentBlock;

let n = 0;
export const tool = (name: string, input: Record<string, unknown>) =>
  ({ type: "tool_use", id: `toolu_${++n}`, name, input }) as unknown as Anthropic.ContentBlock;
