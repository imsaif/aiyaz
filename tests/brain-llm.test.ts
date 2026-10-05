import { initializeLogger, llm } from "@livekit/agents";
import { describe, expect, it } from "vitest";
import { BrainLLM } from "../src/voice/brain-llm.js";
import type { Brain } from "../src/voice/turns.js";

// LiveKit's logger must exist before any stream runs.
initializeLogger({ pretty: false, level: "warn" });

const fakeBrain = () => {
  const b = {
    calls: [] as string[],
    ended: false,
    async reply(text: string) {
      b.calls.push(text);
      return "Who buys them?";
    },
  };
  return b satisfies Brain;
};

async function collect(stream: llm.LLMStream): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk.delta?.content ?? "";
  return out;
}

describe("BrainLLM", () => {
  it("hands a finished visitor turn to the brain once, even if LiveKit asks twice", async () => {
    const brain = fakeBrain();
    const chatCtx = llm.ChatContext.empty();
    chatCtx.addMessage({ role: "user", content: "We sell shoes." });
    const b = new BrainLLM(brain);
    expect(await collect(b.chat({ chatCtx }))).toBe("Who buys them?");
    expect(await collect(b.chat({ chatCtx }))).toBe("Who buys them?");
    expect(brain.calls).toEqual(["We sell shoes."]);
  });
  it("says nothing and calls nothing on an empty turn", async () => {
    const brain = fakeBrain();
    const chatCtx = llm.ChatContext.empty();
    chatCtx.addMessage({ role: "user", content: "   " });
    expect(await collect(new BrainLLM(brain).chat({ chatCtx }))).toBe("");
    expect(brain.calls).toEqual([]);
  });
});
