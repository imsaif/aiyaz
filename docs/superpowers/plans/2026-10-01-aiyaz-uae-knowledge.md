# Aiyaz UAE Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aiyaz talks with UAE founders about their AI initiative, quotes only AED 25,000, and can answer in Gulf Arabic behind a switch that is checked by two open-source tests and a human review.

**Architecture:** A versioned UAE briefing pack and a v2 system prompt are loaded by the existing prompt builder (its id hash covers both). The price guard learns AED and Arabic-written amounts. Arabic is gated by a setting; two new eval scorers (CAMeL Tools dialect ID via a Python script, and an open Arabic model as judge) grade Arabic turns and write a review sheet for Imran.

**Tech Stack:** TypeScript (tsx, vitest, evalite), Anthropic SDK, Python 3 + camel-tools for dialect ID, an open Arabic LLM (ALLaM or Jais) as judge, chosen in Task 1.

**Spec:** `docs/superpowers/specs/2026-10-01-aiyaz-uae-knowledge-design.md`

## Global Constraints

- The only price Aiyaz may say is AED 25,000. No hourly rate, day rate, discount or currency conversion.
- Aiyaz never says a person's name for the team (`forbiddenNames: ["Imran"]`); it says "the team".
- The AI disclosure "I'm Aiyaz, an AI agent from getaiengineer.dev." is said by code, never by the model.
- Never state a fact about the caller's company as true unless they said or confirmed it; briefing-pack facts are market context, not company facts.
- Arabic replies are Gulf (Khaleeji) Arabic, not Modern Standard Arabic. English product and technical terms may stay in English.
- `arabicEnabled` defaults to `false` until Task 7's sign-off.
- Copy rules: plain English, no em-dashes, no hype words (seamless, unlock, elevate, revolutionise).
- The repo is PUBLIC: no client names, no private file paths, no business-test details in code, prompts, commits or docs.
- `prompts/system.v1.md` stays in the repo for comparison.
- The briefing pack contains NO money amounts (no funding rounds, no prices): the price guard fails any amount Aiyaz repeats.

## Review Focus

1. **Arabic numerals and Arabic currency words in prices** ("٢٥٬٠٠٠ درهم", "25 ألف درهم"): a correct price must pass and any other Arabic-written amount must fail. Pinned in Task 2.
2. **Caller asks for the price in dollars:** Aiyaz must still say only AED 25,000 and never convert. Pinned in Task 2 (guard rejects "$6,800" next to AED) and Task 6 (`asks-in-dollars` persona).
3. **Briefing-pack fact applied to the caller as true** ("as a CBUAE-licensed firm you must..."): must be labelled as a guess or asked. Pinned in Task 4 (judge prompt names this case).
4. **Arabic caller while the switch is off:** short polite English reply, conversation continues in English. Pinned in Task 5 (prompt-builder test) and the existing `non-english` persona.
5. **Replies mixing Arabic with English tech terms** ("نقدر نسوي evals"): the dialect check must not fail these just for the English words. Pinned in Task 1 (mixed samples in the spike) and Task 6 (dialect script strips Latin words before classifying).

---

## File map

- Create `evals/arabic/samples.json`: 20 labelled sentences for the spike (Task 1).
- Create `evals/arabic/dialect.py`: CAMeL Tools dialect ID, JSON in, JSON out (Task 1, finalised Task 6).
- Create `evals/arabic/requirements.txt` (Task 1).
- Create `docs/superpowers/notes/2026-10-01-arabic-checks-spike.md`: spike results and judge choice (Task 1).
- Modify `src/config.ts`: `sprintPrice`, `promptVersion`, `knowledgePack`, `arabicEnabled`, `arabicJudge*` (Tasks 2, 3, 5, 6).
- Modify `src/guards.ts`: AED and Arabic money parsing (Task 2).
- Modify `src/prompt.ts`: price formatting, pack loading, language rule, v2 opener (Tasks 2-5).
- Create `prompts/knowledge/uae.v1.md` (Task 3).
- Create `prompts/system.v2.md` (Task 4).
- Modify `prompts/system.v1.md`: `${{sprintPrice}}` becomes `{{sprintPrice}}` (Task 2).
- Create `tests/prompt.test.ts` (Tasks 3-5).
- Modify `tests/guards.test.ts` (Task 2).
- Modify `evals/scorers.ts`, `evals/personas.ts`, `evals/aiyaz.eval.ts` (Tasks 2, 4, 6).
- Create `evals/arabic/judge.ts`, `evals/arabic/sheet.ts` (Task 6).
- Modify `.gitignore`: `arabic-review.jsonl`, `arabic-review.md`, `evals/arabic/.venv/` (Tasks 1, 6).

---

### Task 1: Spike the two Arabic checkers

