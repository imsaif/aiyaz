import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Brief } from "./notes.js";
import type { Settings, SprintPrice } from "./config.js";

export const PROMPT_NAME = "system";
const promptsDir = (rel: string) => fileURLToPath(new URL(`../prompts/${rel}`, import.meta.url));

export function formatPrice(price: SprintPrice): string {
  return `${price.currency} ${price.amount.toLocaleString("en-US")}`;
}

export type BuiltPrompt = { text: string; id: string };

// The id records name, version, pack and a content hash over template and pack,
// so an edited file that kept its version number still shows up as different in every trace.
export function buildSystemPrompt(settings: Settings, brief: Brief | null): BuiltPrompt {
  const template = readFileSync(promptsDir(`${PROMPT_NAME}.${settings.promptVersion}.md`), "utf8");
  const pack = settings.knowledgePack ? readFileSync(promptsDir(`knowledge/${settings.knowledgePack}.md`), "utf8") : "";
  const sha8 = createHash("sha256").update(template).update(pack).digest("hex").slice(0, 8);
  const briefSection = brief
    ? [
        `You have a research brief on ${brief.company}. Every item below is UNCONFIRMED until the prospect confirms it:`,
        ...brief.facts.map((f) => `- ${f.text} (source: ${f.source})`),
      ].join("\n")
    : "You have no research brief. Everything you know about their company comes from this conversation.";
  const text = template
    .replaceAll("{{agentName}}", settings.agentName)
    .replaceAll("{{sprintPrice}}", formatPrice(settings.sprintPrice))
    .replaceAll("{{briefSection}}", briefSection)
    .replaceAll("{{knowledgeSection}}", pack);
  const packTag = settings.knowledgePack ? `+${settings.knowledgePack}` : "";
  return { text, id: `${PROMPT_NAME}/${settings.promptVersion}${packTag}@${sha8}` };
}

// Said by code, never by the model, so the AI disclosure is guaranteed.
export function openingLine(settings: Settings, brief: Brief | null): string {
  const intro = `I'm ${settings.agentName}, an AI agent from getaiengineer.dev.`;
  const first = brief?.facts[0];
  return first
    ? `${intro} I read that you ${first.text}. Is that right?`
    : `${intro} What does your product do, and where does AI show up in it?`;
}
