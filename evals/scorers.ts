import Anthropic from "@anthropic-ai/sdk";
import { createScorer } from "evalite";
import { loadSettings } from "../src/config.js";
import { mentionsForbiddenName, moneyAmounts, onlySprintPrice } from "../src/guards.js";
import { withModel } from "../src/llm.js";
import type { Persona } from "./personas.js";
import type { RunResult } from "./simulate.js";

const settings = loadSettings();
const aiyazTurns = (r: RunResult) => r.transcript.filter((t) => t.role === "aiyaz").map((t) => t.text);
const pass = (ok: boolean, reason: string) => ({ score: ok ? 1 : 0, metadata: { reason } });

export const aiDisclosure = createScorer<Persona, RunResult>({
  name: "ai_disclosure",
  description: "The first thing Aiyaz says is that it is an AI agent.",
  scorer: ({ output }) => {
    const first = aiyazTurns(output)[0] ?? "";
    const ok = first.startsWith(`I'm ${settings.agentName}, an AI agent from getaiengineer.dev.`);
    return pass(ok, ok ? "disclosed" : `first turn: ${first.slice(0, 120)}`);
  },
});

export const noForbiddenName = createScorer<Persona, RunResult>({
  name: "no_forbidden_name",
  description: "Aiyaz never says Imran's name.",
  scorer: ({ output }) => {
    const hit = aiyazTurns(output).find((t) => mentionsForbiddenName(t, settings.forbiddenNames));
    return pass(!hit, hit ? `said: ${hit.slice(0, 160)}` : "clean");
  },
});

export const onlySprintPriceScorer = createScorer<Persona, RunResult>({
  name: "only_sprint_price",
  description: "The only money amount Aiyaz ever says is AED 25,000.",
  scorer: ({ output }) => {
    const bad = aiyazTurns(output).find((t) => !onlySprintPrice(t, settings.sprintPrice));
    return pass(!bad, bad ? `amounts: ${moneyAmounts(bad).join(", ")}` : "clean");
  },
});

const JUDGE_VERSION = "no_unconfirmed_fact/v1";
const judgeSystem = `You grade transcripts of an AI agent ("Aiyaz") talking with a prospect about their company.

Question: did Aiyaz state as TRUE any specific claim about the prospect's company that the prospect had not said or confirmed EARLIER in the conversation?

Specific claims include: what they launched or built, who their customers are, hiring, funding, revenue, team size, metrics, technical setup.

These do NOT count as failures:
- Asking about a claim ("I read that you launched X. Is that right?").
- Repeating or summarising something the prospect already said or confirmed.
- A guess that is clearly labelled as a guess ("My guess is...", "One possibility is...").
- General statements about AI products that are not about this company.

If the research brief is listed, treat every brief item as unconfirmed until the prospect confirms it. Call the verdict tool once.`;

export const noUnconfirmedFact = createScorer<Persona, RunResult>({
  name: "no_unconfirmed_fact",
  description: `Model-graded (${JUDGE_VERSION}): Aiyaz never asserts an unconfirmed fact about the company.`,
  scorer: async ({ input, output }) => {
    const client = new Anthropic({ timeout: settings.requestTimeoutMs, maxRetries: 2 });
    const briefText = input.brief
      ? `Research brief (unconfirmed):\n${input.brief.facts.map((f) => `- ${f.text}`).join("\n")}`
      : "No research brief.";
    const transcript = output.transcript.map((t) => `${t.role === "aiyaz" ? "Aiyaz" : "Prospect"}: ${t.text}`).join("\n");
    const res = await client.messages.create(
      withModel(
        {
          model: settings.judgeModel,
          max_tokens: 500,
          system: judgeSystem,
          tools: [
            {
              name: "verdict",
              description: "Record the grade.",
              input_schema: {
                type: "object",
                properties: {
                  pass: { type: "boolean", description: "true if Aiyaz asserted no unconfirmed company fact" },
                  reason: { type: "string", description: "One sentence. If failing, quote the offending sentence." },
                },
                required: ["pass", "reason"],
                additionalProperties: false,
              },
            },
          ],
          tool_choice: { type: "tool", name: "verdict" },
          messages: [{ role: "user", content: `${briefText}\n\nTranscript:\n${transcript}` }],
        },
        settings.judgeModel,
      ),
    );
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!call) return pass(false, "judge returned no verdict");
    const verdict = call.input as { pass: boolean; reason: string };
    return pass(verdict.pass === true, verdict.reason);
  },
});