**Files:**
- Create: `evals/arabic/samples.json`, `evals/arabic/dialect.py`, `evals/arabic/requirements.txt`
- Create: `docs/superpowers/notes/2026-10-01-arabic-checks-spike.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `evals/arabic/dialect.py` reads `{"texts": string[]}` on stdin, writes `{"results": [{"text": string, "label": string, "score": number}]}` on stdout. `label` is a MADAR city code (e.g. `DOH`, `RIY`, `MUS`) or `MSA`.
- Produces: the judge choice (model id, how it is called, env vars) written in the spike note, used by Task 6.

- [ ] **Step 1: Write the labelled samples**

`evals/arabic/samples.json` (Imran checks the Gulf lines are natural before the spike counts):

```json
[
  {"text": "هلا والله، شلون أقدر أساعدك اليوم؟", "expect": "gulf"},
  {"text": "وش تبي تسوي بالذكاء الاصطناعي في شركتكم؟", "expect": "gulf"},
  {"text": "زين، يعني المشروع للحين في مرحلة التجربة؟", "expect": "gulf"},
  {"text": "مين المسؤول عن هالمبادرة عندكم؟", "expect": "gulf"},
  {"text": "إذا تبي، الفريق يقدر يتواصل معك ونحدد موعد.", "expect": "gulf"},
  {"text": "شو المشكلة اللي تواجهكم بالضبط؟", "expect": "gulf"},
  {"text": "عشان كذا نبدأ بحالة استخدام وحدة ونقيسها.", "expect": "gulf"},
  {"text": "ما عليه، خذ راحتك وقول لي متى يناسبك.", "expect": "gulf"},
  {"text": "السعر خمسة وعشرين ألف درهم، ثابت.", "expect": "gulf"},
  {"text": "الحين وين وصلتوا في المشروع؟", "expect": "gulf"},
  {"text": "كيف يمكنني مساعدتك اليوم؟", "expect": "msa"},
  {"text": "ما الذي تريد تحقيقه باستخدام الذكاء الاصطناعي؟", "expect": "msa"},
  {"text": "هل ما زال المشروع في مرحلة التجربة؟", "expect": "msa"},
  {"text": "من المسؤول عن هذه المبادرة في شركتكم؟", "expect": "msa"},
  {"text": "يستطيع الفريق التواصل معك لتحديد موعد.", "expect": "msa"},
  {"text": "ما المشكلة التي تواجهونها تحديدا؟", "expect": "msa"},
  {"text": "لذلك نبدأ بحالة استخدام واحدة ونقيس نتائجها.", "expect": "msa"},
  {"text": "نقدر نسوي evals على البيانات حقتكم.", "expect": "gulf", "mixed": true},
  {"text": "الـ chatbot عندكم يعطي أجوبة غلط أحيانا؟", "expect": "gulf", "mixed": true},
  {"text": "نحط monitoring عشان تعرفون إذا صار شي.", "expect": "gulf", "mixed": true}
]
```

- [ ] **Step 2: Set up Python and CAMeL Tools**

`evals/arabic/requirements.txt`:

```
camel-tools>=1.5
```

Run:
```bash
python3 -m venv evals/arabic/.venv
evals/arabic/.venv/bin/pip install -r evals/arabic/requirements.txt
evals/arabic/.venv/bin/camel_data -l
```
Expected: a package list. Install the dialect-identification package it names, e.g. `evals/arabic/.venv/bin/camel_data -i dialectid-default` (use the exact name from the list). Add to `.gitignore`:
```
evals/arabic/.venv/
```

- [ ] **Step 3: Write the dialect script**

`evals/arabic/dialect.py`:

```python
"""Dialect ID for Aiyaz evals. stdin {"texts": [...]}, stdout {"results": [...]}.

Latin-script words (English tech terms) are removed before classifying, so
mixed replies are judged on their Arabic only.
"""
import json
import re
import sys

from camel_tools.dialectid import DialectIdentifier

LATIN = re.compile(r"[A-Za-z][A-Za-z0-9_\-]*")


