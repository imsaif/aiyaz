import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { forCountry, loadSettings } from "../src/config.js";
import { disclosesAtOpening } from "../src/guards.js";
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
      "I'm Aiyaz, an AI agent. What is your company trying to do with AI?",
    );
  });
  it("greets a lead by company name and asks who they are", () => {
    const brief = { company: "Acme", facts: [{ text: "launched an AI support bot", source: "https://acme.test" }] };
    const opener = make(new FakeLLM([]), { brief }).start();
    expect(opener).toBe("Hi Acme, I'm Aiyaz, an AI agent. Who am I speaking with?");
    expect(disclosesAtOpening(opener, "Aiyaz")).toBe(true);
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

  it("makes the second call when a closing summary with no question came with record_notes", async () => {
    const llm = new FakeLLM([
      [text("So you sell invoicing software to small shops and the answers drift. The sprint would start there."), tool("record_notes", { product: "an invoicing app" })],
      [text("Thanks for your time."), tool("end_conversation", { reason: "done" })],
    ]);
    const c = make(llm);
    c.start();
    await c.reply("That is all.");
    expect(llm.requests).toHaveLength(2);
    expect(c.ended).toBe(true);
  });

  it("ends the call in one model call when the summary, notes and end_conversation come together", async () => {
    const llm = new FakeLLM([
      [
        text("So you sell invoicing software to small shops. The sprint would start with the answers."),
        tool("record_notes", { product: "an invoicing app" }),
        tool("end_conversation", { reason: "done" }),
      ],
    ]);
    const c = make(llm);
    c.start();
    await c.reply("That is all.");
    expect(llm.requests).toHaveLength(1);
    expect(c.ended).toBe(true);
    expect(c.endReason).toBe("agent_ended");
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

describe("visitor email", () => {
  it("exposes visitor_email on the record_notes tool", async () => {
    const llm = new FakeLLM([[text("Hello.")]]);
    const c = make(llm);
    c.start();
    await c.reply("hi");
    const t = (llm.requests[0]!.tools as { name: string }[]).find((x) => x.name === "record_notes") as unknown as { input_schema: { properties: Record<string, unknown> } };
    expect(t.input_schema.properties).toHaveProperty("visitor_email");
  });
  it("exposes visitor_name and visitor_role on the record_notes tool", async () => {
    const llm = new FakeLLM([[text("Hello.")]]);
    const c = make(llm);
    c.start();
    await c.reply("hi");
    const t = (llm.requests[0]!.tools as { name: string }[]).find((x) => x.name === "record_notes") as unknown as { input_schema: { properties: Record<string, unknown> } };
    expect(t.input_schema.properties).toHaveProperty("visitor_name");
    expect(t.input_schema.properties).toHaveProperty("visitor_role");
  });
  it("keeps a valid email from record_notes and drops an invalid one", async () => {
    const llm = new FakeLLM([
      [text("Thanks. Anything else?"), tool("record_notes", { visitor_email: "nope" })],
      [text("Thanks. Anything else?"), tool("record_notes", { visitor_email: " Sam@Acme.test " })],
    ]);
    const c = make(llm);
    c.start();
    await c.reply("it is nope");
    expect(c.notes.visitor_email).toBeNull();
    await c.reply("sam at acme dot test");
    expect(c.notes.visitor_email).toBe("sam@acme.test");
  });
});

describe("limits", () => {
  it("can be ended from outside with the fixed wrap-up line, without a model call", () => {
    const llm = new FakeLLM([]);
    const c = make(llm);
    c.start();
    expect(c.end("time_limit")).toBe(WRAP_UP.time_limit);
    expect(c.ended).toBe(true);
    expect(c.endReason).toBe("time_limit");
    expect(c.transcript.at(-1)).toEqual({ role: "aiyaz", text: WRAP_UP.time_limit });
    expect(c.end("time_limit")).toBe("");
    expect(llm.requests).toHaveLength(0);
  });

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

  it("counts the voice estimate towards the cost cap", async () => {
    let t = 0;
    const llm = new FakeLLM([[text("Tell me more.")]]);
    const c = make(llm, { settings: { ...settings, costCapUsd: 1, voiceUsdPerMinute: 1 }, now: () => t });
    c.start();
    // USD 0.998 of voice so far: under the cap until this turn's Claude cost is added.
    t = 59_900;
    expect(await c.reply("hi")).toBe(`Tell me more. ${WRAP_UP.cost_limit}`);
    expect(c.endReason).toBe("cost_limit");
    expect(c.costUsd).toBeLessThan(0.1);
  });

  it("ends with the cost line before calling the model when voice alone is over the cap", async () => {
    let t = 0;
    const llm = new FakeLLM([[text("first")], [text("second")]]);
    const c = make(llm, { settings: { ...settings, costCapUsd: 1, voiceUsdPerMinute: 0.2 }, now: () => t });
    c.start();
    t = 60_000;
    expect(await c.reply("hi")).toBe("first");
    t = 5 * 60_000 + 1;
    expect(await c.reply("still here")).toBe(WRAP_UP.cost_limit);
    expect(llm.requests).toHaveLength(1);
    expect(c.endReason).toBe("cost_limit");
  });

  it("with no voice rate, only Claude's cost counts, however long the call", async () => {
    let t = 0;
    const llm = new FakeLLM([[text("Who uses it?")]]);
    const c = make(llm, { settings: { ...settings, costCapUsd: 1, voiceUsdPerMinute: 0 }, now: () => t });
    c.start();
    t = 9 * 60_000;
    expect(await c.reply("hi")).toBe("Who uses it?");
    expect(c.ended).toBe(false);
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

describe("what the visitor actually heard", () => {
  const lastAssistantText = (llm: FakeLLM) => {
    const msgs = llm.requests.at(-1)!.messages;
    return msgs.filter((m) => m.role === "assistant").map((m) =>
      typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" "),
    );
  };
  const allText = (llm: FakeLLM) => JSON.stringify(llm.requests.at(-1)!.messages);

  it("keeps only the played part of a cut-off reply, in the history and the transcript", async () => {
    const llm = new FakeLLM([[text("We build AI systems for support teams. What does Acme sell?")], [text("Who uses it?")]]);
    const c = make(llm);
    c.start();
    await c.reply("Tell me about you.", "turn-1");
    c.heard("turn-1", "We build AI systems");
    await c.reply("We sell shoes.", "turn-2");
    expect(allText(llm)).not.toContain("What does Acme sell?");
    expect(lastAssistantText(llm)).toContain("We build AI systems");
    expect(allText(llm)).toContain("The prospect cut you off");
    expect(c.transcript.map((t) => t.text)).not.toContain("We build AI systems for support teams. What does Acme sell?");
    expect(c.transcript.find((t) => t.text === "We build AI systems")).toEqual({ role: "aiyaz", text: "We build AI systems", interrupted: true });
  });

  it("drops a reply that was cut off before any of it played", async () => {
    const llm = new FakeLLM([[text("A long answer the visitor never heard.")], [text("Go on.")]]);
    const c = make(llm);
    c.start();
    await c.reply("First part.", "turn-1");
    c.heard("turn-1", "");
    await c.reply("Second part.", "turn-2");
    expect(allText(llm)).not.toContain("never heard");
    expect(allText(llm)).toContain("First part.");
    expect(allText(llm)).toContain("before they heard your last reply");
    expect(c.transcript.some((t) => t.text.includes("never heard"))).toBe(false);
  });

  it("keeps the notes tool call of a cut-off reply, so the history stays valid", async () => {
    const llm = new FakeLLM([
      [text("Got it. Who uses it day to day?"), tool("record_notes", { product: "an invoicing app" })],
      [text("Thanks.")],
    ]);
    const c = make(llm);
    c.start();
    await c.reply("We make an invoicing app.", "turn-1");
    c.heard("turn-1", "");
    await c.reply("Accountants.", "turn-2");
    const msgs = llm.requests.at(-1)!.messages;
    expect(JSON.stringify(msgs)).toContain("tool_use");
    expect(JSON.stringify(msgs)).toContain("tool_result");
    expect(JSON.stringify(msgs)).not.toContain("Who uses it day to day?");
    expect(c.notes.product).toBe("an invoicing app");
  });

  it("ignores an unknown turn and a second report for the same turn", async () => {
    const llm = new FakeLLM([[text("One two three.")], [text("Ok.")]]);
    const c = make(llm);
    c.start();
    await c.reply("Hi.", "turn-1");
    c.heard("nope", "");
    c.heard("turn-1", "One two");
    c.heard("turn-1", "");
    expect(c.transcript.at(-1)).toEqual({ role: "aiyaz", text: "One two", interrupted: true });
  });
});

describe("what the visitor heard: ordering and fragments", () => {
  const lastRequest = (llm: FakeLLM) => JSON.stringify(llm.requests.at(-1)!.messages);

  it("does not attach the cut-off note when a later reply has already been given", async () => {
    const llm = new FakeLLM([[text("First reply here.")], [text("Second reply here.")], [text("Third.")]]);
    const c = make(llm);
    c.start();
    await c.reply("one", "t1");
    await c.reply("two", "t2");
    c.heard("t1", "First reply");
    await c.reply("three", "t3");
    expect(lastRequest(llm)).not.toContain("cut you off");
    expect(lastRequest(llm)).not.toContain("First reply here.");
    expect(c.transcript.find((t) => t.interrupted)).toEqual({ role: "aiyaz", text: "First reply", interrupted: true });
  });

  it("counts a fragment shorter than one whole word as nothing played", async () => {
    const llm = new FakeLLM([[text("Weekly reports matter. What do you sell?")], [text("Ok.")]]);
    const c = make(llm);
    c.start();
    await c.reply("one", "t1");
    c.heard("t1", "We");
    await c.reply("two", "t2");
    expect(lastRequest(llm)).toContain("before they heard your last reply");
    expect(c.transcript.some((t) => t.role === "aiyaz" && t.text.startsWith("We"))).toBe(false);
  });

  it("keeps a single whole word", async () => {
    const llm = new FakeLLM([[text("We build AI systems.")], [text("Ok.")]]);
    const c = make(llm);
    c.start();
    await c.reply("one", "t1");
    c.heard("t1", "We");
    expect(c.transcript.at(-1)).toEqual({ role: "aiyaz", text: "We", interrupted: true });
  });

  it("only remembers the most recent replies", async () => {
    const llm = new FakeLLM([[text("Alpha one.")], [text("Beta two.")], [text("Gamma three.")]]);
    const c = make(llm);
    c.start();
    await c.reply("a", "t1");
    await c.reply("b", "t2");
    await c.reply("c", "t3");
    c.heard("t1", "Alpha");
    expect(c.transcript.some((t) => t.text === "Alpha one.")).toBe(true);
    expect(c.trackedReplies).toBeLessThanOrEqual(2);
  });
});

describe("reply length", () => {
  it("caps each model call at 400 output tokens by default", async () => {
    const llm = new FakeLLM([[text("Who uses it?")]]);
    const c = make(llm);
    c.start();
    await c.reply("We make an app.");
    expect(llm.requests[0]!.max_tokens).toBe(400);
  });
  it("still speaks the fixed wrap-up line at the time limit", async () => {
    let now = 0;
    const llm = new FakeLLM([]);
    const c = make(llm, { now: () => now });
    c.start();
    now = (settings.maxSeconds + 1) * 1000;
    expect(await c.reply("hello")).toBe(WRAP_UP.time_limit);
  });
});

describe("a reply cut off at max_tokens", () => {
  const assistantJson = (c: Conversation) => JSON.stringify((c as unknown as { messages: unknown[] }).messages);

  it("speaks and stores only the complete sentences", async () => {
    const llm = new FakeLLM([{ blocks: [text("We help teams ship AI. The sprint covers two we")], stop: "max_tokens" }]);
    const c = make(llm);
    c.start();
    expect(await c.reply("What do you do?")).toBe("We help teams ship AI.");
    expect(c.transcript.at(-1)).toEqual({ role: "aiyaz", text: "We help teams ship AI." });
    expect(assistantJson(c)).not.toContain("covers two we");
  });

  it("does not apply a cut-off record_notes call, and keeps the history valid", async () => {
    const llm = new FakeLLM([
      { blocks: [text("Who uses it day to day?"), tool("record_notes", { product: "an invoic" })], stop: "max_tokens" },
      [text("Ok.")],
    ]);
    const c = make(llm);
    c.start();
    expect(await c.reply("We make an invoicing app.")).toBe("Who uses it day to day?");
    expect(c.notes.product).toBeNull();
    expect(llm.requests).toHaveLength(1);
    await c.reply("Accountants.");
    expect(JSON.stringify(llm.requests[1]!.messages)).not.toContain("tool_use");
  });

  it("does not treat a cut-off end_conversation as called", async () => {
    const llm = new FakeLLM([
      { blocks: [text("So you sell invoicing software. The sprint starts there."), tool("end_conversation", {})], stop: "max_tokens" },
    ]);
    const c = make(llm);
    c.start();
    await c.reply("That is all.");
    expect(c.ended).toBe(false);
  });

  it("falls back to a short question when nothing complete is left", async () => {
    const llm = new FakeLLM([{ blocks: [text("We help teams with")], stop: "max_tokens" }]);
    const c = make(llm);
    c.start();
    const said = await c.reply("What do you do?");
    expect(said).toBe("Could you tell me a little more about that?");
    expect(assistantJson(c)).not.toContain("We help teams with");
  });
});

describe("price guard on spoken replies", () => {
  it("never speaks or stores a price other than the visitor's own", async () => {
    const lines: string[] = [];
    const llm = new FakeLLM([[text("The sprint is AED 25,000. Who signs off on it?")]]);
    const c = new Conversation({ settings: forCountry(settings, "IN"), llm, tracer: new MemoryTracer(), log: (l) => lines.push(l) });
    c.start();
    const said = await c.reply("What does it cost?");
    expect(said).toBe("The two-week sprint is USD 6,000. Who signs off on it?");
    expect(c.transcript.at(-1)!.text).toBe(said);
    expect(JSON.stringify((c as unknown as { messages: unknown[] }).messages)).not.toContain("25,000");
    expect(lines).toEqual([`[call] ${c.id} price guard replaced 1`]);
  });
  it("leaves the visitor's own price alone and logs nothing", async () => {
    const lines: string[] = [];
    const llm = new FakeLLM([[text("The sprint is USD 6,000. Who signs off on it?")]]);
    const c = new Conversation({ settings: forCountry(settings, "IN"), llm, tracer: new MemoryTracer(), log: (l) => lines.push(l) });
    c.start();
    expect(await c.reply("What does it cost?")).toBe("The sprint is USD 6,000. Who signs off on it?");
    expect(lines).toEqual([]);
  });
});

describe("price guard when the call stops early", () => {
  it("also guards model text spoken before a wrap-up line", async () => {
    const llm = new FakeLLM([[text("It is AED 25,000."), tool("record_notes", { product: "x" })], new Error("boom")]);
    const c = new Conversation({ settings: forCountry(settings, "IN"), llm, tracer: new MemoryTracer() });
    c.start();
    const said = await c.reply("What does it cost?");
    expect(said).not.toContain("25,000");
    expect(said).toContain("USD 6,000");
  });
});

describe("fixed wrap-up lines", () => {
  const tail = "Your brief is on your screen, and the booking button is there if a call with the team would help.";
  it("point to the brief and the booking button, and promise no follow-up summary", () => {
    expect(WRAP_UP.time_limit).toBe(`We're at our time limit, so I'll stop here. ${tail}`);
    expect(WRAP_UP.turn_limit).toBe(`I think I have enough to go on, so I'll stop here. ${tail}`);
    expect(WRAP_UP.cost_limit).toBe(`I'll stop here for now. ${tail}`);
    expect(WRAP_UP.error).toBe(`Something went wrong on my side, so I have to stop here. ${tail}`);
    for (const line of Object.values(WRAP_UP)) expect(line).not.toMatch(/follow up/i);
  });
});
