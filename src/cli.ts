// Talk to Aiyaz in the terminal:  pnpm talk            (no brief)
//                                  pnpm talk brief.json (prospect version)
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { loadSettings } from "./config.js";
import { Conversation } from "./conversation.js";
import { AnthropicLLM } from "./llm.js";
import type { Brief } from "./notes.js";
import { JsonlTracer } from "./tracer.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY first, e.g. put it in a .env file and run: pnpm talk");
  process.exit(2);
}

const settings = loadSettings();
const briefPath = process.argv[2];
const brief: Brief | null = briefPath ? JSON.parse(readFileSync(briefPath, "utf8")) : null;

const convo = new Conversation({
  settings,
  llm: new AnthropicLLM(settings.requestTimeoutMs),
  tracer: new JsonlTracer(settings.traceFile),
  brief,
});

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\n${settings.agentName}: ${convo.start()}\n`);

while (!convo.ended) {
  const answer = await rl.question("you: ");
  if (answer.trim() === "/quit") break;
  const said = await convo.reply(answer);
  console.log(`\n${settings.agentName}: ${said}\n`);
}
rl.close();

console.log("--- notes ---");
console.log(JSON.stringify(convo.notes, null, 2));
console.log(`cost: $${convo.costUsd.toFixed(4)}  ended: ${convo.endReason ?? "quit"}  trace: ${settings.traceFile}`);
