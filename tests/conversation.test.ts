import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";
import { Conversation, WRAP_UP } from "../src/conversation.js";
import { FallbackLLM, FatalLLMError } from "../src/llm.js";
import { MemoryTracer } from "../src/tracer.js";
import { FakeLLM, text, tool } from "./fake-llm.js";

const settings = loadSettings();
const make = (llm: FakeLLM, extra: Partial<ConstructorParameters<typeof Conversation>[0]> = {}) =>
  new Conversation({ settings, llm, tracer: new MemoryTracer(), ...extra });

describe("opening", () => {
  it("discloses it is an AI in the first sentence, without a brief", () => {
    const opener = make(new FakeLLM([])).start();
    expect(opener).toBe(
      "I'm Aiyaz, an AI agent from getaiengineer.dev. What is your company trying to do with AI?",
    );
  });
  it("asks about a brief fact instead of asserting it", () => {
    const brief = { company: "Acme", facts: [{ text: "launched an AI support bot", source: "https://acme.test" }] };
    const opener = make(new FakeLLM([]), { brief }).start();
    expect(opener).toBe("I'm Aiyaz, an AI agent from getaiengineer.dev. I read that you launched an AI support bot. Is that right?");
  });
});

describe("a turn", () => {
  it("records notes through the tool and returns the spoken text", async () => {
    const llm = new FakeLLM([
      [text("Got it."), tool("record_notes", { product: "an invoicing app", add_symptoms: ["bad answers"] })],
      [text("Who uses it day to day?")],
    ]);
    const c = make(llm);
    c.start();
    const said = await c.reply("We make an invoicing app and the AI gives bad answers.");
    expect(said).toBe("Got it. Who uses it day to day?");
    expect(c.notes.product).toBe("an invoicing app");
    expect(c.notes.symptoms).toEqual(["bad answers"]);
  });

  it("speaks a question that came with record_notes without a second model call", async () => {
    const llm = new FakeLLM([
      [text("Got it. Who uses it day to day?"), tool("record_notes", { product: "an invoicing app" })],
    ]);
    const c = make(llm);
    c.start();
    expect(await c.reply("We make an invoicing app.")).toBe("Got it. Who uses it day to day?");
    expect(llm.requests).toHaveLength(1);
    expect(c.notes.product).toBe("an invoicing app");
  });

  it("carries deferred tool results into the next user message", async () => {
    const first = tool("record_notes", { product: "a" });
    const llm = new FakeLLM([[text("Who uses it?"), first], [text("Thanks.")]]);
    const c = make(llm);
    c.start();
    await c.reply("hello");
    await c.reply("small teams");
    const msgs = llm.requests[1]!.messages;
    const last = msgs[msgs.length - 1]!;
    expect(last.role).toBe("user");
    const blocks = last.content as Array<{ type: string; tool_use_id?: string; text?: string }>;
    expect(blocks.map((b) => b.type)).toEqual(["tool_result", "text"]);
    expect(blocks[0]!.tool_use_id).toBe((first as unknown as { id: string }).id);
    expect(blocks[1]!.text).toBe("small teams");
  });

  it("still makes a second call when record_notes came with no text", async () => {
    const llm = new FakeLLM([[tool("record_notes", { product: "a" })], [text("Who uses it?")]]);
    const c = make(llm);
    c.start();
    expect(await c.reply("hi")).toBe("Who uses it?");
    expect(llm.requests).toHaveLength(2);
  });

  it("never defers end_conversation", async () => {
    const llm = new FakeLLM([[text("Shall we stop?"), tool("end_conversation", { reason: "done" })]]);
    const c = make(llm);
    c.start();
    await c.reply("bye");
    expect(c.ended).toBe(true);
  });

  it("never speaks the note-saving acknowledgement", async () => {
    const llm = new FakeLLM([
      [text("Is it live with users yet?"), tool("record_notes", { product: "a chatbot" })],
      [text("Saved. Is it live with users yet?")],
    ]);
    const c = make(llm);
    c.start();
    const said = await c.reply("We have a chatbot.");
    expect(said).not.toMatch(/saved/i);
  });

  it("keeps sentences that merely start with a word like Noted", async () => {
    const llm = new FakeLLM([[text("Noted, so it is live with users. Who owns it?")]]);
    const c = make(llm);
    c.start();
    expect(await c.reply("It is live.")).toBe("Noted, so it is live with users. Who owns it?");
  });

  it("never speaks a stage direction like (Waiting for their answer.)", async () => {
    const llm = new FakeLLM([[text("وش المشكلة اللي تواجهكم؟ (Waiting for their answer.)")]]);
    const c = make(llm);
    c.start();
    expect(await c.reply("عندنا شات بوت.")).toBe("وش المشكلة اللي تواجهكم؟");
  });

  it("sends every tool result back in one user message", async () => {
    const llm = new FakeLLM([
      [tool("record_notes", { product: "a" }), tool("record_notes", { users: "b" })],
      [text("Next question?")],
    ]);
    const c = make(llm);
    c.start();
    await c.reply("hello");
    const second = llm.requests[1]!.messages;
    const last = second[second.length - 1]!;
    expect(last.role).toBe("user");
    expect(Array.isArray(last.content) && last.content.map((b) => b.type)).toEqual(["tool_result", "tool_result"]);
  });

  it("never says the forbidden name even if the model does", async () => {
    const c = make(new FakeLLM([[text("Imran will send you a summary.")]]));
    c.start();
    expect(await c.reply("ok")).toBe("the team will send you a summary.");
  });

  it("ends when the model calls end_conversation", async () => {
    const c = make(new FakeLLM([[text("Thanks, that's all I need."), tool("end_conversation", { reason: "done" })]]));
    c.start();
    await c.reply("bye");
    expect(c.ended).toBe(true);
    expect(c.endReason).toBe("agent_ended");
    await expect(c.reply("again")).rejects.toThrow();
  });

  it("an empty answer still makes a valid request", async () => {
    const llm = new FakeLLM([[text("Take your time.")]]);
    const c = make(llm);
    c.start();
    await c.reply("   ");
    const msgs = llm.requests[0]!.messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "(no answer)" });
  });

  it("stops asking for tools after the round limit and keeps history valid", async () => {
    const rounds = Array.from({ length: settings.maxToolRounds }, () => [tool("record_notes", { product: "x" })]);
    const llm = new FakeLLM(rounds);
    const c = make(llm);
    c.start();
    const said = await c.reply("hi");
    expect(said).toBe("Could you tell me a little more about that?");
  });
});