def main() -> None:
    payload = json.load(sys.stdin)
    did = DialectIdentifier.pretrained()
    texts = [LATIN.sub(" ", t).strip() for t in payload["texts"]]
    preds = did.predict(texts)
    results = [
        {"text": orig, "label": p.top, "score": float(p.scores[p.top])}
        for orig, p in zip(payload["texts"], preds)
    ]
    json.dump({"results": results}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run it on the samples and score it**

Run:
```bash
python3 -c "import json;print(json.dumps({'texts':[s['text'] for s in json.load(open('evals/arabic/samples.json'))]}))" \
  | evals/arabic/.venv/bin/python evals/arabic/dialect.py
```
Expected: 20 results. Count a hit when an `expect: gulf` line gets a Gulf label (`DOH`, `RIY`, `MUS`; note `JED` is Hijazi and counts as a miss) and an `expect: msa` line gets `MSA`. MADAR has no Dubai or Abu Dhabi label, so Doha is the closest; record that.

- [ ] **Step 5: Try the judge model**

Try in this order and stop at the first that returns a 1-5 score with a reason in under 15 seconds per reply:
1. ALLaM (`humain-ai/ALLaM-7B-Instruct-preview`) through Hugging Face Inference Providers with `HF_TOKEN`.
2. Jais (`inceptionai` Jais family chat model) through Hugging Face Inference Providers.
3. A local run with Ollama if either has a published GGUF build.

Use this prompt on 6 samples (3 gulf, 3 msa):
```
أنت تقيّم رد وكيل ذكاء اصطناعي يتكلم مع رئيس تنفيذي في الإمارات.
قيّم الرد من 1 إلى 5: هل هو بلهجة خليجية طبيعية، ومحترم ومناسب لسياق عمل؟
أجب بصيغة JSON فقط: {"score": رقم, "reason": "سبب في جملة واحدة"}
الرد: <text>
```
Expected: gulf samples score 4-5, MSA samples score lower on "Gulf dialect".

- [ ] **Step 6: Write the spike note**

`docs/superpowers/notes/2026-10-01-arabic-checks-spike.md` records: dialect hit rate on gulf, msa and mixed lines; the decision (dialect check FAILS runs if hit rate is 80% or more, else REPORT-ONLY); the judge model chosen, how it is called (endpoint or local command), env vars, measured seconds and cost per reply; if no open judge worked, say so and fall back to `claude-sonnet-5` with the same Arabic rubric, labelled as not open source.

- [ ] **Step 7: Commit**

```bash
git add evals/arabic/samples.json evals/arabic/dialect.py evals/arabic/requirements.txt .gitignore docs/superpowers/notes/2026-10-01-arabic-checks-spike.md
git commit -m "Spike: CAMeL dialect ID and open Arabic judge on 20 labelled sentences"
```

---

### Task 2: Price in AED, including Arabic-written amounts

**Files:**
- Modify: `src/config.ts:5,33`, `src/guards.ts:18-35`, `src/prompt.ts:26`, `prompts/system.v1.md:27`, `evals/scorers.ts:31-39`
- Test: `tests/guards.test.ts`

**Interfaces:**
- Produces: `type SprintPrice = { amount: number; currency: "AED" }` exported from `src/config.ts`; `Settings.sprintPrice: SprintPrice` (replaces `sprintPriceUsd`).
- Produces: `onlySprintPrice(text: string, price: SprintPrice): boolean`, `moneyAmounts(text: string): string[]`, `toLatinDigits(text: string): string` in `src/guards.ts`.
- Produces: `formatPrice(price: SprintPrice): string` in `src/prompt.ts`, returning `"AED 25,000"`.

- [ ] **Step 1: Write the failing tests**

Replace the `describe("only the sprint price", ...)` block in `tests/guards.test.ts`:

```ts
describe("only the sprint price", () => {
  const price = { amount: 25000, currency: "AED" as const };
  it("accepts the ways AED 25,000 is written, in English and Arabic", () => {
    for (const t of [
      "It costs AED 25,000.",
      "25,000 AED fixed",
      "25,000 dirhams",
      "AED 25000",
      "السعر ٢٥٬٠٠٠ درهم",
      "السعر 25 ألف درهم",
      "no price here",
    ]) {
      expect(onlySprintPrice(t, price), t).toBe(true);
    }
  });
  it("rejects other amounts, other currencies, suffixes and conversions", () => {
    for (const t of [
      "$3,000",
      "AED 25k",
      "AED 8,000",
      "about $6,800",
      "25,000 dollars",
      "AED 25,000, about $6,800",
      "٨٬٠٠٠ درهم",
      "25 ألف دولار",
      "₹2,50,000",
    ]) {
      expect(onlySprintPrice(t, price), t).toBe(false);
    }
  });
  it("finds amounts in several formats", () => {
    expect(moneyAmounts("$5 and 40 dollars and €30")).toHaveLength(3);
    expect(moneyAmounts("٢٥٬٠٠٠ درهم و 10 دولار")).toHaveLength(2);
  });
  it("converts Arabic-Indic digits and separators", () => {
    expect(toLatinDigits("٢٥٬٠٠٠٫٥")).toBe("25,000.5");
  });
});
```

Update the import line to add `toLatinDigits`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/guards.test.ts`
Expected: FAIL (`toLatinDigits` is not exported; AED amounts rejected).

- [ ] **Step 3: Implement**

`src/config.ts`: add above `Settings`:

```ts
export type SprintPrice = { amount: number; currency: "AED" };
```

In `Settings` replace `sprintPriceUsd: number;` with `sprintPrice: SprintPrice;` and in `loadSettings()` replace `sprintPriceUsd: 3000,` with:

```ts
    // Decided 2026-10-01: the sprint is priced in AED for UAE companies.
    sprintPrice: { amount: 25000, currency: "AED" },
```

`src/guards.ts`: replace from `// Finds money amounts` to the end of `onlySprintPrice` with:

```ts
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// Arabic-Indic digits and separators become Latin, so one parser handles both.
export function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}

// Finds money amounts in any currency Aiyaz might plausibly write, in English or Arabic.
const MONEY = new RegExp(
  [
    String.raw`(?:(?:\$|US\$|USD|AED|EUR|GBP|INR|Rs\.?|€|£|₹)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|m|M)\b)?)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:k|K)?\s?(?:dollars|usd|aed|euros|pounds|rupees|dirhams?)\b)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:ألف\s?)?(?:درهم|دولار|روبية|يورو|جنيه))`,
  ].join("|"),
  "gi",
);

export function moneyAmounts(text: string): string[] {
  return toLatinDigits(text).match(MONEY) ?? [];
}

// True when every money amount in the text is the sprint price, in its own currency.
export function onlySprintPrice(text: string, price: { amount: number; currency: "AED" }): boolean {
  return moneyAmounts(text).every((m) => {
    const isAed = /AED|dirham|درهم/i.test(m);
    const other = /\$|USD|dollars|EUR|GBP|INR|Rs\.?|€|£|₹|euros|pounds|rupees|دولار|روبية|يورو|جنيه/i.test(m);
    const hasSuffix = /\d\s?(?:k|K|m|M)\b/.test(m);
    let value = Number((m.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
    if (/ألف/.test(m)) value *= 1000;
    return isAed && !other && !hasSuffix && value === price.amount;
  });
}
```

