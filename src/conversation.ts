import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "./config.js";
import { scrubForbiddenNames } from "./guards.js";
import { FallbackLLM, type LLMClient } from "./llm.js";
import { applyNotesUpdate, emptyNotes, type Brief, type Notes, type NotesUpdate } from "./notes.js";
import { costUsd } from "./prices.js";
import { buildSystemPrompt, openingLine, type BuiltPrompt } from "./prompt.js";
import type { Tracer } from "./tracer.js";

export type EndReason = "agent_ended" | "time_limit" | "turn_limit" | "cost_limit" | "error";
export type Turn = { role: "aiyaz" | "prospect"; text: string };

const TOOLS: Anthropic.Tool[] = [
  {
    name: "record_notes",
    description:
      "Save what you learned about the prospect's product. Call it whenever a field is filled or a brief fact is confirmed or corrected. Every field is optional.",
    input_schema: {
      type: "object",
      properties: {
        product: { type: "string", description: "What the product does, in one sentence." },
        users: { type: "string", description: "Who uses it." },
        ai_feature: { type: "string", description: "What the AI feature does." },
        owner: { type: "string", description: "Who owns the AI feature (role, not necessarily a name)." },
        add_symptoms: { type: "array", items: { type: "string" }, description: "Problems users hit." },
        add_tried: { type: "array", items: { type: "string" }, description: "What they already tried." },
        confirm_facts: { type: "array", items: { type: "string" }, description: "Brief facts the prospect confirmed, exact brief text." },
        reject_facts: { type: "array", items: { type: "string" }, description: "Brief facts the prospect said are wrong, exact brief text." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "end_conversation",
    description: "Call after you have given your short spoken summary, or when the prospect wants to stop.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

export const WRAP_UP: Record<Exclude<EndReason, "agent_ended">, string> = {
  time_limit: "We're at our time limit, so I'll stop here. The team will follow up with a summary.",
  turn_limit: "I think I have enough to go on, so I'll stop here. The team will follow up with a summary.",
  cost_limit: "I'll stop here for now. The team will follow up with a summary.",
  error: "Something went wrong on my side, so I have to stop here. The team will follow up with you.",
};
const TOOL_ROUND_FALLBACK = "Could you tell me a little more about that?";

export type ConversationDeps = {
  settings: Settings;
  llm: LLMClient;
  tracer: Tracer;
  brief?: Brief | null;
  now?: () => number;
};

export class Conversation {
  readonly id = randomUUID();
  readonly transcript: Turn[] = [];
  notes: Notes;
  costUsd = 0;
  ended = false;
  endReason: EndReason | null = null;

  private readonly settings: Settings;
  private readonly llm: FallbackLLM;
  private readonly tracer: Tracer;
  private readonly brief: Brief | null;
  private readonly prompt: BuiltPrompt;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly messages: Anthropic.MessageParam[] = [];
  private prospectTurns = 0;

  constructor(deps: ConversationDeps) {
    this.settings = deps.settings;
    this.llm = new FallbackLLM(deps.llm, deps.settings.conversationModel, deps.settings.fallbackModel);
    this.tracer = deps.tracer;
    this.brief = deps.brief ?? null;
    this.prompt = buildSystemPrompt(deps.settings, this.brief);
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.notes = emptyNotes(this.brief);
  }

  // The opener is fixed text, so the AI disclosure never depends on the model.
  start(): string {
    const opener = openingLine(this.settings, this.brief);
    this.messages.push({ role: "user", content: "(The prospect has opened the conversation.)" });
    this.messages.push({ role: "assistant", content: opener });
    this.transcript.push({ role: "aiyaz", text: opener });
    return opener;
  }

  async reply(prospectText: string): Promise<string> {
    if (this.ended) throw new Error("Conversation has ended");
    if (this.messages.length === 0) throw new Error("Call start() first");

    const text = prospectText.trim().slice(0, this.settings.maxInputChars) || "(no answer)";
    this.transcript.push({ role: "prospect", text });
    this.prospectTurns += 1;

    if (this.now() - this.startedAt > this.settings.maxSeconds * 1000) return this.finish("time_limit");
    if (this.prospectTurns > this.settings.maxTurns) return this.finish("turn_limit");

    this.messages.push({ role: "user", content: text });
    const spoken: string[] = [];

    for (let round = 0; round < this.settings.maxToolRounds; round++) {
      let message: Anthropic.Message;
      let fallbackUsed: boolean;
      const t0 = this.now();
      try {
        ({ message, fallbackUsed } = await this.llm.create({
          model: this.settings.conversationModel,
          max_tokens: this.settings.maxOutputTokens,
          system: this.prompt.text,
          tools: TOOLS,
          messages: this.messages,
        }));
      } catch (err) {
        this.trace({ model: this.settings.conversationModel, latencyMs: this.now() - t0, error: String(err) });
        return this.finish("error", spoken);
      }

      const callCost = costUsd(message.model, message.usage);
      this.costUsd += callCost;
      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      this.trace({
        model: message.model,
        latencyMs: this.now() - t0,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        costUsd: callCost,
        stopReason: message.stop_reason,
        toolCalls: toolUses.map((t) => t.name),
        fallbackUsed,
      });

      this.messages.push({ role: "assistant", content: message.content });
      for (const block of message.content) {
        if (block.type === "text" && block.text.trim()) {
          // The model sometimes echoes a tool acknowledgement ("Saved.") before speaking.
          const clean = block.text
            .trim()
            .replace(/^(?:saved|noted|ended)(?:[.!]\s*|\s*$)/i, "")
            // Stage directions are never spoken: "(Waiting for their answer.)"
            .replace(/\s*\((?:waiting|pause|pauses|wait)[^)]*\)\s*/gi, " ")
            .trim();
          if (clean) spoken.push(scrubForbiddenNames(clean, this.settings.forbiddenNames));
        }
      }

      if (toolUses.length === 0) break;

      let endRequested = false;
      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tool) => {
        if (tool.name === "record_notes") {
          this.notes = applyNotesUpdate(this.notes, tool.input as NotesUpdate);
          return { type: "tool_result", tool_use_id: tool.id, content: "Notes saved. Do not mention this to the prospect." };
        }
        if (tool.name === "end_conversation") {
          endRequested = true;
          return { type: "tool_result", tool_use_id: tool.id, content: "ended" };
        }
        return { type: "tool_result", tool_use_id: tool.id, content: `Unknown tool ${tool.name}`, is_error: true };
      });
      // All results go back in a single user message.
      this.messages.push({ role: "user", content: results });

      if (endRequested) {
        this.ended = true;
        this.endReason = "agent_ended";
        break;
      }
      if (this.costUsd >= this.settings.costCapUsd) return this.finish("cost_limit", spoken);
      if (round === this.settings.maxToolRounds - 1) {
        // Keep the history valid: an assistant turn must follow the tool results.
        this.messages.push({ role: "assistant", content: TOOL_ROUND_FALLBACK });
        spoken.push(TOOL_ROUND_FALLBACK);
      }
    }

    if (!this.ended && this.costUsd >= this.settings.costCapUsd) return this.finish("cost_limit", spoken);

    const said = spoken.join(" ") || TOOL_ROUND_FALLBACK;
    this.transcript.push({ role: "aiyaz", text: said });
    return said;
  }

  private finish(reason: Exclude<EndReason, "agent_ended">, spoken: string[] = []): string {
    this.ended = true;
    this.endReason = reason;
    const said = [...spoken, WRAP_UP[reason]].join(" ");
    this.transcript.push({ role: "aiyaz", text: said });
    return said;
  }

  private trace(partial: {
    model: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    stopReason?: string | null;
    toolCalls?: string[];
    fallbackUsed?: boolean;
    error?: string;
  }): void {
    this.tracer.record({
      ts: new Date().toISOString(),
      conversationId: this.id,
      role: "conversation",
      promptId: this.prompt.id,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      stopReason: null,
      toolCalls: [],
      fallbackUsed: false,
      ...partial,
    });
  }
}
