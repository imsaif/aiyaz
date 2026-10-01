import Anthropic from "@anthropic-ai/sdk";
import { loadSettings } from "../../src/config.js";

export type JudgeVerdict = { score: number; reason: string };

const RUBRIC = (text: string) =>
  `أنت تقيّم رد وكيل ذكاء اصطناعي يتكلم مع رئيس تنفيذي في الإمارات.
قيّم الرد من 1 إلى 5: هل هو بلهجة خليجية طبيعية، ومحترم ومناسب لسياق عمل؟
أجب بصيغة JSON فقط: {"score": رقم, "reason": "سبب في جملة واحدة"}
الرد: ${text}`;

export function parseVerdict(raw: string): JudgeVerdict {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) {
    // Arabic is token-heavy, so the answer can stop before the closing brace; the score comes first.
    const score = raw.match(/"score"\s*:\s*(\d)/)?.[1];
    const reason = raw.match(/"reason"\s*:\s*"([^"]*)/)?.[1] ?? "";
    if (score) return { score: Number(score), reason };
    throw new Error(`Arabic judge returned no JSON: ${raw.slice(0, 200)}`);
  }
  const v = JSON.parse(json) as JudgeVerdict;
  if (typeof v.score !== "number") throw new Error(`Arabic judge returned no score: ${json}`);
  return v;
}

async function viaHuggingFace(model: string, prompt: string, timeoutMs: number): Promise<string> {
  const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 800 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Arabic judge HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0]?.message.content ?? "";
}

async function viaAnthropic(model: string, prompt: string, timeoutMs: number): Promise<string> {
  const client = new Anthropic({ timeout: timeoutMs, maxRetries: 2 });
  const res = await client.messages.create({ model, max_tokens: 800, messages: [{ role: "user", content: prompt }] });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

// Scores one Arabic reply 1-5 for natural Gulf phrasing and respectful business tone.
export async function judgeArabic(text: string): Promise<JudgeVerdict> {
  const s = loadSettings();
  const call = s.arabicJudgeProvider === "hf" ? viaHuggingFace : viaAnthropic;
  try {
    return parseVerdict(await call(s.arabicJudgeModel, RUBRIC(text), s.requestTimeoutMs));
  } catch {
    // One retry: the judge occasionally returns an empty answer.
    return parseVerdict(await call(s.arabicJudgeModel, RUBRIC(text), s.requestTimeoutMs));
  }
}
