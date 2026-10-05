import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scrubForbiddenNames } from "./guards.js";
import type { Brief } from "./notes.js";
import type { Settings, SprintPrice } from "./config.js";

export const PROMPT_NAME = "system";
const promptsDir = (rel: string) => fileURLToPath(new URL(`../prompts/${rel}`, import.meta.url));

const ENGLISH_ONLY =
  "- If they write in another language, reply briefly in English, say you can only continue in English for now, and carry on in English.";

const GULF_ARABIC = [
  "- Reply in the language the caller uses. If they write in Arabic, reply in Gulf (Khaleeji) Arabic as spoken in the UAE, not Modern Standard Arabic.",
  "- Use Gulf words, not Levantine or Egyptian ones: منو not مين, شو not وش or ايش (شو is the Emirati word), يكون not بيكون, يتابع not بيتابع, الحين not هلأ.",
  "- In Arabic, keep the same short sentences. Product and technical terms such as evals, chatbot or monitoring may stay in English, as Gulf speakers often do.",
  '- In Arabic replies, say the price as "25 ألف درهم" and nothing else. In English replies, the price is AED 25,000, written in English.',
  "- If they switch language, switch with them.",
].join("\n");

// Only a lead call (one with a company brief) asks for an email.
const EMAIL_STEP =
  "This is a call with a company brief. Before your closing summary, ask for their email so the team can send them the summary, and when they give it, record it with `record_notes` `visitor_email`. If they decline, carry on without it.";

const WHO_STEP =
  "This is a call with a company brief. Your opening line has already greeted the company and asked who they are. When they tell you their name or role, record it with `record_notes` `visitor_name` and `visitor_role`. Then work through the items in the brief, one at a time, each asked as a question (\"I read that you launched X. Is that right?\"), and then carry on with your questions above.";

// How the prompt places the caller. A pack with no entry gets no place name.
const MARKET_WHERE: Record<string, string> = { "uae.v1": " in the UAE" };

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
    .replaceAll("{{whoStep}}", brief ? WHO_STEP : "")
    .replaceAll("{{emailStep}}", brief ? EMAIL_STEP : "")
    .replaceAll("{{knowledgeSection}}", pack)
    .replaceAll("{{marketWhere}}", settings.knowledgePack ? (MARKET_WHERE[settings.knowledgePack] ?? "") : "")
    // The Gulf Arabic rule quotes the AED price, so it only applies to AED visitors.
    .replaceAll(
      "{{languageRule}}",
      settings.arabicEnabled && settings.sprintPrice.currency === "AED" ? GULF_ARABIC : ENGLISH_ONLY,
    );
  const packTag = settings.knowledgePack ? `+${settings.knowledgePack}` : "";
  return { text, id: `${PROMPT_NAME}/${settings.promptVersion}${packTag}@${sha8}` };
}

// Said by code, never by the model, so the AI disclosure is guaranteed.
export function openingLine(settings: Settings, brief: Brief | null): string {
  const intro = `I'm ${settings.agentName}, an AI agent from getaiengineer.dev.`;
  // One sentence of greeting, so the AI disclosure is still in the first sentence.
  // The company name is not model output, so it is scrubbed here.
  if (brief) return scrubForbiddenNames(`Hi ${brief.company.trim()}, ${intro} Who am I speaking with?`, settings.forbiddenNames);
  return settings.promptVersion === "v1"
    ? `${intro} What does your product do, and where does AI show up in it?`
    : `${intro} What is your company trying to do with AI?`;
}