describe("limits", () => {
  it("wraps up at the time limit without calling the model", async () => {
    let t = 0;
    const llm = new FakeLLM([]);
    const c = make(llm, { now: () => t });
    c.start();
    t = settings.maxSeconds * 1000 + 1;
    expect(await c.reply("still there?")).toBe(WRAP_UP.time_limit);
    expect(llm.requests).toHaveLength(0);
    expect(c.endReason).toBe("time_limit");
  });

  it("wraps up once the cost cap is reached", async () => {
    const c = make(new FakeLLM([[text("Tell me more.")]]), { settings: { ...settings, costCapUsd: 0.001 } });
    c.start();
    const said = await c.reply("hi");
    expect(said).toBe(`Tell me more. ${WRAP_UP.cost_limit}`);
    expect(c.endReason).toBe("cost_limit");
  });

  it("truncates very long input", async () => {
    const llm = new FakeLLM([[text("ok")]]);
    const c = make(llm, { settings: { ...settings, maxInputChars: 10 } });
    c.start();
    await c.reply("x".repeat(50));
    const msgs = llm.requests[0]!.messages;
    expect(msgs[msgs.length - 1]!.content).toBe("x".repeat(10));
  });
});

describe("fallback", () => {
  const overloaded = () => new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers());

  it("retries once, then falls back to Haiku without thinking", async () => {
    const llm = new FakeLLM([overloaded(), overloaded(), [text("hi")]]);
    const f = new FallbackLLM(llm, "claude-sonnet-5", "claude-haiku-4-5", async () => {});
    const { fallbackUsed } = await f.create({ model: "claude-sonnet-5", max_tokens: 10, messages: [{ role: "user", content: "x" }] });
    expect(fallbackUsed).toBe(true);
    expect(llm.requests.map((r) => r.model)).toEqual(["claude-sonnet-5", "claude-sonnet-5", "claude-haiku-4-5"]);
    expect(llm.requests[0]!.thinking).toEqual({ type: "disabled" });
    expect(llm.requests[2]!.thinking).toBeUndefined();
  });

  it("does not retry a bad request", async () => {
    const bad = new Anthropic.BadRequestError(400, { type: "error" }, "bad", new Headers());
    const llm = new FakeLLM([bad]);
    const f = new FallbackLLM(llm, "claude-sonnet-5", "claude-haiku-4-5", async () => {});
    await expect(f.create({ model: "claude-sonnet-5", max_tokens: 10, messages: [] })).rejects.toBeInstanceOf(FatalLLMError);
    expect(llm.requests).toHaveLength(1);
  });

  it("ends the conversation politely when the model is unreachable", async () => {
    const c = make(new FakeLLM([overloaded(), overloaded(), overloaded()]));
    c.start();
    expect(await c.reply("hi")).toBe(WRAP_UP.error);
    expect(c.endReason).toBe("error");
  }, 10_000);
});