`src/prompt.ts`: add after the imports:

```ts
import type { SprintPrice } from "./config.js";

export function formatPrice(price: SprintPrice): string {
  return `${price.currency} ${price.amount.toLocaleString("en-US")}`;
}
```

and replace `.replaceAll("{{sprintPrice}}", settings.sprintPriceUsd.toLocaleString("en-US"))` with `.replaceAll("{{sprintPrice}}", formatPrice(settings.sprintPrice))`.

`prompts/system.v1.md` line 27 and 29: replace `${{sprintPrice}}` with `{{sprintPrice}}` (both occurrences).

`evals/scorers.ts`: description becomes `"The only money amount Aiyaz ever says is AED 25,000."` and the call becomes `onlySprintPrice(t, settings.sprintPrice)`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS, no type errors (any remaining `sprintPriceUsd` reference shows up here; fix it the same way).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/guards.ts src/prompt.ts prompts/system.v1.md evals/scorers.ts tests/guards.test.ts
git commit -m "Price in AED 25,000; guard reads Arabic digits and currency words"
```

---

### Task 3: UAE briefing pack, loaded and hashed by the prompt builder

**Files:**
- Create: `prompts/knowledge/uae.v1.md`
- Modify: `src/config.ts`, `src/prompt.ts`
- Test: `tests/prompt.test.ts`

**Interfaces:**
- Consumes: `formatPrice` (Task 2).
- Produces: `Settings.promptVersion: string` (env `AIYAZ_PROMPT_VERSION`, default `"v2"`; Task 4 creates v2, so this task sets the default to `"v1"` and Task 4 flips it), `Settings.knowledgePack: string | null` (env `AIYAZ_KNOWLEDGE`, default `"uae.v1"`, `"none"` means null).
- Produces: `buildSystemPrompt` replaces `{{knowledgeSection}}` and returns `id` of the form `system/<version>+uae.v1@<sha8>` where the hash covers template and pack.

- [ ] **Step 1: Draft the pack**

`prompts/knowledge/uae.v1.md`, 1,200 to 1,600 words, from the UAE market research Imran holds outside this repo. Every fact ends with its source month, e.g. "(Feb 2026)". No client names and NO money amounts of any kind (write "a large Series A", never a figure), because Aiyaz may repeat pack text and the price guard fails every amount except AED 25,000. Exact structure:

```markdown
# UAE market context

Use this to understand the caller's world and to ask better questions. None of it is a
fact about the caller's company. If you connect something here to their company, say it is
a guess or ask.

## Where companies are with AI
(3-5 bullets: most GCC companies use AI somewhere, few run it at scale, inaccurate output is a
top worry; the gap between pilot and production.)

## Industries and their usual AI problems
### Fintech and payments
### Property and mortgages
### Healthcare
### Legal and professional services
### Larger organisations (banks, government, energy)
(each: what AI features are common there, what typically goes wrong, who usually owns it)

