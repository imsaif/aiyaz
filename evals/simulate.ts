import Anthropic from "@anthropic-ai/sdk";
import { forCountry, loadSettings, type SprintPrice } from "../src/config.js";
import { Conversation, type EndReason, type Turn } from "../src/conversation.js";
import { AnthropicLLM, withModel } from "../src/llm.js";
import type { Notes } from "../src/notes.js";
import { JsonlTracer } from "../src/tracer.js";
import type { Persona } from "./personas.js";

export type RunResult = {
  transcript: Turn[];
  notes: Notes;
  endReason: EndReason | "prospect_left" | "max_prospect_turns";
  costUsd: number;
  // The price this visitor's country is allowed to hear.
  price: SprintPrice;
};

const MAX_PROSPECT_TURNS = 8;
const END = "[END]";

const simulatorSystem = (persona: Persona) =>
  `You are role-playing a prospect talking to an AI agent from an AI consultancy. Stay in character.

${persona.play}

Reply with only what you would say, in one to three sentences. When you would leave the conversation, or the agent has wrapped up, reply with exactly ${END}.`;

// Plays one persona against the real Aiyaz and returns the whole conversation.
export async function runPersona(persona: Persona): Promise<RunResult> {
  const settings = forCountry(loadSettings(), persona.country ?? null);
  const convo = new Conversation({
    settings,
    llm: new AnthropicLLM(settings.requestTimeoutMs),
    tracer: new JsonlTracer("eval-traces.jsonl"),
    brief: persona.brief ?? null,
  });
  const result = (endReason: RunResult["endReason"]): RunResult => ({
    transcript: convo.transcript,
    notes: convo.notes,
    endReason,
    costUsd: convo.costUsd,
    price: settings.sprintPrice,
  });
  const simulator = new Anthropic({ timeout: settings.requestTimeoutMs, maxRetries: 2 });

  // From the prospect's side, Aiyaz is the "user" and the prospect is the "assistant".
  const seen: Anthropic.MessageParam[] = [{ role: "user", content: convo.start() }];

  for (let i = 0; i < MAX_PROSPECT_TURNS; i++) {
    let said = "";
    if (!persona.silent) {
      const res = await simulator.messages.create(
        withModel(
          { model: settings.simulatorModel, max_tokens: 300, system: simulatorSystem(persona), messages: seen },
          settings.simulatorModel,
        ),
      );
      said = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      if (said === END || said.includes(END)) return result("prospect_left");
      seen.push({ role: "assistant", content: said });
    }
    // A silent visitor sends "", which Conversation records as "(no answer)".
    const reply = await convo.reply(said);
    if (convo.ended) break;
    if (!persona.silent) seen.push({ role: "user", content: reply });
  }

  return result(convo.endReason ?? "max_prospect_turns");
}