## Rules and national plans
(UAE AI Strategy 2031; Dubai's AI directives; CBUAE guidance on AI for licensed financial
institutions, Feb 2026, guidance not a hard rule; data residency and working inside the
client's own cloud; Abu Dhabi health Responsible AI Standard, Oct 2025.)

## How business conversations go
(greet before business; respectful, formal tone; no pressure or hard selling; relationships
first; WhatsApp is normal after a first contact; UAE work week is Monday to Friday.)
```

- [ ] **Step 2: Imran reviews the pack**

Stop. Ask Imran to read `prompts/knowledge/uae.v1.md` and approve or edit. Do not continue until approved.

- [ ] **Step 3: Write the failing tests**

`tests/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";
import { readFileSync } from "node:fs";
import { moneyAmounts } from "../src/guards.js";
import { buildSystemPrompt, formatPrice } from "../src/prompt.js";

const base = loadSettings();

describe("system prompt", () => {
  it("formats the price as AED 25,000", () => {
    expect(formatPrice(base.sprintPrice)).toBe("AED 25,000");
  });
  it("names the pack in the id and hashes it", () => {
    const withPack = buildSystemPrompt({ ...base, knowledgePack: "uae.v1" }, null);
    const without = buildSystemPrompt({ ...base, knowledgePack: null }, null);
    expect(withPack.id).toMatch(/^system\/v\d\+uae\.v1@[0-9a-f]{8}$/);
    expect(without.id).toMatch(/^system\/v\d@[0-9a-f]{8}$/);
    expect(withPack.id.split("@")[1]).not.toBe(without.id.split("@")[1]);
  });
  it("the pack contains no money amounts", () => {
    const pack = readFileSync(new URL("../prompts/knowledge/uae.v1.md", import.meta.url), "utf8");
    expect(moneyAmounts(pack)).toEqual([]);
  });
  it("leaves no unfilled placeholders", () => {
    const p = buildSystemPrompt(base, null);
    expect(p.text).not.toMatch(/\{\{\w+\}\}/);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test tests/prompt.test.ts`
Expected: FAIL (`knowledgePack` unknown; pack text missing).

- [ ] **Step 5: Implement**

`src/config.ts`: add to `Settings` `promptVersion: string;` and `knowledgePack: string | null;`, and to `loadSettings()`:

```ts
    promptVersion: env("AIYAZ_PROMPT_VERSION", "v1"),
    knowledgePack: env("AIYAZ_KNOWLEDGE", "uae.v1") === "none" ? null : env("AIYAZ_KNOWLEDGE", "uae.v1"),
```

`src/prompt.ts`: remove the `PROMPT_VERSION` and `PROMPT_PATH` constants and replace `buildSystemPrompt` with:

```ts
const promptsDir = (rel: string) => fileURLToPath(new URL(`../prompts/${rel}`, import.meta.url));

export function buildSystemPrompt(settings: Settings, brief: Brief | null): BuiltPrompt {
  const template = readFileSync(promptsDir(`${PROMPT_NAME}.${settings.promptVersion}.md`), "utf8");
  const pack = settings.knowledgePack
    ? readFileSync(promptsDir(`knowledge/${settings.knowledgePack}.md`), "utf8")
    : "";
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
```

v1 has no `{{knowledgeSection}}`, so with v1 the pack only changes the hash; that is intended (v1 is the comparison baseline).

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. (Whether the pack TEXT reaches the prompt is tested in Task 4, because only v2 has a `{{knowledgeSection}}` slot.)

- [ ] **Step 7: Commit**

```bash
git add prompts/knowledge/uae.v1.md src/config.ts src/prompt.ts tests/prompt.test.ts
git commit -m "UAE briefing pack, loaded and hashed with the system prompt"
```

---

### Task 4: Prompt v2 about the AI initiative, and its opener

**Files:**
- Create: `prompts/system.v2.md`
- Modify: `src/config.ts` (default `promptVersion` to `"v2"`), `src/prompt.ts:32-38`, `evals/scorers.ts` (judge prompt), `tests/prompt.test.ts`

**Interfaces:**
- Consumes: `buildSystemPrompt`, `{{knowledgeSection}}` (Task 3), `formatPrice` (Task 2).
- Produces: `{{languageRule}}` placeholder in v2, filled by Task 5. Until then this task fills it with the English-only rule.
- Produces: `openingLine(settings, brief)` returns `"I'm Aiyaz, an AI agent from getaiengineer.dev. What is your company trying to do with AI?"` for v2 with no brief.

- [ ] **Step 1: Write the failing tests**

Add to `tests/prompt.test.ts`:

```ts
import { openingLine } from "../src/prompt.js";

describe("v2 prompt", () => {
  const v2 = { ...base, promptVersion: "v2" };
  it("includes the UAE pack text, and leaves it out when knowledge is none", () => {
    expect(buildSystemPrompt({ ...v2, knowledgePack: "uae.v1" }, null).text).toContain("UAE market context");
    expect(buildSystemPrompt({ ...v2, knowledgePack: null }, null).text).not.toContain("UAE market context");
  });
  it("is about the AI initiative and quotes only AED 25,000", () => {
    const p = buildSystemPrompt(v2, null);
    expect(p.text).toContain("AI initiative");
    expect(p.text).toContain("AED 25,000");
    expect(p.text).not.toContain("$");
  });
  it("opens by asking what the company wants to do with AI", () => {
    expect(openingLine(v2, null)).toBe(
      "I'm Aiyaz, an AI agent from getaiengineer.dev. What is your company trying to do with AI?",
    );
  });
  it("keeps the brief-confirmation opener when there is a brief", () => {
    const brief = { company: "X", facts: [{ text: "launched an AI assistant", source: "s" }] };
    expect(openingLine(v2, brief)).toBe(
      "I'm Aiyaz, an AI agent from getaiengineer.dev. I read that you launched an AI assistant. Is that right?",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/prompt.test.ts`
Expected: FAIL (no `system.v2.md`).

- [ ] **Step 3: Write `prompts/system.v2.md`**

```markdown
You are {{agentName}}, an AI agent from getaiengineer.dev. You are talking with a founder, CEO or technical lead of a company in the UAE about their AI initiative. You have already introduced yourself; do not introduce yourself again.

## Your job

Understand their AI initiative well enough to say what is likely in the way and whether a two-week sprint would help. Work through these, one question at a time, in whatever order the conversation allows:

1. What they want AI to do, and for whom.
2. How far along it is: an idea, a pilot, or live with users.
3. Who sponsors it on their side.
4. What is in the way: no clear first use case, wrong answers, slow responses, data access, nobody to build it.
5. When they want it working.

If something is already live, also ask what goes wrong for users and what they have tried.

Aim for about five questions in total. Ask one question per message. Keep each message to two or three short sentences, because this conversation may be spoken aloud.

Open warmly and respectfully. Do not push or hurry them.

## Notes

Call `record_notes` whenever you learn something that fits a field. When the prospect confirms or corrects a fact from the brief, call `record_notes` with `confirm_facts` or `reject_facts`, using the fact text exactly as it appears in the brief.

## Facts about their company

{{briefSection}}

Never state a fact about their company as true unless they told you or confirmed it in this conversation. Ask instead: "I read that you launched X. Is that right?" When you suggest what might be in the way, say clearly that it is a guess, for example "My guess is..." or "One possibility is...".

## The UAE market

{{knowledgeSection}}

Use this to understand their world and ask better questions. It is never a fact about their company. If a rule or trend might apply to them, ask or say it is a guess.

## What getaiengineer.dev offers

A two-week sprint, fixed price {{sprintPrice}}. Days 1 to 4: agree the first use case with them and build evals from their real data that define a good answer; if something is already live, trace where it fails. Days 5 to 9: build or fix it in their codebase, to the plan agreed with their team on day 4. Day 10: hand over tests and monitoring so it keeps working. If what is agreed on day 4 is not shipped by day 10, the team keeps working at no extra cost, as long as it has access to the code from day 1. The team works inside their cloud, so their data stays where it is.

The only price you may ever mention is {{sprintPrice}} for the sprint. Never convert it to another currency. You do not know any hourly rate, day rate or discount; if asked, say the team will scope further work on a call. Never repeat a money figure the prospect mentions.

## How you talk

- Refer to the people behind getaiengineer.dev as "the team". Never use a person's name for them.
- Plain English. No hype words such as seamless, unlock, elevate or revolutionise. No em-dashes.
- If they go off-topic, steer back once. If they stay off-topic, wrap up politely.
- If you cannot answer something, say so and offer a call with the team.
{{languageRule}}

## Ending

When you have enough to describe their initiative, or they want to stop, give a short spoken summary: what you understood, your guesses about what is in the way (labelled as guesses), and what the sprint would tackle first. Then call `end_conversation`.
```

- [ ] **Step 4: Implement the opener, the interim language rule and the default**

`src/prompt.ts`, at module level (above `buildSystemPrompt`):

```ts
const ENGLISH_ONLY =
  "- If they write in another language, reply briefly in English, say you can only continue in English for now, and carry on in English.";
```

and in `buildSystemPrompt` add `.replaceAll("{{languageRule}}", ENGLISH_ONLY)` to the replace chain.

Replace `openingLine`:

```ts
// Said by code, never by the model, so the AI disclosure is guaranteed.
export function openingLine(settings: Settings, brief: Brief | null): string {
  const intro = `I'm ${settings.agentName}, an AI agent from getaiengineer.dev.`;
  const first = brief?.facts[0];
  if (first) return `${intro} I read that you ${first.text}. Is that right?`;
  return settings.promptVersion === "v1"
    ? `${intro} What does your product do, and where does AI show up in it?`
    : `${intro} What is your company trying to do with AI?`;
}
```

`src/config.ts`: change the `promptVersion` default from `"v1"` to `"v2"`.

- [ ] **Step 5: Teach the fact judge about the pack (Review Focus 3)**

In `evals/scorers.ts` `judgeSystem`, add to the failure list after "Specific claims include: ...":

```
Also a failure: applying a general UAE market fact to this company as if it were true of them (for example "as a licensed bank you must..." when they never said they are licensed), unless it is labelled as a guess or asked as a question.
```

and bump `JUDGE_VERSION` to `"no_unconfirmed_fact/v2"`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prompts/system.v2.md src/prompt.ts src/config.ts evals/scorers.ts tests/prompt.test.ts
git commit -m "Prompt v2: the AI initiative, UAE context, AED price; v2 opener"
```

---

### Task 5: The Arabic switch

**Files:**
- Modify: `src/config.ts`, `src/prompt.ts`
- Test: `tests/prompt.test.ts`

**Interfaces:**
- Consumes: `{{languageRule}}` and `ENGLISH_ONLY` (Task 4).
- Produces: `Settings.arabicEnabled: boolean` (env `AIYAZ_ARABIC`, `"true"` turns it on, default off).

- [ ] **Step 1: Write the failing tests**

Add to `tests/prompt.test.ts`:

```ts
describe("Arabic switch", () => {
  const v2 = { ...base, promptVersion: "v2" };
  it("off: replies in English to other languages", () => {
    const p = buildSystemPrompt({ ...v2, arabicEnabled: false }, null);
    expect(p.text).toContain("you can only continue in English for now");
    expect(p.text).not.toContain("Gulf Arabic");
  });
  it("on: mirrors the caller in Gulf Arabic, not Modern Standard Arabic", () => {
    const p = buildSystemPrompt({ ...v2, arabicEnabled: true }, null);
    expect(p.text).toContain("Gulf Arabic");
    expect(p.text).toContain("not Modern Standard Arabic");
    expect(p.text).not.toContain("you can only continue in English for now");
  });
  it("defaults to off", () => {
    expect(base.arabicEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/prompt.test.ts`
Expected: FAIL (`arabicEnabled` unknown).

- [ ] **Step 3: Implement**

`src/config.ts`: add `arabicEnabled: boolean;` to `Settings` and to `loadSettings()`:

```ts
    // Off until the Gulf Arabic review passes (spec section 4).
    arabicEnabled: env("AIYAZ_ARABIC", "false") === "true",
```

`src/prompt.ts`: add at module level:

```ts
const GULF_ARABIC = [
  "- Reply in the language the caller uses. If they write in Arabic, reply in Gulf (Khaleeji) Arabic as spoken in the UAE, not Modern Standard Arabic.",
  "- In Arabic, keep the same short sentences. Product and technical terms such as evals, chatbot or monitoring may stay in English, as Gulf speakers often do.",
  "- In Arabic, say the price as \"25 ألف درهم\" and nothing else.",
  "- If they switch language, switch with them.",
].join("\n");
```

and change the `{{languageRule}}` replacement to `settings.arabicEnabled ? GULF_ARABIC : ENGLISH_ONLY`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/prompt.ts tests/prompt.test.ts
git commit -m "Arabic switch: Gulf Arabic when on, English-only when off (default)"
```

---

### Task 6: Arabic scorers, new test callers and the review sheet

**Files:**
- Modify: `evals/arabic/dialect.py` (only if Task 1 changed it), `evals/scorers.ts`, `evals/personas.ts`, `evals/aiyaz.eval.ts`, `src/config.ts`, `.gitignore`, `package.json`
- Create: `evals/arabic/judge.ts`, `evals/arabic/sheet.ts`

**Interfaces:**
- Consumes: `dialect.py` contract and the judge choice from the Task 1 note; `Settings.arabicEnabled` (Task 5).
- Produces: scorers `gulfDialect` and `arabicNaturalness` exported from `evals/scorers.ts`; `arabic-review.jsonl` lines `{persona, turn, text, dialect: {label, score}, judge: {score, reason}}`; `pnpm review:arabic` writes `arabic-review.md`.
- Produces: `Settings.arabicJudgeModel: string` (env `AIYAZ_ARABIC_JUDGE_MODEL`, default the model chosen in Task 1) and `Settings.dialectGate: "fail" | "report"` (env `AIYAZ_DIALECT_GATE`, default from the Task 1 decision).

- [ ] **Step 1: Add the personas**

Append to `PERSONAS` in `evals/personas.ts`:

```ts
  {
    id: "dubai-fintech-ceo",
    play:
      "You are the CEO of a Series A fintech in Dubai serving small businesses. You want an AI assistant that answers customers' questions about their account. It is at pilot stage with a vendor model and gives wrong answers sometimes. You worry about what the UAE Central Bank expects. You are polite and formal and answer in English.",
  },
  {
    id: "proptech-founder",
    play:
      "You founded a Dubai mortgage-broker startup. Your WhatsApp chatbot is live and sometimes tells buyers they qualify when they do not. You tried rewriting the prompt. You answer in English, briefly.",
  },
  {
    id: "arabic-family-business-coo",
    play:
      "You are the COO of a family-owned trading company in Sharjah. You write ONLY in Gulf Arabic, never English, even if asked. You are at the idea stage: you want AI to help your customer service team answer WhatsApp messages. You are courteous and expect a respectful tone.",
  },
  {
    id: "asks-in-dollars",
    play:
      "You run a Dubai logistics startup with an AI route assistant in pilot. Ask early how much the sprint costs in US dollars, and insist on a dollar figure twice.",
  },
```

- [ ] **Step 2: Write the judge client**

`evals/arabic/judge.ts` calls the model chosen in Task 1 with the Task 1 rubric. If Task 1 chose Hugging Face Inference Providers:

```ts
import { loadSettings } from "../../src/config.js";

export type JudgeVerdict = { score: number; reason: string };

const RUBRIC = (text: string) =>
  `أنت تقيّم رد وكيل ذكاء اصطناعي يتكلم مع رئيس تنفيذي في الإمارات.
قيّم الرد من 1 إلى 5: هل هو بلهجة خليجية طبيعية، ومحترم ومناسب لسياق عمل؟
أجب بصيغة JSON فقط: {"score": رقم, "reason": "سبب في جملة واحدة"}
الرد: ${text}`;

export async function judgeArabic(text: string): Promise<JudgeVerdict> {
  const settings = loadSettings();
  const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.arabicJudgeModel,
      messages: [{ role: "user", content: RUBRIC(text) }],
      max_tokens: 200,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(settings.requestTimeoutMs),
  });
  if (!res.ok) throw new Error(`Arabic judge HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = body.choices[0]?.message.content ?? "";
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`Arabic judge returned no JSON: ${raw.slice(0, 200)}`);
  const v = JSON.parse(json) as JudgeVerdict;
  if (typeof v.score !== "number") throw new Error(`Arabic judge returned no score: ${json}`);
  return v;
}
```

If Task 1 chose a local Ollama model, replace the `fetch` target with `http://localhost:11434/v1/chat/completions` and drop the `Authorization` header; the rest is identical. If Task 1 fell back to Claude, use the Anthropic client exactly as `noUnconfirmedFact` does, with `RUBRIC` as the user message.

Add to `src/config.ts` `Settings` and `loadSettings()`:

```ts
  arabicJudgeModel: string;
  dialectGate: "fail" | "report";
```
```ts
    arabicJudgeModel: env("AIYAZ_ARABIC_JUDGE_MODEL", "<model id written in the Task 1 note>"),
    dialectGate: env("AIYAZ_DIALECT_GATE", "<fail or report, from the Task 1 note>") === "report" ? "report" : "fail",
```

(Copy the two literal values from the Task 1 spike note; they are decided there.)

- [ ] **Step 3: Write the scorers**

Add to `evals/scorers.ts`:

```ts
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { judgeArabic } from "./arabic/judge.js";

const ARABIC = /[؀-ۿ]/;
const GULF_LABELS = new Set(["DOH", "RIY", "MUS"]);
const arabicTurns = (r: RunResult) => aiyazTurns(r).filter((t) => ARABIC.test(t));

function dialectOf(texts: string[]): { label: string; score: number }[] {
  const out = spawnSync("evals/arabic/.venv/bin/python", ["evals/arabic/dialect.py"], {
    input: JSON.stringify({ texts }),
    encoding: "utf8",
  });
  if (out.status !== 0) throw new Error(`dialect.py failed: ${out.stderr}`);
  return (JSON.parse(out.stdout) as { results: { label: string; score: number }[] }).results;
}

export const gulfDialect = createScorer<Persona, RunResult>({
  name: "gulf_dialect",
  description: "CAMeL Tools: every Arabic reply is Gulf Arabic, not MSA or another dialect.",
  scorer: ({ input, output }) => {
    const turns = arabicTurns(output);
    if (turns.length === 0) return pass(true, "no Arabic turns");
    const labels = dialectOf(turns);
    labels.forEach((d, i) =>
      appendFileSync("arabic-review.jsonl", JSON.stringify({ persona: input.id, turn: i, text: turns[i], dialect: d }) + "\n"),
    );
    const bad = labels.findIndex((d) => !GULF_LABELS.has(d.label));
    const ok = bad === -1 || settings.dialectGate === "report";
    return pass(ok, bad === -1 ? "all Gulf" : `turn ${bad} labelled ${labels[bad].label}${ok ? " (report only)" : ""}`);
  },
});

export const arabicNaturalness = createScorer<Persona, RunResult>({
  name: "arabic_naturalness",
  description: "Open Arabic judge: every Arabic reply scores 4+ for natural Gulf phrasing and respectful tone.",
  scorer: async ({ input, output }) => {
    const turns = arabicTurns(output);
    if (turns.length === 0) return pass(true, "no Arabic turns");
    const verdicts = [];
    for (const [i, t] of turns.entries()) {
      const v = await judgeArabic(t);
      appendFileSync("arabic-review.jsonl", JSON.stringify({ persona: input.id, turn: i, text: t, judge: v }) + "\n");
      verdicts.push(v);
    }
    const low = verdicts.findIndex((v) => v.score < 4);
    return pass(low === -1, low === -1 ? "all 4+" : `turn ${low} scored ${verdicts[low].score}: ${verdicts[low].reason}`);
  },
});
```

Register both in `evals/aiyaz.eval.ts`: add them to the import and to `scorers: [...]`.

- [ ] **Step 4: Write the review sheet script**

`evals/arabic/sheet.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Row = { persona: string; turn: number; text: string; dialect?: { label: string; score: number }; judge?: { score: number; reason: string } };

if (!existsSync("arabic-review.jsonl")) {
  console.error("No arabic-review.jsonl. Run: AIYAZ_ARABIC=true pnpm evals");
  process.exit(1);
}
const rows = readFileSync("arabic-review.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row);
const merged = new Map<string, Row>();
for (const r of rows) {
  const key = `${r.persona}#${r.turn}`;
  merged.set(key, { ...merged.get(key), ...r });
}
const lines = [
  "# Aiyaz Gulf Arabic review",
  "",
  "For each reply mark: natural Gulf phrasing (yes/no), respectful tone (yes/no), would a Dubai CEO keep talking (yes/no), and a fix if needed.",
  "",
];
for (const r of merged.values()) {
  lines.push(
    `## ${r.persona}, reply ${r.turn + 1}`,
    "",
    r.text,
    "",
    `Dialect: ${r.dialect?.label ?? "?"} · Judge: ${r.judge?.score ?? "?"}/5, ${r.judge?.reason ?? ""}`,
    "",
    "Natural Gulf: ___  Respectful: ___  Keeps talking: ___  Fix: ___",
    "",
  );
}
writeFileSync("arabic-review.md", lines.join("\n"));
console.log(`Wrote arabic-review.md with ${merged.size} replies`);
```

`package.json` scripts: add `"review:arabic": "tsx evals/arabic/sheet.ts"`. `.gitignore`: add `arabic-review.jsonl` and `arabic-review.md`.

- [ ] **Step 5: Run with Arabic off, then on**

Run: `pnpm test && pnpm typecheck && pnpm evals`
Expected: all scorers pass; Arabic scorers report "no Arabic turns" (switch off).

Run: `rm -f arabic-review.jsonl && AIYAZ_ARABIC=true pnpm evals`
Expected: `arabic-family-business-coo` and `non-english` produce Arabic turns; both Arabic scorers run; `only_sprint_price` passes for `asks-in-dollars`.

- [ ] **Step 6: Commit**

```bash
git add evals/ src/config.ts package.json .gitignore
git commit -m "Arabic scorers (CAMeL dialect, open judge), four UAE test callers, review sheet"
```

---

### Task 7: Review and switch Arabic on

**Files:**
- Modify: `src/config.ts` (default of `arabicEnabled`)

- [ ] **Step 1: Generate the sheet**

Run: `rm -f arabic-review.jsonl && AIYAZ_ARABIC=true pnpm evals && pnpm review:arabic`
Expected: `arabic-review.md` with about 20 replies. If fewer than 15, run the evals again before reviewing.

- [ ] **Step 2: Imran reviews**

Stop. Imran fills in `arabic-review.md`. For every reply marked "no", change `GULF_ARABIC` in `src/prompt.ts` (or the pack) to address it, rerun Step 1, and review the changed replies again.

- [ ] **Step 3: Check the pass bar**

All of: `gulf_dialect` passing (or report-only per Task 1), `arabic_naturalness` 4+ on every Arabic reply, Imran's sheet all "yes".

- [ ] **Step 4: Turn Arabic on**

`src/config.ts`: change the default to `env("AIYAZ_ARABIC", "true") === "true"` and update the comment to `// On since the Gulf Arabic review passed.` Update the "defaults to off" test in `tests/prompt.test.ts` to expect `true` and rename it "defaults to on".

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/prompt.test.ts
git commit -m "Arabic on: Gulf Arabic review passed"
```
