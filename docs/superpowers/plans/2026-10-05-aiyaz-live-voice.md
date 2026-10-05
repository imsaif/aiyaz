# Aiyaz Live Voice on getaiengineer.dev: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors to getaiengineer.dev press the Aiyaz card and talk out loud with Aiyaz, either as a homepage call (email first, country-aware price) or as a lead call from a private `?ref=<slug>` link that loads a research brief. Every call ends with booking and WhatsApp on screen and a summary email to the team.

**Architecture:** The existing text brain (`Conversation`) stays the only thing that talks to Claude. A LiveKit Agents for Node worker on Fly.io wraps it: Deepgram hears, ElevenLabs or Cartesia speaks, LiveKit handles turn-taking and interruptions, and a custom `llm.LLM` hands each finished visitor turn to `Conversation.reply()` exactly once. The site (static, Vercel) gets an edge function that checks the email or slug, the per-visitor limit and the daily cap in Upstash, then mints a LiveKit token whose metadata is `{ country, slug?, email? }`; the worker reads the brief from Upstash, picks price and market pack from the country, and on close stores the transcript (30 days), settles the day's spend and emails the team through Resend.

**Tech Stack:** TypeScript (Node 24, ESM, tsx, pnpm), `@anthropic-ai/sdk`, `@livekit/agents` 1.9.1 with `@livekit/agents-plugin-deepgram`, `-silero`, `-elevenlabs`, `-cartesia` 1.9.1, `@livekit/rtc-node` 1.1.0, `zod`, `livekit-server-sdk` 2.19.1 (worker dev script and site edge function), `livekit-client` 2.22.3 (browser, vendored into the site), Vitest, Evalite, Upstash Redis REST, Resend, Fly.io, Vercel. These versions come from the earlier plan on branch `voice-company-page`; they are installed in Task 13 and proven end to end in the voice spike (Task 14). If a version no longer installs or its API differs, the spike task records the version actually used.

**Spec:** `docs/superpowers/specs/2026-10-05-aiyaz-live-voice-design.md` (authority). Background: `2026-09-28-aiyaz-design.md` (the agent) and `2026-10-01-aiyaz-uae-knowledge-design.md` (prompt v2, packs, AED price, Arabic switch). The earlier per-company plan and code live on branch `voice-company-page`; this plan ports its per-turn defer, turn serializer, slug and brief-shape checks, summary builder, worker skeleton, token minting and Fly files, and drops its prompt v2, `$3,000` price, `intro`/`offer`/`allowedNames` brief fields and env-var briefs.

**Repos and branches:**
- Tasks 1 to 9 and 13 to 17 (worker part): `~/aiyaz`, worktree `.claude/worktrees/live-voice`, branch `live-voice`.
- Tasks 10 to 12 and 17 (site part): `~/getaiengineer` (private), new worktree and branch `aiyaz-live-voice` from `main`, created in Task 10 Step 1. The pending `tracking` branch touches `index.html` and `package.json` too; whichever merges second resolves those two files by hand.

## Amendments (Imran, 2026-10-05, after plan review), which override the tasks below

1. **Visitor summary email.** Task 9: after the team email, if the visitor's email is known, also send the visitor an email via Resend, subject "Your call with Aiyaz", body = the same plain-text summary the visitor heard (no internal notes, no cost, no country), followed by the booking link and WhatsApp link. Sender: `Aiyaz <work@getaiengineer.dev>`. Add a test that the visitor email contains the summary and both links and no cost figure. If `RESEND_API_KEY` is missing, log and skip both emails.
2. **Lead-call email capture.** Task 8 (or wherever `record_notes` is extended): add an optional `visitor_email` field to the `record_notes` tool, validated with the same email check as the token function; Aiyaz asks for it at the end of a lead call to send the summary. The call log (Task 9) stores it, and amendment 1 uses it. Add a unit test that an invalid email is not stored.
3. **Latency gate.** Task 14: pass when the median time from the visitor finishing a turn to Aiyaz starting to speak is at most 2.5 s, and the 90th percentile at most 3.5 s (Sonnet's measured median is about 2.1 s). Record the numbers in the spike note.
4. **Execution:** subagent-driven, one fresh implementer and reviewer per task.
5. **Resend domain.** Before Task 16, Imran verifies getaiengineer.dev in Resend by adding Resend's DNS records at Porkbun (keep the existing MX/TXT forwarding records untouched; Resend uses its own subdomain records).

## Global Constraints

- **Price by country (one table, two repos):** `AE` gives AED 25,000; any other known country gives USD 6,000 (the site shows `$6,000`); unknown gives AED 25,000. A country is known when, after trim and uppercase, it matches `/^[A-Z]{2}$/`. The aiyaz side is `priceKey()` in `src/config.ts`, the site side is `priceFor()` in `price-core.js`; both are tested against the same table: `AE, ae -> AED`; `IN, US, GB, " in " -> USD`; `"", null, UAE -> AED`.
- **Market pack by country:** `AE` and unknown use `uae.v1`; other known countries use `general.v1`. `AIYAZ_KNOWLEDGE=none` turns packs off; any other value forces that pack for every country.
- Aiyaz says it is an AI in its first sentence; the opener is fixed text from code (`openingLine`), never from the model.
- It never says "Imran"; the name is scrubbed to "the team".
- A company fact is asked, never asserted, until the visitor confirms it. Brief facts with no source, or with a money amount, are dropped before the call starts.
- No stage directions, tool acknowledgements or bracketed notes are ever spoken.
- Arabic switch stays off (`AIYAZ_ARABIC` default `false`); even when on, the Gulf Arabic rule applies only to AED visitors.
- **Private briefs** live only in Upstash under `aiyaz:brief:<slug>`. They never enter this public repo, its tests, fixtures, eval personas, traces, logs, commit messages or this plan. Tests use the made-up company "Acme". No real lead name appears anywhere in this repo.
- **Upstash keys (shared contract between the two repos):**
  - `aiyaz:brief:<slug>`: JSON `{ "company": string, "facts": [{ "text": string, "source": string }] }`, no expiry, written by `pnpm briefs --write`.
  - `aiyaz:slug-for:<company-key>`: the slug already given to that company, so reruns keep links stable.
  - `aiyaz:calls:<YYYY-MM-DD>:ip:<ip>` and `aiyaz:calls:<YYYY-MM-DD>:email:<email>`: INCR by the token function, 2-day expiry.
  - `aiyaz:spend:<YYYY-MM-DD>`: USD float. The token function reserves `1` per call (INCRBYFLOAT); the worker settles `actual - 1` at close. 2-day expiry. Days are UTC.
  - `aiyaz:call:<conversationId>`: the call log JSON, 30-day expiry.
- **Slug:** `/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/` (at most 40 characters, which also fits the site's `?ref=` tracking tag), made of a company key of up to 30 characters plus `-` plus 4 random characters.
- **Limits:** 10 minutes per call (`AIYAZ_MAX_SECONDS=600`, enforced by a worker timer even when nobody speaks); USD 1 per call (`AIYAZ_COST_CAP_USD=1`, equal to the site's per-call reservation); 3 calls a day per email and per IP; USD 5 a day across all calls (`AIYAZ_DAILY_CAP_USD=5` on the site).
- Transcripts are stored for 30 days (`AIYAZ_TRANSCRIPT_DAYS=30`) and never written to logs. Worker logs carry ids and numbers only.
- `reply()` runs exactly once per finished visitor turn; silence never causes a model call.
- Summary email goes through Resend to `AIYAZ_SUMMARY_TO`, from `AIYAZ_SUMMARY_FROM` (default `Aiyaz <aiyaz@getaiengineer.dev>`).
- Privacy note at the email step, verbatim: "We use your email to send you a summary of this call and to follow up. Calls are recorded as text to improve Aiyaz and deleted after 30 days."
- Microphone denied message, verbatim: "Aiyaz needs your microphone to talk. You can book a call or message us instead."
- Copy: plain English, no em-dashes, no hype words (seamless, unlock, elevate, revolutionise).
- Secrets only in environment variables. `.env` stays gitignored.
- Booking link `https://cal.com/getaiengineer/30min`; WhatsApp link exactly as in the site's hero (`https://wa.me/919150686857?text=...`).
- **Branch workflow:** executors commit only. Push, pull request, merge and live verification are Imran's calls; ask at each gate and wait for a yes.
- **Accounts Imran has not created yet:** LiveKit Cloud, Deepgram, ElevenLabs and/or Cartesia, Resend, Fly.io. Upstash must be connected to the getaiengineer Vercel project. Tasks 1 to 13 need none of them (Task 5 needs only the existing Anthropic key; Task 7's live write needs Upstash). Tasks 14 to 17 each start with a Stop step.

## Review Focus

1. **Country header missing, lowercase or malformed** (`""`, `ae`, `UAE`): the site and Aiyaz must fall back the same way, or a visitor sees one price and hears another. Pinned: Task 1 test "maps country codes the same way as the site", mirrored by Task 10 test "matches the aiyaz priceKey table".
2. **A brief fact that carries a money figure or has no source.** Real tracker facts include funding amounts. The fact must be dropped at load so the code-spoken opener never says a figure. Pinned: Task 6 test "drops facts with money amounts or no source".
3. **LiveKit asks for the same visitor turn twice** (interruption, resume, retry): `reply()` must still run once, and two overlapping turns must never run at the same time. Pinned: Task 8 test "answers the same turn id once, even when asked twice".
4. **Silent visitor:** no model call on empty speech, and the 10-minute cap must end the call even with zero turns, because `Conversation` only checks time inside `reply()`. Pinned: Task 8 tests "silence makes no model call" and "the call timer fires with no turns at all".
5. **Calls minted together near the USD 5 cap, or one person rotating emails or casing:** the reservation must refuse the overflow and refund it; `A@B.co ` and `a@b.co` must share one counter. Pinned: Task 11 tests "two calls at the cap edge: exactly one starts" and "email is normalised before counting".

## File map

**aiyaz (public)**
- Modify `src/config.ts`: `Currency`, `PriceKey`, price and pack maps, `priceKey`, `normCountry`, `forCountry`; call-log, voice and TTS settings.
- Modify `src/guards.ts`: `onlySprintPrice` checks the visitor's own currency and amount; reads "6 thousand dollars".
- Modify `src/prompt.ts`: `{{marketWhere}}`, Arabic rule only for AED.
- Create `prompts/system.v3.md`: market-neutral copy of v2, plus same-message and silence rules. v2 stays for history.
- Create `prompts/knowledge/general.v1.md`.
- Modify `src/conversation.ts`: defer notes-only tool results (one model call per spoken turn); public `end(reason)`.
- Create `src/kv.ts`: `KV`, `MemoryKV`, `UpstashKV`, `kvFromEnv`.
- Create `src/briefs.ts`: slug check, fact filter, `loadBrief` from Upstash.
- Create `src/calllog.ts`: summary lines, call log, store and settle, Resend email.
- Create `src/voice/meta.ts`: `AGENT_NAME`, `parseCallMeta`.
- Create `src/voice/turns.ts`: `TurnRunner`, `startCallTimer`.
- Create `src/voice/brain-llm.ts`: `BrainLLM`.
- Create `src/voice/agent.ts`: the worker.
- Create `scripts/brief-rows.ts`, `scripts/read-leads.py`, `scripts/push-briefs.ts`, `scripts/dev-token.ts`, `scripts/audition.ts`.
- Modify `evals/personas.ts`, `evals/simulate.ts`, `evals/scorers.ts`, `evals/aiyaz.eval.ts`.
- Create `Dockerfile`, `fly.toml`, `.dockerignore`. Modify `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`.
- Tests: `tests/country.test.ts`, `tests/guards.test.ts`, `tests/prompt.test.ts`, `tests/conversation.test.ts`, `tests/kv.test.ts`, `tests/briefs.test.ts`, `tests/brief-rows.test.ts`, `tests/turns.test.ts`, `tests/calllog.test.ts`, `tests/brain-llm.test.ts`.

**getaiengineer (private)**
- Create `price-core.js`; modify `price.js`.
- Create `lib/aiyaz-core.js`, `lib/upstash.js`, `api/aiyaz-token.js`.
- Create `call-core.js`, `call.js`, `vendor/livekit-client-2.22.3.esm.mjs`; modify `index.html`, `field.js`, `styles.css`.
- Modify `package.json`, `.gitignore`, `.vercelignore`.
- Tests: `tests/price.test.js`, `tests/aiyaz-token.test.js`, `tests/call-page.test.js`.

---

### Task 1: Country settings

**Files:**
- Modify: `src/config.ts`
- Test: `tests/country.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type Currency = "AED" | "USD"`; `type SprintPrice = { amount: number; currency: Currency }`; `type PriceKey = "AE" | "other" | "unknown"`.
  - `Settings` gains `prices: Record<PriceKey, SprintPrice>`, `packs: Record<PriceKey, string | null>`, `country: string | null`. `sprintPrice` and `knowledgePack` stay and hold the values for the current visitor (default: the unknown visitor, so AED and `uae.v1`).
  - `priceKey(country: string | null | undefined): PriceKey`
  - `normCountry(country: string | null | undefined): string | null`
  - `forCountry(settings: Settings, country: string | null | undefined): Settings`

- [ ] **Step 1: Write the failing test** `tests/country.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { forCountry, loadSettings, normCountry, priceKey } from "../src/config.js";

const base = loadSettings();

describe("country", () => {
  // The same table is tested on the site in tests/price.test.js. Change both or neither.
  it("maps country codes the same way as the site", () => {
    const table: [string | null, "AE" | "other" | "unknown"][] = [
      ["AE", "AE"],
      ["ae", "AE"],
      ["IN", "other"],
      ["US", "other"],
      ["GB", "other"],
      [" in ", "other"],
      ["", "unknown"],
      [null, "unknown"],
      ["UAE", "unknown"],
    ];
    for (const [country, key] of table) expect(priceKey(country), String(country)).toBe(key);
  });
  it("normalises country codes and drops anything that is not two letters", () => {
    expect(normCountry(" in ")).toBe("IN");
    expect(normCountry("UAE")).toBeNull();
    expect(normCountry(undefined)).toBeNull();
  });
  it("an India visitor gets USD 6,000 and the general pack", () => {
    const s = forCountry(base, "IN");
    expect(s.sprintPrice).toEqual({ amount: 6000, currency: "USD" });
    expect(s.knowledgePack).toBe("general.v1");
    expect(s.country).toBe("IN");
  });
  it("a UAE visitor and an unknown visitor get AED 25,000 and the UAE pack", () => {
    for (const c of ["AE", null]) {
      const s = forCountry(base, c);
      expect(s.sprintPrice).toEqual({ amount: 25000, currency: "AED" });
      expect(s.knowledgePack).toBe("uae.v1");
    }
  });
  it("defaults to the unknown visitor, so text chat and old evals keep AED", () => {
    expect(base.sprintPrice).toEqual({ amount: 25000, currency: "AED" });
    expect(base.knowledgePack).toBe("uae.v1");
    expect(base.country).toBeNull();
  });
  it("does not change the settings it was given", () => {
    forCountry(base, "IN");
    expect(base.sprintPrice.currency).toBe("AED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- country`
Expected: FAIL with `forCountry is not exported` (or `does not provide an export named 'forCountry'`).

- [ ] **Step 3: Implement** in `src/config.ts`

Replace the `SprintPrice` type line with:

```ts
export type Currency = "AED" | "USD";
export type SprintPrice = { amount: number; currency: Currency };
// Which price and pack a visitor gets. Must match priceFor() in the site's price-core.js.
export type PriceKey = "AE" | "other" | "unknown";
```

Add to the `Settings` type, after `knowledgePack: string | null;`:

```ts
  prices: Record<PriceKey, SprintPrice>;
  packs: Record<PriceKey, string | null>;
  // Two-letter country of the visitor, or null when unknown.
  country: string | null;
```

Add above `loadSettings`:

```ts
// Decided 2026-10-05: USD 6,000 for every known country outside the UAE; AED 25,000 in the
// UAE and when the country cannot be read (the UAE is the current test market).
const PRICES: Record<PriceKey, SprintPrice> = {
  AE: { amount: 25000, currency: "AED" },
  other: { amount: 6000, currency: "USD" },
  unknown: { amount: 25000, currency: "AED" },
};

// AIYAZ_KNOWLEDGE unset: pack by country. "none": no pack. Any other value: that pack for everyone.
function packsFromEnv(): Record<PriceKey, string | null> {
  const forced = process.env.AIYAZ_KNOWLEDGE;
  if (forced === "none") return { AE: null, other: null, unknown: null };
  if (forced) return { AE: forced, other: forced, unknown: forced };
  return { AE: "uae.v1", other: "general.v1", unknown: "uae.v1" };
}

export function normCountry(country: string | null | undefined): string | null {
  const c = (country ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export function priceKey(country: string | null | undefined): PriceKey {
  const c = normCountry(country);
  if (!c) return "unknown";
  return c === "AE" ? "AE" : "other";
}

// The settings for one visitor: their price and their market pack.
export function forCountry(settings: Settings, country: string | null | undefined): Settings {
  const key = priceKey(country);
  return {
    ...settings,
    country: normCountry(country),
    sprintPrice: settings.prices[key],
    knowledgePack: settings.packs[key],
  };
}
```

In `loadSettings()`, replace the `sprintPrice` and `knowledgePack` entries (and their comments) with:

```ts
    // The unknown visitor until forCountry() is applied.
    sprintPrice: PRICES.unknown,
    knowledgePack: packsFromEnv().unknown,
    prices: { ...PRICES },
    packs: packsFromEnv(),
    country: null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: all tests PASS (the existing prompt tests still see AED 25,000 and `uae.v1` by default); both exit codes `0`.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/country.test.ts
git commit -m "Country settings: price and market pack by visitor country (AE and unknown AED 25,000, others USD 6,000)"
```

---

### Task 2: Price guard per visitor price

**Files:**
- Modify: `src/guards.ts`
- Modify: `evals/scorers.ts:37-44` (type only; the scorer itself changes in Task 5)
- Test: `tests/guards.test.ts`

**Interfaces:**
- Consumes: `SprintPrice` from Task 1.
- Produces: `onlySprintPrice(text: string, price: SprintPrice): boolean` (was AED-only). `moneyAmounts(text)` also finds "6 thousand dollars".

- [ ] **Step 1: Write the failing tests.** Add to `tests/guards.test.ts`, after the `describe("only the sprint price")` block:

```ts
describe("only the sprint price, USD visitor", () => {
  const usd = { amount: 6000, currency: "USD" as const };
  it("accepts the ways USD 6,000 is written", () => {
    for (const t of [
      "It costs $6,000.",
      "USD 6,000 fixed",
      "US$6,000",
      "6,000 dollars",
      "6,000 US dollars",
      "6,000 USD",
      "6 thousand dollars",
      "no price here",
    ]) {
      expect(onlySprintPrice(t, usd), t).toBe(true);
    }
  });
  it("rejects other amounts, AED, suffixes and conversions", () => {
    for (const t of [
      "$3,000",
      "$6k",
      "USD 6,000.50",
      "AED 25,000",
      "6,000 AED",
      "$6,000, about AED 22,000",
      "six thousand dollars",
      "8 thousand dollars",
      "₹5,00,000",
      "€6,000",
    ]) {
      expect(onlySprintPrice(t, usd), t).toBe(false);
    }
  });
  it("an AED visitor still may not hear dollars, even the USD price", () => {
    const aed = { amount: 25000, currency: "AED" as const };
    expect(onlySprintPrice("$6,000", aed)).toBe(false);
    expect(onlySprintPrice("25 thousand dirhams", aed)).toBe(true);
    expect(onlySprintPrice("8 thousand dirhams", aed)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- guards`
Expected: FAIL. `"It costs $6,000."` returns `false` (the guard only knows AED), and `"8 thousand dirhams"` returns `true` (worded thousands after a digit are not parsed today).

- [ ] **Step 3: Implement** in `src/guards.ts`

Add at the top: `import type { Currency, SprintPrice } from "./config.js";`

Replace the `MONEY` constant with (the new first alternative reads "6 thousand dollars"):

```ts
const MONEY = new RegExp(
  [
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?thousand\s?(?:US\s?)?(?:dollars|dirhams?)\b)`,
    String.raw`(?:(?:\$|US\$|USD|AED|Dhs?\.?|EUR|GBP|INR|Rs\.?|€|£|₹)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|m|M)\b)?)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:k|K)?\s?(?:US\s?)?(?:dollars|usd|aed|euros|pounds|rupees|dirhams?)\b)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:(?:[أا]لف|آلاف)\s?)?(?:${AR_CURRENCY}))`,
    String.raw`(?:(?:${AR_CURRENCY})\s?\d[\d,]*(?:\.\d+)?)`,
  ].join("|"),
  "gi",
);
```

Replace the whole `onlySprintPrice` function with:

```ts
const CURRENCY_OF: [Currency, RegExp][] = [
  ["AED", /AED|Dhs?|dirham|درهم|دراهم/i],
  ["USD", /\$|USD|\bUS\b|dollars|دولار/i],
];
const OTHER_CURRENCY = /EUR|GBP|INR|Rs\.?|€|£|₹|euros|pounds|rupees|روبية|يورو|جنيه/i;

// True when every money amount in the text is the visitor's own sprint price, in its own currency.
export function onlySprintPrice(text: string, price: SprintPrice): boolean {
  if (WORDED_AMOUNT.test(text) && !/\d/.test(text.match(WORDED_AMOUNT)?.[0] ?? "")) {
    // "25 ألف درهم" and "6 thousand dollars" are parsed below; an amount spelled out in words fails.
    const before = text.slice(0, text.search(WORDED_AMOUNT));
    if (!/\d\s*$/.test(toLatinDigits(before))) return false;
  }
  return moneyAmounts(text).every((m) => {
    const currencies = CURRENCY_OF.filter(([, re]) => re.test(m)).map(([c]) => c);
    const hasSuffix = /\d\s?(?:k|K|m|M)\b/.test(m);
    let value = Number((m.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
    if (/thousand|[أا]لف|آلاف/i.test(m)) value *= 1000;
    return (
      currencies.length === 1 &&
      currencies[0] === price.currency &&
      !OTHER_CURRENCY.test(m) &&
      !hasSuffix &&
      value === price.amount
    );
  });
}
```

In `evals/scorers.ts` nothing changes yet: `settings.sprintPrice` is already a `SprintPrice`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: PASS, including every existing AED case in `describe("only the sprint price")`; exit codes `0`.

- [ ] **Step 5: Commit**

```bash
git add src/guards.ts tests/guards.test.ts
git commit -m "Price guard checks the visitor's own price: USD 6,000 forms accepted for USD visitors, worded thousands parsed"
```

---

### Task 3: Prompt v3 and the general pack

**Files:**
- Create: `prompts/system.v3.md`
- Create: `prompts/knowledge/general.v1.md`
- Modify: `src/prompt.ts`
- Modify: `src/config.ts` (default prompt version `v3`)
- Test: `tests/prompt.test.ts`

**Interfaces:**
- Consumes: `forCountry` (Task 1).
- Produces: prompt id `system/v3+<pack>@<sha8>`; placeholder `{{marketWhere}}`; `openingLine` unchanged for v3 (same opener as v2).

- [ ] **Step 1: Write the failing tests.** In `tests/prompt.test.ts`:

Change the import lines to:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forCountry, loadSettings } from "../src/config.js";
import { moneyAmounts } from "../src/guards.js";
import { buildSystemPrompt, formatPrice, openingLine } from "../src/prompt.js";
```

Delete the two tests "the pack contains no money amounts" and "the pack gives no language instruction, so it cannot override the Arabic switch", and add at the end of the file:

```ts
describe("market packs", () => {
  const dir = new URL("../prompts/knowledge/", import.meta.url);
  const packs = readdirSync(dir).filter((f) => f.endsWith(".md"));
  it("include the general pack", () => {
    expect(packs).toContain("general.v1.md");
  });
  for (const file of packs) {
    const text = readFileSync(new URL(file, dir), "utf8");
    it(`${file} contains no money amounts`, () => {
      expect(moneyAmounts(text)).toEqual([]);
    });
    it(`${file} gives no language instruction, so it cannot override the Arabic switch`, () => {
      expect(text).not.toMatch(/answer in|reply in/i);
    });
  }
  it("the general pack names no country or region", () => {
    const text = readFileSync(new URL("general.v1.md", dir), "utf8");
    expect(text).not.toMatch(/UAE|Dubai|Emirat|India|Gulf|Saudi|AED|USD/);
  });
});

describe("v3 prompt by country", () => {
  it("is the default version", () => {
    expect(base.promptVersion).toBe("v3");
  });
  it("an India visitor gets USD 6,000, the general pack and no UAE framing", () => {
    const p = buildSystemPrompt(forCountry(base, "IN"), null);
    expect(p.id).toMatch(/^system\/v3\+general\.v1@[0-9a-f]{8}$/);
    expect(p.text).toContain("fixed price USD 6,000");
    expect(p.text).toContain("General context");
    expect(p.text).not.toMatch(/AED|UAE|Dubai/);
  });
  it("a UAE visitor and an unknown visitor get AED 25,000 and the UAE pack", () => {
    for (const c of ["AE", null]) {
      const p = buildSystemPrompt(forCountry(base, c), null);
      expect(p.text).toContain("a company in the UAE");
      expect(p.text).toContain("UAE market context");
      expect(p.text).toContain("fixed price AED 25,000");
    }
  });
  it("leaves no unfilled placeholders for any country", () => {
    for (const c of ["IN", "AE", null]) {
      expect(buildSystemPrompt(forCountry(base, c), null).text).not.toMatch(/\{\{\w+\}\}/);
    }
  });
  it("asks for the spoken reply in the same message as record_notes", () => {
    expect(buildSystemPrompt(base, null).text).toContain("in the same message as the tool call");
  });
  it("wraps up after two silent turns", () => {
    expect(buildSystemPrompt(base, null).text).toContain('"(no answer)" twice in a row');
  });
  it("keeps English only for a USD visitor even with the Arabic switch on", () => {
    const p = buildSystemPrompt({ ...forCountry(base, "IN"), arabicEnabled: true }, null);
    expect(p.text).toContain("you can only continue in English for now");
    expect(p.text).not.toContain("Gulf (Khaleeji) Arabic");
  });
  it("opens like v2", () => {
    expect(openingLine(base, null)).toBe(
      "I'm Aiyaz, an AI agent from getaiengineer.dev. What is your company trying to do with AI?",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- prompt`
Expected: FAIL with `ENOENT ... general.v1.md` and `expected 'v2' to be 'v3'`.

- [ ] **Step 3: Create** `prompts/knowledge/general.v1.md`

```markdown
# General context

Use this to understand the caller's world and to ask better questions. None of it is a fact about the caller's company. If you connect something here to their company, say it is a guess or ask.

## Where AI initiatives usually stall

- No agreed first use case. Leadership wants AI somewhere, but nobody has picked one job for it to do, for one group of users.
- A pilot that works in a demo and fails on real data: unusual documents, messy records, questions nobody tried.
- No shared idea of a good answer. Without examples of right and wrong answers taken from real data, nobody can tell whether a change made things better or worse.
- Data access. The data the feature needs sits in another system, with another team, or behind a security review.
- Nobody owns it. The people who could build it are busy with the core product.
- No tests after launch. A model or prompt change quietly breaks answers that used to be right.
- Slow answers. A feature that takes too long to respond gets ignored, even when its answers are right.

## Questions that usually help

- What would a user do differently if the feature worked?
- What does a wrong answer cost the user, or the company?
- Who has to say yes before it goes live?
- What data would it need, and who controls that data?
- How would they know, a month after launch, that it still works?
```

- [ ] **Step 4: Create** `prompts/system.v3.md` (v2 with the market made a placeholder, the heading made neutral, and two new rules)

```markdown
You are {{agentName}}, an AI agent from getaiengineer.dev. You are talking with a founder, CEO or technical lead of a company{{marketWhere}} about their AI initiative. You have already introduced yourself; do not introduce yourself again.

## Your job

Understand their AI initiative well enough to say what is likely in the way and whether a two-week sprint would help. Work through these, one question at a time, in whatever order the conversation allows:

1. What they want AI to do, and for whom.
2. How far along it is: an idea, a pilot, or live with users.
3. Who sponsors it on their side.
4. What is in the way: no clear first use case, wrong answers, slow responses, data access, nobody to build it.
5. When they want it working.

If something is already live, also ask what goes wrong for users and what they have tried.

Aim for about five questions in total. Ask one question per message. Keep each message to two or three short sentences, because this conversation is spoken aloud.

Open warmly and respectfully. Do not push or hurry them.

## Notes

Call `record_notes` whenever you learn something that fits a field. When the prospect confirms or corrects a fact from the brief, call `record_notes` with `confirm_facts` or `reject_facts`, using the fact text exactly as it appears in the brief.

When you call `record_notes`, put your full spoken reply, including your next question, in the same message as the tool call.

## Facts about their company

{{briefSection}}

Never state a fact about their company as true unless they told you or confirmed it in this conversation. Ask instead: "I read that you launched X. Is that right?" When you suggest what might be in the way, say clearly that it is a guess, for example "My guess is..." or "One possibility is...".

## Their market

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
- Everything you write is spoken to the caller. Never write stage directions, notes to yourself or anything in brackets such as "(waiting for their answer)".
{{languageRule}}

## Ending

When you have enough to describe their initiative, or they want to stop, give a short spoken summary: what you understood, your guesses about what is in the way (labelled as guesses), and what the sprint would tackle first. Then call `end_conversation`.

If the caller's message is "(no answer)" twice in a row, say you will stop here and that they can book a call or message the team on WhatsApp, then call `end_conversation`.
```

- [ ] **Step 5: Implement** in `src/prompt.ts`

Add after the `GULF_ARABIC` constant:

```ts
// How the prompt places the caller. A pack with no entry gets no place name.
const MARKET_WHERE: Record<string, string> = { "uae.v1": " in the UAE" };
```

In `buildSystemPrompt`, replace the last two `.replaceAll` lines of the `text` chain with:

```ts
    .replaceAll("{{knowledgeSection}}", pack)
    .replaceAll("{{marketWhere}}", settings.knowledgePack ? (MARKET_WHERE[settings.knowledgePack] ?? "") : "")
    // The Gulf Arabic rule quotes the AED price, so it only applies to AED visitors.
    .replaceAll(
      "{{languageRule}}",
      settings.arabicEnabled && settings.sprintPrice.currency === "AED" ? GULF_ARABIC : ENGLISH_ONLY,
    );
```

In `src/config.ts`, change the default prompt version:

```ts
    promptVersion: env("AIYAZ_PROMPT_VERSION", "v3"),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: PASS. The existing `describe("v2 prompt")` tests still pass because they set `promptVersion: "v2"` explicitly and v2 has no `{{marketWhere}}`. Exit codes `0`.

- [ ] **Step 7: Commit**

```bash
git add prompts/system.v3.md prompts/knowledge/general.v1.md src/prompt.ts src/config.ts tests/prompt.test.ts
git commit -m "Prompt v3: market from the visitor's pack, general pack, reply with record_notes, wrap up after silence"
```

---

### Task 4: One model call per spoken turn (ported from `voice-company-page`)

Measured on 2026-09-30: median 2.1 s per model call, and a turn that records notes makes two calls. For voice, a response that already speaks a question and only calls `record_notes` returns at once; its tool results go to the model with the next visitor turn.

**Files:**
- Modify: `src/conversation.ts`
- Test: `tests/conversation.test.ts`

**Interfaces:**
- Consumes: v3's same-message rule (Task 3).
- Produces: unchanged public API of `Conversation`.

- [ ] **Step 1: Write the failing tests.** Add inside `describe("a turn")` in `tests/conversation.test.ts` (keep the existing "records notes through the tool and returns the spoken text" test: its "Got it." has no question, so it still makes two calls):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- conversation`
Expected: FAIL. The first new test throws "FakeLLM ran out of scripted responses" (two requests made).

- [ ] **Step 3: Implement** in `src/conversation.ts`

Add a field next to `private prospectTurns = 0;`:

```ts
  // Tool results from a turn that was spoken without a second model call.
  private pendingResults: Anthropic.ToolResultBlockParam[] = [];
```

Replace `this.messages.push({ role: "user", content: text });` in `reply()` with:

```ts
    // Tool results deferred from the previous turn must lead the next user message.
    this.messages.push(
      this.pendingResults.length
        ? { role: "user", content: [...this.pendingResults, { type: "text", text }] }
        : { role: "user", content: text },
    );
    this.pendingResults = [];
```

Insert directly before `// All results go back in a single user message.`:

```ts
      // Voice latency: when this response already asks the next question and only saved
      // notes, speak now and send the tool results with the next user message.
      // A bare "Got it." would leave the visitor in silence, so it still gets a second call.
      const saidThisRound = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .join(" ");
      if (saidThisRound.includes("?") && toolUses.every((t) => t.name === "record_notes")) {
        this.pendingResults = results;
        break;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: PASS; "sends every tool result back in one user message" still passes (no text in that round). Exit codes `0`.

- [ ] **Step 5: Commit**

```bash
git add src/conversation.ts tests/conversation.test.ts
git commit -m "One model call per spoken turn: defer notes-only tool results when the reply already asks a question"
```

---

### Task 5: Evals per visitor country

**Files:**
- Modify: `evals/personas.ts`, `evals/simulate.ts`, `evals/scorers.ts`, `evals/aiyaz.eval.ts`

**Interfaces:**
- Consumes: `forCountry` (Task 1), `onlySprintPrice(text, price)` (Task 2), `formatPrice` (`src/prompt.ts`).
- Produces: `Persona` gains `country?: string; mustQuotePrice?: boolean; silent?: boolean`. `RunResult` gains `price: SprintPrice`. Scorers `quotesVisitorPrice`, `endsOnSilence`.

- [ ] **Step 1: Persona fields and new personas.** In `evals/personas.ts`, extend the type:

```ts
export type Persona = {
  id: string;
  play: string;
  brief?: Brief;
  briefIsWrong?: boolean;
  // Two-letter visitor country. Unset means unknown, which gets AED and the UAE pack.
  country?: string;
  // The persona asks the price, so Aiyaz must state the visitor's own price.
  mustQuotePrice?: boolean;
  // The visitor says nothing at all; the simulator is not called.
  silent?: boolean;
};
```

Add `country: "AE",` to the `asks-in-dollars` persona (it is Dubai-based and must keep AED). Append to `PERSONAS`:

```ts
  {
    id: "india-saas-cto",
    country: "IN",
    mustQuotePrice: true,
    play:
      "You are the CTO of a SaaS company in Bengaluru selling HR software. You want an AI assistant that answers employees' policy questions; it is at pilot stage and sometimes invents policies. Early on, ask how much the sprint costs. Answer in English, briefly.",
  },
  {
    id: "acme-lead",
    country: "AE",
    brief: {
      company: "Acme",
      facts: [
        { text: "launched an AI assistant that answers customer questions on WhatsApp", source: "https://acme.example/news" },
        { text: "are piloting AI to read supplier invoices", source: "https://acme.example/blog" },
      ],
    },
    play:
      "You are the COO of Acme, a retailer in Dubai. Both things the agent read about you are true: the WhatsApp assistant is live and sometimes gives wrong delivery dates, and the invoice pilot has stalled because nobody owns it. Answer in English, politely.",
  },
  {
    id: "silent-visitor",
    silent: true,
    play: "You say nothing.",
  },
```

- [ ] **Step 2: Simulator.** Replace `evals/simulate.ts` with:

```ts
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
```

- [ ] **Step 3: Scorers.** In `evals/scorers.ts`, add `import { formatPrice } from "../src/prompt.js";` and replace `onlySprintPriceScorer` with:

```ts
export const onlySprintPriceScorer = createScorer<Persona, RunResult>({
  name: "only_sprint_price",
  description:
    "The only money amount Aiyaz says is the visitor's own price: AED 25,000 in the UAE or when unknown, USD 6,000 elsewhere.",
  scorer: ({ output }) => {
    const bad = aiyazTurns(output).find((t) => !onlySprintPrice(t, output.price));
    return pass(!bad, bad ? `amounts: ${moneyAmounts(bad).join(", ")} (allowed ${formatPrice(output.price)})` : "clean");
  },
});

export const quotesVisitorPrice = createScorer<Persona, RunResult>({
  name: "quotes_visitor_price",
  description: "When the visitor asks the price, Aiyaz states their own price.",
  scorer: ({ input, output }) => {
    if (!input.mustQuotePrice) return pass(true, "price not asked");
    const hit = aiyazTurns(output).find((t) => moneyAmounts(t).length > 0 && onlySprintPrice(t, output.price));
    return pass(Boolean(hit), hit ? "quoted" : `never quoted ${formatPrice(output.price)}`);
  },
});

export const endsOnSilence = createScorer<Persona, RunResult>({
  name: "ends_on_silence",
  description: "A visitor who says nothing gets a polite wrap-up, not an endless string of questions.",
  scorer: ({ input, output }) => {
    if (!input.silent) return pass(true, "not silent");
    return pass(output.endReason === "agent_ended", `ended: ${output.endReason}`);
  },
});
```

- [ ] **Step 4: Register.** In `evals/aiyaz.eval.ts`, add `endsOnSilence` and `quotesVisitorPrice` to the import from `./scorers.js` and to `scorers: [...]`, and add a column after "Persona":

```ts
    { label: "Country", value: input.country ?? "unknown" },
```

- [ ] **Step 5: Typecheck and unit tests**

Run: `pnpm typecheck; echo $?` then `pnpm test; echo $?`
Expected: both `0`.

- [ ] **Step 6: Run the evals** (needs only the existing `ANTHROPIC_API_KEY` in `.env`)

Run: `rm -f eval-traces.jsonl; pnpm evals`
Expected: 15 personas, every scorer passes on every persona, including `india-saas-cto` (quotes USD 6,000, never AED), `asks-in-dollars` (keeps AED 25,000), `acme-lead` (no unconfirmed fact) and `silent-visitor` (`agent_ended`). If a scorer fails, read the transcript column and fix the prompt or code before going on; do not loosen a scorer.

- [ ] **Step 7: Measure calls and latency** (feeds the spike's latency gate)

```bash
python3 -c "import json,statistics as s;r=[json.loads(l) for l in open('eval-traces.jsonl') if l.strip()];c=[x['latencyMs'] for x in r if x.get('role')=='conversation' and not x.get('error')];print('median ms',s.median(c),'calls',len(c))"
```
Expected: prints a median and a call count. Put both numbers in the commit message.

- [ ] **Step 8: Commit**

```bash
git add evals/personas.ts evals/simulate.ts evals/scorers.ts evals/aiyaz.eval.ts
git commit -m "Evals per visitor country: India visitor must hear USD 6,000, Acme lead call, silent visitor (median <n> ms, <n> calls)"
```

---

### Task 6: Upstash store, private brief loading, call metadata

**Files:**
- Create: `src/kv.ts`, `src/briefs.ts`, `src/voice/meta.ts`
- Modify: `.gitignore`, `.env.example`
- Test: `tests/kv.test.ts`, `tests/briefs.test.ts`

**Interfaces:**
- Consumes: `moneyAmounts` (`src/guards.ts`), `normCountry` (Task 1), `Brief`, `BriefFact` (`src/notes.ts`).
- Produces:
  - `interface KV { get(key: string): Promise<string | null>; set(key: string, value: string, exSeconds?: number): Promise<void>; incrByFloat(key: string, by: number, exSeconds?: number): Promise<number> }`
  - `class MemoryKV implements KV` (with public `data: Map<string, string>` and `ttl: Map<string, number>`), `class UpstashKV implements KV` (constructor `(url: string, token: string, fetchFn?: typeof fetch)`), `kvFromEnv(env?: NodeJS.ProcessEnv): KV | null`
  - `BRIEF_KEY(slug: string): string`, `isValidSlug(slug: string): boolean`, `usableFact(f: unknown): f is BriefFact`, `toBrief(v: unknown): Brief | null`, `loadBrief(kv: KV | null, slug: string | null): Promise<Brief | null>`
  - `AGENT_NAME = "aiyaz"`, `type CallMeta = { country: string | null; slug: string | null; email: string | null }`, `parseCallMeta(raw: string | null | undefined): CallMeta`

- [ ] **Step 1: Write the failing tests**

`tests/kv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryKV, UpstashKV, kvFromEnv } from "../src/kv.js";

describe("MemoryKV", () => {
  it("gets, sets with expiry and adds floats", async () => {
    const kv = new MemoryKV();
    await kv.set("a", "1", 60);
    expect(await kv.get("a")).toBe("1");
    expect(kv.ttl.get("a")).toBe(60);
    expect(await kv.incrByFloat("s", 0.25)).toBeCloseTo(0.25);
    expect(await kv.incrByFloat("s", -1)).toBeCloseTo(-0.75);
    expect(await kv.get("missing")).toBeNull();
  });
});

describe("UpstashKV", () => {
  it("sends commands to the REST pipeline with the bearer token", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify([{ result: "1.5" }, { result: 1 }]));
    }) as unknown as typeof fetch;
    const kv = new UpstashKV("https://kv.example", "tok", fake);
    expect(await kv.incrByFloat("aiyaz:spend:2026-10-05", 0.5, 172800)).toBe(1.5);
    expect(sent[0]!.url).toBe("https://kv.example/pipeline");
    expect((sent[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual([
      ["INCRBYFLOAT", "aiyaz:spend:2026-10-05", "0.5"],
      ["EXPIRE", "aiyaz:spend:2026-10-05", "172800"],
    ]);
  });
  it("throws on an error so callers can fall back", async () => {
    const fake = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(new UpstashKV("https://kv.example", "tok", fake).get("x")).rejects.toThrow(/Upstash 500/);
  });
  it("is null when the env has no Upstash settings", () => {
    expect(kvFromEnv({})).toBeNull();
    expect(kvFromEnv({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" })).toBeInstanceOf(UpstashKV);
  });
});
```

`tests/briefs.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRIEF_KEY, isValidSlug, loadBrief } from "../src/briefs.js";
import { MemoryKV, type KV } from "../src/kv.js";
import { parseCallMeta } from "../src/voice/meta.js";

const fact = { text: "launched an AI assistant that answers customer questions", source: "https://acme.example/news" };
const store = async (value: unknown, slug = "acme-7k2q") => {
  const kv = new MemoryKV();
  await kv.set(BRIEF_KEY(slug), typeof value === "string" ? value : JSON.stringify(value));
  return kv;
};

describe("briefs", () => {
  it("loads a stored brief by slug", async () => {
    const brief = await loadBrief(await store({ company: "Acme", facts: [fact] }), "acme-7k2q");
    expect(brief).toEqual({ company: "Acme", facts: [fact] });
  });
  it("runs as a homepage call for a missing, unknown or malformed slug, or no store", async () => {
    const kv = await store({ company: "Acme", facts: [fact] });
    expect(await loadBrief(kv, null)).toBeNull();
    expect(await loadBrief(kv, "nope-1234")).toBeNull();
    expect(await loadBrief(null, "acme-7k2q")).toBeNull();
    for (const bad of ["../etc", "a/b", "", "A B", "x".repeat(41), "-acme"]) expect(isValidSlug(bad), bad).toBe(false);
    expect(isValidSlug("acme-7k2q")).toBe(true);
  });
  it("drops facts with money amounts or no source", async () => {
    const brief = await loadBrief(
      await store({
        company: "Acme",
        facts: [
          { text: "raised USD 12M in a Series A", source: "https://acme.example/press" },
          { text: "closed a 40 million dollar round", source: "https://acme.example/press" },
          { text: "hired a data team", source: "" },
          fact,
        ],
      }),
      "acme-7k2q",
    );
    expect(brief?.facts).toEqual([fact]);
  });
  it("is null when no usable fact is left, so the call runs as a homepage call", async () => {
    expect(await loadBrief(await store({ company: "Acme", facts: [{ text: "raised $5M", source: "s" }] }), "acme-7k2q")).toBeNull();
  });
  it("keeps at most 8 facts of at most 300 characters", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `runs pilot number ${i}`, source: "s" }));
    const brief = await loadBrief(
      await store({ company: "Acme", facts: [{ text: "x".repeat(301), source: "s" }, ...many] }),
      "acme-7k2q",
    );
    expect(brief?.facts).toHaveLength(8);
    expect(brief?.facts[0]!.text).toBe("runs pilot number 0");
  });
  it("never crashes a call on bad data or a store error", async () => {
    expect(await loadBrief(await store("{not json"), "acme-7k2q")).toBeNull();
    expect(await loadBrief(await store({ facts: [fact] }), "acme-7k2q")).toBeNull();
    expect(await loadBrief(await store({ company: "x".repeat(81), facts: [fact] }), "acme-7k2q")).toBeNull();
    const broken: KV = {
      get: async () => {
        throw new Error("down");
      },
      set: async () => {},
      incrByFloat: async () => 0,
    };
    expect(await loadBrief(broken, "acme-7k2q")).toBeNull();
  });
  it("never reads files: briefs come only from the store", () => {
    const source = readFileSync(new URL("../src/briefs.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:fs|readFile|AIYAZ_BRIEFS/);
  });
});

describe("call metadata", () => {
  it("reads country, slug and email from the token metadata", () => {
    expect(parseCallMeta('{"country":"in","slug":"acme-7k2q","email":" A@B.co "}')).toEqual({
      country: "IN",
      slug: "acme-7k2q",
      email: "a@b.co",
    });
  });
  it("treats anything missing or malformed as unknown", () => {
    const none = { country: null, slug: null, email: null };
    for (const raw of [undefined, null, "", "not json", "[]", "null"]) expect(parseCallMeta(raw), String(raw)).toEqual(none);
    expect(parseCallMeta('{"country":"UAE","slug":"../x","email":"nope"}')).toEqual(none);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- kv briefs`
Expected: FAIL with `Cannot find module '../src/kv.js'` and `'../src/briefs.js'`.

- [ ] **Step 3: Implement** `src/kv.ts`

```ts
// The small key-value store shared with the site (Upstash Redis over REST).
// The worker reads briefs and writes call logs and spend; tests use MemoryKV.

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exSeconds?: number): Promise<void>;
  incrByFloat(key: string, by: number, exSeconds?: number): Promise<number>;
}

export class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  readonly ttl = new Map<string, number>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string, exSeconds?: number): Promise<void> {
    this.data.set(key, value);
    if (exSeconds) this.ttl.set(key, exSeconds);
  }
  async incrByFloat(key: string, by: number, exSeconds?: number): Promise<number> {
    const next = Number(this.data.get(key) ?? 0) + by;
    this.data.set(key, String(next));
    if (exSeconds) this.ttl.set(key, exSeconds);
    return next;
  }
}

export class UpstashKV implements KV {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async pipeline(commands: string[][]): Promise<unknown[]> {
    const res = await this.fetchFn(`${this.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const failed = out.find((r) => r.error);
    if (failed) throw new Error(`Upstash: ${failed.error}`);
    return out.map((r) => r.result);
  }

  async get(key: string): Promise<string | null> {
    const [value] = await this.pipeline([["GET", key]]);
    return typeof value === "string" ? value : null;
  }

  async set(key: string, value: string, exSeconds?: number): Promise<void> {
    await this.pipeline([exSeconds ? ["SET", key, value, "EX", String(exSeconds)] : ["SET", key, value]]);
  }

  async incrByFloat(key: string, by: number, exSeconds?: number): Promise<number> {
    const commands = [["INCRBYFLOAT", key, String(by)]];
    if (exSeconds) commands.push(["EXPIRE", key, String(exSeconds)]);
    const [value] = await this.pipeline(commands);
    return Number(value);
  }
}

// Same variable names Vercel sets when Upstash is connected to the site project.
export function kvFromEnv(env: NodeJS.ProcessEnv = process.env): KV | null {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  return url && token ? new UpstashKV(url, token) : null;
}
```

- [ ] **Step 4: Implement** `src/briefs.ts`

```ts
// Lead briefs are private client material. They live only in the site's Upstash store
// under aiyaz:brief:<slug>, written by `pnpm briefs` from the private lead tracker.
// Nothing here reads files. A bad or missing brief makes the call a homepage call.
import { moneyAmounts } from "./guards.js";
import type { KV } from "./kv.js";
import type { Brief, BriefFact } from "./notes.js";

export const BRIEF_KEY = (slug: string) => `aiyaz:brief:${slug}`;

// At most 40 characters: it also travels as the site's ?ref= tracking tag.
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const isValidSlug = (slug: string) => SLUG.test(slug);

const MAX_FACTS = 8;
const MAX_FACT_CHARS = 300;
const MAX_COMPANY_CHARS = 80;
const WORDED_BIG_NUMBER = /\d[\d.,]*\s?(?:million|billion|bn)\b/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// A fact needs a source, and must carry no money figure: the opener is spoken by code,
// so a funding amount in the first fact would be said word for word.
export function usableFact(f: unknown): f is BriefFact {
  if (!isObj(f) || typeof f.text !== "string" || typeof f.source !== "string") return false;
  const text = f.text.trim();
  if (!text || !f.source.trim() || text.length > MAX_FACT_CHARS) return false;
  return moneyAmounts(text).length === 0 && !WORDED_BIG_NUMBER.test(text);
}

export function toBrief(v: unknown): Brief | null {
  if (!isObj(v) || typeof v.company !== "string" || !Array.isArray(v.facts)) return null;
  const company = v.company.trim();
  if (!company || company.length > MAX_COMPANY_CHARS) return null;
  const facts = v.facts
    .filter(usableFact)
    .map((f) => ({ text: f.text.trim(), source: f.source.trim() }))
    .slice(0, MAX_FACTS);
  return facts.length ? { company, facts } : null;
}

export async function loadBrief(kv: KV | null, slug: string | null): Promise<Brief | null> {
  if (!kv || !slug || !isValidSlug(slug)) return null;
  let raw: string | null;
  try {
    raw = await kv.get(BRIEF_KEY(slug));
  } catch (err) {
    console.warn(`[briefs] store unavailable, running as a homepage call: ${String(err)}`);
    return null;
  }
  if (!raw) return null;
  try {
    return toBrief(JSON.parse(raw));
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement** `src/voice/meta.ts`

```ts
// The token function on the site puts { country, slug?, email? } in the dispatch metadata.
// Everything is checked again here: the worker trusts nothing it did not parse.
import { isValidSlug } from "../briefs.js";
import { normCountry } from "../config.js";

export const AGENT_NAME = "aiyaz";

export type CallMeta = { country: string | null; slug: string | null; email: string | null };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function parseCallMeta(raw: string | null | undefined): CallMeta {
  let v: unknown;
  try {
    v = JSON.parse(raw || "{}");
  } catch {
    v = {};
  }
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const email = str(o.email).trim().toLowerCase();
  const slug = str(o.slug);
  return {
    country: normCountry(str(o.country)),
    slug: isValidSlug(slug) ? slug : null,
    email: EMAIL.test(email) ? email : null,
  };
}
```

- [ ] **Step 6: Ignore local brief files and document the env vars.** Append to `.gitignore`:

```
briefs/
*.briefs.json
auditions/
```

Append to `.env.example`:

```
# Upstash, copied from the getaiengineer Vercel project (Storage tab). Needed for lead calls,
# call logs and the daily spend total.
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: PASS; exit codes `0`.

- [ ] **Step 8: Commit**

```bash
git add src/kv.ts src/briefs.ts src/voice/meta.ts tests/kv.test.ts tests/briefs.test.ts .gitignore .env.example
git commit -m "Private lead briefs from Upstash: slug check, facts without source or with money dropped; call metadata parsing"
```

---

### Task 7: Brief push script (tracker to Upstash)

**Files:**
- Create: `scripts/brief-rows.ts`, `scripts/read-leads.py`, `scripts/push-briefs.ts`
- Modify: `package.json` (script `briefs`), `tsconfig.json` (include `scripts`)
- Test: `tests/brief-rows.test.ts`

**Interfaces:**
- Consumes: `BRIEF_KEY`, `toBrief`, `usableFact` (Task 6), `KV`, `MemoryKV`, `kvFromEnv` (Task 6).
- Produces: `type LeadRow = { company: string; facts: string }`; `type PlannedBrief = { company: string; slug: string; isNew: boolean; brief: Brief | null; dropped: string[] }`; `parseFactsCell(cell: string): { facts: BriefFact[]; dropped: string[] }`; `companyKey(company: string): string`; `newSlug(company: string, rand?: (n: number) => Uint8Array): string`; `SLUG_FOR_KEY(key: string): string`; `planBriefs(rows: LeadRow[], kv: KV, rand?: (n: number) => Uint8Array): Promise<PlannedBrief[]>`; `writeBriefs(planned: PlannedBrief[], kv: KV): Promise<number>`; `ACME_TEST: { slug: string; brief: Brief }` (slug `"acme-test"`). CLI `pnpm briefs [--write] [--only <company>] [--acme-test]`.

- [ ] **Step 1: Write the failing test** `tests/brief-rows.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BRIEF_KEY, isValidSlug } from "../src/briefs.js";
import { MemoryKV } from "../src/kv.js";
import { ACME_TEST, SLUG_FOR_KEY, companyKey, newSlug, parseFactsCell, planBriefs, writeBriefs } from "../scripts/brief-rows.js";

const zeros = (n: number) => new Uint8Array(n);
const cell =
  "launched an AI assistant that answers customer questions (acme.example/news); " +
  "are piloting AI to read supplier invoices (acme.example/blog; acme.example/careers); " +
  "raised USD 12M in a Series A (acme.example/press); " +
  "runs a loyalty app";

describe("brief rows", () => {
  it("splits the tracker cell into facts with sources, ignoring semicolons inside brackets", () => {
    const { facts, dropped } = parseFactsCell(cell);
    expect(facts).toEqual([
      { text: "launched an AI assistant that answers customer questions", source: "acme.example/news" },
      { text: "are piloting AI to read supplier invoices", source: "acme.example/blog; acme.example/careers" },
    ]);
    expect(dropped).toEqual(["raised USD 12M in a Series A (acme.example/press)", "runs a loyalty app"]);
  });
  it("makes short, valid, unguessable slugs", () => {
    expect(companyKey("Acme Trading L.L.C.")).toBe("acme-trading-l-l-c");
    expect(companyKey("A".repeat(60)).length).toBeLessThanOrEqual(30);
    expect(newSlug("Acme", zeros)).toBe("acme-aaaa");
    expect(isValidSlug(newSlug("Acme Trading L.L.C. and Sons International Holdings"))).toBe(true);
  });
  it("reuses a company's existing slug so links stay stable", async () => {
    const kv = new MemoryKV();
    await kv.set(SLUG_FOR_KEY("acme"), "acme-7k2q");
    const [p] = await planBriefs([{ company: "Acme", facts: cell }], kv, zeros);
    expect(p!.slug).toBe("acme-7k2q");
    expect(p!.isNew).toBe(false);
  });
  it("writes the brief and the slug, and skips companies with no usable fact", async () => {
    const kv = new MemoryKV();
    const plan = await planBriefs(
      [
        { company: "Acme", facts: cell },
        { company: "Empty Co", facts: "raised $5M (x.example)" },
      ],
      kv,
      zeros,
    );
    expect(await writeBriefs(plan, kv)).toBe(1);
    expect(await kv.get(SLUG_FOR_KEY("acme"))).toBe("acme-aaaa");
    expect(JSON.parse((await kv.get(BRIEF_KEY("acme-aaaa")))!).facts).toHaveLength(2);
    expect(await kv.get(SLUG_FOR_KEY("empty-co"))).toBeNull();
  });
  it("has a made-up Acme brief for tests and the spike", () => {
    expect(ACME_TEST.slug).toBe("acme-test");
    expect(ACME_TEST.brief.company).toBe("Acme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- brief-rows`
Expected: FAIL with `Cannot find module '../scripts/brief-rows.js'`.

- [ ] **Step 3: Implement** `scripts/brief-rows.ts`

```ts
// Turns the lead tracker's "Aiyaz brief facts" cells into briefs for Upstash.
// The tracker and its contents are private and never enter this repo; only this parsing code does.
import { randomBytes } from "node:crypto";
import { BRIEF_KEY, toBrief, usableFact } from "../src/briefs.js";
import type { KV } from "../src/kv.js";
import type { Brief, BriefFact } from "../src/notes.js";

export type LeadRow = { company: string; facts: string };
export type PlannedBrief = { company: string; slug: string; isNew: boolean; brief: Brief | null; dropped: string[] };

export const SLUG_FOR_KEY = (key: string) => `aiyaz:slug-for:${key}`;

// "launched X (acme.example/news); runs Y (acme.example)" gives two facts.
// A semicolon inside brackets does not split; a part without a bracketed source is dropped.
export function parseFactsCell(cell: string): { facts: BriefFact[]; dropped: string[] } {
  const facts: BriefFact[] = [];
  const dropped: string[] = [];
  for (const raw of cell.split(/;\s*(?![^()]*\))/)) {
    const part = raw.trim().replace(/\.$/, "");
    if (!part) continue;
    const m = part.match(/^(.*\S)\s*\(([^()]+)\)$/);
    const fact = m ? { text: m[1]!.trim(), source: m[2]!.trim() } : null;
    if (fact && usableFact(fact)) facts.push(fact);
    else dropped.push(part);
  }
  return { facts, dropped };
}

export function companyKey(company: string): string {
  const key = company
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return key || "company";
}

// No 0/o or 1/l, so a slug read aloud or retyped survives.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newSlug(company: string, rand: (n: number) => Uint8Array = randomBytes): string {
  const suffix = [...rand(4)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${companyKey(company)}-${suffix}`;
}

export async function planBriefs(
  rows: LeadRow[],
  kv: KV,
  rand?: (n: number) => Uint8Array,
): Promise<PlannedBrief[]> {
  const out: PlannedBrief[] = [];
  for (const row of rows) {
    const { facts, dropped } = parseFactsCell(row.facts);
    const existing = await kv.get(SLUG_FOR_KEY(companyKey(row.company)));
    out.push({
      company: row.company,
      slug: existing ?? newSlug(row.company, rand),
      isNew: !existing,
      brief: toBrief({ company: row.company, facts }),
      dropped,
    });
  }
  return out;
}

export async function writeBriefs(planned: PlannedBrief[], kv: KV): Promise<number> {
  let written = 0;
  for (const p of planned) {
    if (!p.brief) continue;
    await kv.set(SLUG_FOR_KEY(companyKey(p.company)), p.slug);
    await kv.set(BRIEF_KEY(p.slug), JSON.stringify(p.brief));
    written++;
  }
  return written;
}

// Made up, for the spike and preview checks. Never a real company.
export const ACME_TEST: { slug: string; brief: Brief } = {
  slug: "acme-test",
  brief: {
    company: "Acme",
    facts: [
      { text: "launched an AI assistant that answers customer questions on WhatsApp", source: "https://acme.example/news" },
      { text: "are piloting AI to read supplier invoices", source: "https://acme.example/blog" },
    ],
  },
};
```

- [ ] **Step 4: Implement** `scripts/read-leads.py`

```python
# Reads the private lead tracker and prints [{"company": ..., "facts": ...}] as JSON.
# Read-only: scheduled jobs write the tracker, so this never writes back to it.
import json
import sys

import openpyxl

FACTS = "Aiyaz brief facts (each with source)"

wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb["Leads"]
rows = ws.iter_rows(values_only=True)
header = None
for row in rows:
    if row and "Company" in row and FACTS in row:
        header = list(row)
        break
if header is None:
    sys.exit(f"no header row with 'Company' and {FACTS!r}")
ci, fi = header.index("Company"), header.index(FACTS)
out = []
for row in rows:
    company, facts = row[ci], row[fi]
    if company and facts:
        out.append({"company": str(company).strip(), "facts": str(facts)})
print(json.dumps(out))
```

- [ ] **Step 5: Implement** `scripts/push-briefs.ts`

```ts
// Pushes private lead briefs from the tracker to Upstash. Dry run unless --write.
//   AIYAZ_LEADS_FILE=/path/outside/this/repo/tracker.xlsx pnpm briefs              prints the plan
//   AIYAZ_LEADS_FILE=... pnpm briefs --only "<company>" --write                    stores one brief
//   pnpm briefs --acme-test --write                                               stores the made-up Acme brief
import { spawnSync } from "node:child_process";
import { BRIEF_KEY } from "../src/briefs.js";
import { MemoryKV, kvFromEnv } from "../src/kv.js";
import { ACME_TEST, planBriefs, writeBriefs, type LeadRow } from "./brief-rows.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const kv = kvFromEnv();
if (write && !kv) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN (from the getaiengineer Vercel project) in .env first.");
  process.exit(2);
}

if (args.includes("--acme-test")) {
  if (write) await kv!.set(BRIEF_KEY(ACME_TEST.slug), JSON.stringify(ACME_TEST.brief));
  console.log(`${write ? "wrote" : "would write"} ${BRIEF_KEY(ACME_TEST.slug)}: https://getaiengineer.dev/?ref=${ACME_TEST.slug}`);
  process.exit(0);
}

const file = process.env.AIYAZ_LEADS_FILE;
if (!file) {
  console.error("Set AIYAZ_LEADS_FILE to the lead tracker .xlsx (kept outside this repo).");
  process.exit(2);
}
const read = spawnSync("python3", ["scripts/read-leads.py", file], { encoding: "utf8" });
if (read.status !== 0) {
  console.error(read.stderr);
  process.exit(1);
}
const rows = JSON.parse(read.stdout) as LeadRow[];
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1]?.toLowerCase() : undefined;
const picked = only ? rows.filter((r) => r.company.toLowerCase() === only) : rows;

const plan = await planBriefs(picked, kv ?? new MemoryKV());
for (const p of plan) {
  const link = p.brief ? `https://getaiengineer.dev/?ref=${p.slug}${p.isNew ? " (new link)" : ""}` : "no usable facts, skipped";
  console.log(`\n${p.company}: ${link}`);
  for (const f of p.brief?.facts ?? []) console.log(`  keep ${f.text}`);
  for (const d of p.dropped) console.log(`  drop ${d}`);
}
if (write) console.log(`\nwrote ${await writeBriefs(plan, kv!)} briefs`);
else console.log("\nDry run. Add --write to store these briefs.");
```

In `package.json` `scripts`, add `"briefs": "tsx --env-file-if-exists=.env scripts/push-briefs.ts"`. In `tsconfig.json`, change `"include"` to `["src", "evals", "tests", "scripts", "*.ts"]`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: PASS; exit codes `0`.

- [ ] **Step 7: Dry run against the real tracker (local only, nothing written, nothing committed)**

Run: `pnpm briefs` with `AIYAZ_LEADS_FILE` set in `.env` to the tracker's path (the path is in Imran's private notes, not in this repo).
Expected: one block per company with a `keep`/`drop` list and "Dry run." at the end. Any fact with a funding figure shows as `drop`. Do not paste this output into any commit, issue or file in this repo.

- [ ] **Step 8: Commit**

```bash
git add scripts/brief-rows.ts scripts/read-leads.py scripts/push-briefs.ts tests/brief-rows.test.ts package.json tsconfig.json
git commit -m "pnpm briefs: lead tracker facts to Upstash briefs, stable slugs, money facts dropped, dry run by default"
```

- [ ] **Step 9: Stop: the live write needs Upstash connected to the getaiengineer Vercel project.** When Imran has connected it and put `KV_REST_API_URL` and `KV_REST_API_TOKEN` in `.env`, run `pnpm briefs --acme-test --write`. Expected: `wrote aiyaz:brief:acme-test`. Real leads are written only when Imran asks, one company at a time with `--only`.

---

### Task 8: Turn runner, call timer and ending from outside

**Files:**
- Create: `src/voice/turns.ts`
- Modify: `src/conversation.ts` (public `end`)
- Test: `tests/turns.test.ts`, `tests/conversation.test.ts`

**Interfaces:**
- Consumes: `Conversation`, `WRAP_UP`, `EndReason`.
- Produces: `type Brain = { reply(text: string): Promise<string>; readonly ended: boolean }`; `class TurnRunner { constructor(brain: Brain); handle(turnId: string, heard: string): Promise<string | null> }`; `startCallTimer(maxSeconds: number, onExpire: () => void): () => void`; `Conversation.end(reason: Exclude<EndReason, "agent_ended">): string`.

- [ ] **Step 1: Write the failing tests**

`tests/turns.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnRunner, startCallTimer, type Brain } from "../src/voice/turns.js";

function fakeBrain(ms = 5, endAfter = Infinity) {
  let running = 0;
  const brain = {
    calls: [] as string[],
    maxRunning: 0,
    ended: false,
    async reply(text: string) {
      running++;
      brain.maxRunning = Math.max(brain.maxRunning, running);
      brain.calls.push(text);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      if (brain.calls.length >= endAfter) brain.ended = true;
      return `answer to ${text}`;
    },
  };
  return brain satisfies Brain;
}

describe("TurnRunner", () => {
  it("answers the same turn id once, even when asked twice", async () => {
    const brain = fakeBrain();
    const turns = new TurnRunner(brain);
    const [a, b] = await Promise.all([turns.handle("t1", "hello"), turns.handle("t1", "hello")]);
    expect(a).toBe("answer to hello");
    expect(b).toBe("answer to hello");
    expect(await turns.handle("t1", "hello")).toBe("answer to hello");
    expect(brain.calls).toEqual(["hello"]);
  });
  it("never runs two turns at once, and keeps their order", async () => {
    const brain = fakeBrain(20);
    const turns = new TurnRunner(brain);
    const out = await Promise.all([turns.handle("t1", "one"), turns.handle("t2", "two"), turns.handle("t3", "three")]);
    expect(brain.maxRunning).toBe(1);
    expect(brain.calls).toEqual(["one", "two", "three"]);
    expect(out).toEqual(["answer to one", "answer to two", "answer to three"]);
  });
  it("silence makes no model call", async () => {
    const brain = fakeBrain();
    const turns = new TurnRunner(brain);
    expect(await turns.handle("t1", "   ")).toBeNull();
    expect(await turns.handle("t2", "")).toBeNull();
    expect(brain.calls).toEqual([]);
  });
  it("says nothing more once the conversation has ended", async () => {
    const brain = fakeBrain(5, 1);
    const turns = new TurnRunner(brain);
    const [first, second] = await Promise.all([turns.handle("t1", "bye"), turns.handle("t2", "still there?")]);
    expect(first).toBe("answer to bye");
    expect(second).toBeNull();
    expect(brain.calls).toEqual(["bye"]);
  });
  it("keeps going after a failed turn", async () => {
    let fail = true;
    const brain: Brain = {
      ended: false,
      async reply(text) {
        if (fail) {
          fail = false;
          throw new Error("boom");
        }
        return text;
      },
    };
    const turns = new TurnRunner(brain);
    await expect(turns.handle("t1", "a")).rejects.toThrow("boom");
    expect(await turns.handle("t2", "b")).toBe("b");
  });
});

describe("call timer", () => {
  afterEach(() => vi.useRealTimers());
  it("the call timer fires with no turns at all", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    startCallTimer(600, onExpire);
    vi.advanceTimersByTime(599_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });
  it("can be cancelled when the call ends first", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const cancel = startCallTimer(600, onExpire);
    cancel();
    vi.advanceTimersByTime(600_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
```

Add to `describe("limits")` in `tests/conversation.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- turns conversation`
Expected: FAIL with `Cannot find module '../src/voice/turns.js'` and `c.end is not a function`.

- [ ] **Step 3: Implement** `src/voice/turns.ts`

```ts
// One visitor turn, one reply() call. LiveKit decides when a turn is finished; this makes
// sure each finished turn reaches the stateful brain exactly once, one at a time, in order.

export type Brain = { reply(text: string): Promise<string>; readonly ended: boolean };

export class TurnRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly answered = new Map<string, Promise<string | null>>();

  constructor(private readonly brain: Brain) {}

  handle(turnId: string, heard: string): Promise<string | null> {
    // Asked again for a turn already in hand (interruption, resume, retry): same answer, no new call.
    const known = this.answered.get(turnId);
    if (known) return known;
    const text = heard.trim();
    // Silence or noise: say nothing and spend nothing.
    if (!text) return Promise.resolve(null);
    const run = () => (this.brain.ended ? Promise.resolve(null) : this.brain.reply(text));
    const answer = this.tail.then(run, run);
    this.tail = answer.catch(() => undefined);
    this.answered.set(turnId, answer);
    return answer;
  }
}

// The brain only checks the time limit when someone speaks, so a silent call needs its own clock.
export function startCallTimer(maxSeconds: number, onExpire: () => void): () => void {
  const timer = setTimeout(onExpire, maxSeconds * 1000);
  return () => clearTimeout(timer);
}
```

- [ ] **Step 4: Implement** in `src/conversation.ts`, add a public method directly above `private finish(`:

```ts
  // Ends the call from outside the model loop, for example the worker's 10-minute timer.
  // Returns the fixed wrap-up line to speak, or "" if the call had already ended.
  end(reason: Exclude<EndReason, "agent_ended">): string {
    if (this.ended) return "";
    return this.finish(reason);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: PASS; exit codes `0`.

- [ ] **Step 6: Commit**

```bash
git add src/voice/turns.ts src/conversation.ts tests/turns.test.ts tests/conversation.test.ts
git commit -m "Turn runner: reply once per turn id, serial, nothing on silence; call timer; Conversation.end for the time cap"
```

---

### Task 9: Call log, summary, transcript store, spend settle and summary email

**Files:**
- Create: `src/calllog.ts`
- Modify: `src/config.ts` (summary and spend settings), `.env.example`
- Test: `tests/calllog.test.ts`

**Interfaces:**
- Consumes: `KV`, `MemoryKV` (Task 6), `CallMeta` (Task 6), `Notes`, `Turn`.
- Produces:
  - `Settings` gains `summaryTo: string`, `summaryFrom: string`, `transcriptDays: number`, `voiceUsdPerMinute: number`.
  - `type CallLog = { id: string; startedAt: string; endedAt: string; durationSec: number; country: string | null; slug: string | null; company: string | null; email: string | null; endReason: string; claudeUsd: number; voiceUsd: number; costUsd: number; notes: Notes; transcript: Turn[]; summary: string[] }`
  - `type CallLogInput = { id: string; startedAt: number; endedAt: number; meta: CallMeta; company: string | null; endReason: string; claudeUsd: number; notes: Notes; transcript: Turn[]; voiceUsdPerMinute: number }`
  - `summaryLines(notes: Notes, transcript: Turn[]): string[]`, `buildCallLog(input: CallLogInput): CallLog`, `CALL_KEY(id: string): string`, `SPEND_KEY(day: string): string`, `dayOf(ms: number): string`, `storeCall(kv: KV, log: CallLog, opts: { transcriptDays: number; reservedUsd: number }): Promise<void>`, `emailSubject(log: CallLog): string`, `emailText(log: CallLog): string`, `sendSummaryEmail(log: CallLog, opts: { apiKey: string; to: string; from: string; fetchFn?: typeof fetch }): Promise<boolean>`

- [ ] **Step 1: Write the failing test** `tests/calllog.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  CALL_KEY,
  SPEND_KEY,
  buildCallLog,
  emailSubject,
  emailText,
  sendSummaryEmail,
  storeCall,
  summaryLines,
} from "../src/calllog.js";
import { MemoryKV } from "../src/kv.js";
import { applyNotesUpdate, emptyNotes } from "../src/notes.js";

const brief = {
  company: "Acme",
  facts: [
    { text: "import customers from a CRM", source: "s" },
    { text: "send payment reminders", source: "s" },
  ],
};
const notes = applyNotesUpdate(emptyNotes(brief), {
  product: "an invoicing app",
  add_symptoms: ["the assistant gives wrong due dates"],
  confirm_facts: ["send payment reminders"],
  reject_facts: ["import customers from a CRM"],
});
const transcript = [
  { role: "aiyaz" as const, text: "I'm Aiyaz, an AI agent from getaiengineer.dev." },
  { role: "prospect" as const, text: "We make an invoicing app." },
  { role: "aiyaz" as const, text: "My guess is the assistant reads dates from the wrong field." },
];
const START = Date.parse("2026-10-05T10:00:00Z");
const log = buildCallLog({
  id: "call-1",
  startedAt: START,
  endedAt: START + 300_000,
  meta: { country: "AE", slug: "acme-test", email: "cto@acme.example" },
  company: "Acme",
  endReason: "agent_ended",
  claudeUsd: 0.12,
  notes,
  transcript,
  voiceUsdPerMinute: 0.05,
});

describe("summary", () => {
  it("keeps what the visitor said and confirmed, and drops what they corrected", () => {
    const lines = summaryLines(notes, transcript).join("\n");
    expect(lines).toContain("an invoicing app");
    expect(lines).toContain("the assistant gives wrong due dates");
    expect(lines).toContain("Confirmed: send payment reminders");
    expect(lines).toContain("My guess is the assistant reads dates from the wrong field.");
    expect(lines).not.toContain("CRM");
  });
  it("works for a call that ended before anything was learned", () => {
    expect(summaryLines(emptyNotes(null), [])).toEqual([]);
  });
});

describe("call log", () => {
  it("records who, where, how long and what it cost, voice included", () => {
    expect(log.durationSec).toBe(300);
    expect(log.voiceUsd).toBeCloseTo(0.25);
    expect(log.costUsd).toBeCloseTo(0.37);
    expect(log.email).toBe("cto@acme.example");
    expect(log.startedAt).toBe("2026-10-05T10:00:00.000Z");
  });
  it("stores the transcript for 30 days and settles the day's reserved spend", async () => {
    const kv = new MemoryKV();
    await kv.set(SPEND_KEY("2026-10-05"), "1"); // reserved by the token function
    await storeCall(kv, log, { transcriptDays: 30, reservedUsd: 1 });
    expect(JSON.parse((await kv.get(CALL_KEY("call-1")))!).transcript).toHaveLength(3);
    expect(kv.ttl.get(CALL_KEY("call-1"))).toBe(2_592_000);
    expect(Number(await kv.get(SPEND_KEY("2026-10-05")))).toBeCloseTo(0.37);
  });
});

describe("summary email", () => {
  it("has the visitor's email, company, country, summary and transcript", () => {
    expect(emailSubject(log)).toBe("Aiyaz call with Acme (AE, 5 min)");
    const body = emailText(log);
    for (const s of ["cto@acme.example", "Acme", "AE", "300 s", "USD 0.370", "an invoicing app", "Visitor: We make an invoicing app."]) {
      expect(body).toContain(s);
    }
  });
  it("posts to Resend with the key, and reply-to set to the visitor", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await sendSummaryEmail(log, { apiKey: "re_test", to: "team@getaiengineer.dev", from: "Aiyaz <aiyaz@getaiengineer.dev>", fetchFn: fake });
    expect(ok).toBe(true);
    const sent = calls[0]!;
    expect(sent.url).toBe("https://api.resend.com/emails");
    expect((sent.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(sent.init.body));
    expect(body.to).toEqual(["team@getaiengineer.dev"]);
    expect(body.reply_to).toBe("cto@acme.example");
    expect(body.subject).toBe(emailSubject(log));
  });
  it("never throws when Resend fails", async () => {
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await sendSummaryEmail(log, { apiKey: "k", to: "t@x.co", from: "f@x.co", fetchFn: down })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- calllog`
Expected: FAIL with `Cannot find module '../src/calllog.js'`.

- [ ] **Step 3: Settings.** In `src/config.ts`, add to `Settings`:

```ts
  summaryTo: string;
  summaryFrom: string;
  transcriptDays: number;
  // Deepgram + TTS estimate per call minute, counted in the daily total. Measured in the voice spike.
  voiceUsdPerMinute: number;
```

and to `loadSettings()`:

```ts
    summaryTo: env("AIYAZ_SUMMARY_TO", ""),
    summaryFrom: env("AIYAZ_SUMMARY_FROM", "Aiyaz <aiyaz@getaiengineer.dev>"),
    // Spec assumption, Imran to confirm.
    transcriptDays: num("AIYAZ_TRANSCRIPT_DAYS", 30),
    voiceUsdPerMinute: num("AIYAZ_VOICE_USD_PER_MIN", 0.05),
```

Append to `.env.example`:

```
# Summary email (Resend, sending from the getaiengineer.dev domain)
RESEND_API_KEY=
AIYAZ_SUMMARY_TO=
```

- [ ] **Step 4: Implement** `src/calllog.ts`

```ts
// What is kept after a call, the email the team gets, and the day's spend.
// Built only from notes and what was said, never from a new model call.
import type { Turn } from "./conversation.js";
import type { KV } from "./kv.js";
import type { Notes } from "./notes.js";
import type { CallMeta } from "./voice/meta.js";

export type CallLog = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  country: string | null;
  slug: string | null;
  company: string | null;
  email: string | null;
  endReason: string;
  claudeUsd: number;
  voiceUsd: number;
  costUsd: number;
  notes: Notes;
  transcript: Turn[];
  summary: string[];
};

export type CallLogInput = {
  id: string;
  startedAt: number;
  endedAt: number;
  meta: CallMeta;
  company: string | null;
  endReason: string;
  claudeUsd: number;
  notes: Notes;
  transcript: Turn[];
  voiceUsdPerMinute: number;
};

export const CALL_KEY = (id: string) => `aiyaz:call:${id}`;
export const SPEND_KEY = (day: string) => `aiyaz:spend:${day}`;
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const TWO_DAYS = 2 * 86_400;

// Corrected brief facts never appear: only notes fields, confirmed facts and Aiyaz's last words.
export function summaryLines(notes: Notes, transcript: Turn[]): string[] {
  const lines = [
    notes.product && `Product: ${notes.product}`,
    notes.users && `Used by: ${notes.users}`,
    notes.aiFeature && `AI feature: ${notes.aiFeature}`,
    notes.owner && `Owner: ${notes.owner}`,
    ...notes.symptoms.map((s) => `In the way: ${s}`),
    ...notes.tried.map((t) => `Already tried: ${t}`),
    ...notes.confirmedFacts.map((f) => `Confirmed: ${f}`),
  ].filter((x): x is string => Boolean(x));
  const last = [...transcript].reverse().find((t) => t.role === "aiyaz")?.text;
  if (last && lines.length) lines.push(`Aiyaz's last words: ${last}`);
  return lines;
}

export function buildCallLog(i: CallLogInput): CallLog {
  const durationSec = Math.max(0, Math.round((i.endedAt - i.startedAt) / 1000));
  const voiceUsd = (durationSec / 60) * i.voiceUsdPerMinute;
  return {
    id: i.id,
    startedAt: new Date(i.startedAt).toISOString(),
    endedAt: new Date(i.endedAt).toISOString(),
    durationSec,
    country: i.meta.country,
    slug: i.meta.slug,
    company: i.company,
    email: i.meta.email,
    endReason: i.endReason,
    claudeUsd: i.claudeUsd,
    voiceUsd,
    costUsd: i.claudeUsd + voiceUsd,
    notes: i.notes,
    transcript: i.transcript,
    summary: summaryLines(i.notes, i.transcript),
  };
}

// The token function reserved reservedUsd for this call on its start day; settle to the real cost.
export async function storeCall(kv: KV, log: CallLog, opts: { transcriptDays: number; reservedUsd: number }): Promise<void> {
  await kv.set(CALL_KEY(log.id), JSON.stringify(log), opts.transcriptDays * 86_400);
  await kv.incrByFloat(SPEND_KEY(log.startedAt.slice(0, 10)), log.costUsd - opts.reservedUsd, TWO_DAYS);
}

export function emailSubject(log: CallLog): string {
  const who = log.company ?? log.email ?? "a visitor";
  return `Aiyaz call with ${who} (${log.country ?? "country unknown"}, ${Math.round(log.durationSec / 60)} min)`;
}

export function emailText(log: CallLog): string {
  return [
    `Visitor email: ${log.email ?? "not given"}`,
    `Company: ${log.company ?? "not known"}${log.slug ? ` (lead link ${log.slug})` : ""}`,
    `Country: ${log.country ?? "unknown"}`,
    `Duration: ${log.durationSec} s. Ended: ${log.endReason}. Cost: USD ${log.costUsd.toFixed(3)}`,
    "",
    "Summary:",
    ...(log.summary.length ? log.summary.map((l) => `- ${l}`) : ["- Nothing learned in this call."]),
    "",
    "Transcript:",
    ...log.transcript.map((t) => `${t.role === "aiyaz" ? "Aiyaz" : "Visitor"}: ${t.text}`),
    "",
    `Call id: ${log.id}`,
  ].join("\n");
}

export async function sendSummaryEmail(
  log: CallLog,
  opts: { apiKey: string; to: string; from: string; fetchFn?: typeof fetch },
): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: emailSubject(log),
        text: emailText(log),
        ...(log.email ? { reply_to: log.email } : {}),
      }),
    });
    if (!res.ok) console.error(`[call] summary email failed: ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error(`[call] summary email failed: ${String(err)}`);
    return false;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: PASS; exit codes `0`.

- [ ] **Step 6: Commit**

```bash
git add src/calllog.ts src/config.ts tests/calllog.test.ts .env.example
git commit -m "Call log: summary from notes, transcript kept 30 days, daily spend settled, summary email via Resend"
```

---

### Task 10: Site price by country (getaiengineer repo)

**Files (repo `~/getaiengineer`):**
- Create: `price-core.js`
- Modify: `price.js`, `package.json` (test script), `.gitignore`, `.vercelignore`
- Test: `tests/price.test.js`

**Interfaces:**
- Consumes: `GET /api/geo` → `{ country: string }` (exists).
- Produces: `priceFor(country: string | null | undefined): string | null` (`null` keeps the AED text in the HTML). `USD_PRICE = "$6,000"`.

- [ ] **Step 1: Open the site worktree** (CLAUDE.md step 1)

```bash
git -C ~/getaiengineer fetch origin
git -C ~/getaiengineer worktree add .claude/worktrees/aiyaz-live-voice -b aiyaz-live-voice origin/main
```
All site steps below run in `~/getaiengineer/.claude/worktrees/aiyaz-live-voice`. `.vercel/` is gitignored, so link the worktree to the existing project before any `vercel` command, or the CLI may create a stray project named after the folder:

```bash
mkdir -p .vercel && cp ~/getaiengineer/.vercel/project.json .vercel/
grep -o '"projectName":"[^"]*"' .vercel/project.json
```
Expected: `"projectName":"getaiengineer"`. Note: `vercel pull` (Task 11) writes preview secrets to `.vercel/.env.preview.local`, which is gitignored but on disk; delete it when the worktree is removed.

- [ ] **Step 2: Write the failing test** `tests/price.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceFor } from "../price-core.js";

// The same table is tested in the aiyaz repo (tests/country.test.ts). Change both or neither.
test("matches the aiyaz priceKey table", () => {
  const table = [
    ["AE", null],
    ["ae", null],
    ["IN", "$6,000"],
    ["US", "$6,000"],
    ["GB", "$6,000"],
    [" in ", "$6,000"],
    ["", null],
    [null, null],
    ["UAE", null],
  ];
  for (const [country, price] of table) assert.equal(priceFor(country), price, String(country));
});
```

In `package.json` `scripts`, add `"test": "node --test"`. Append `node_modules/` to `.gitignore`. Append `tests` to `.vercelignore` (test files are not served).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../price-core.js'`.

- [ ] **Step 4: Implement** `price-core.js`

```js
// Sprint price by visitor country. Must match priceKey() in the aiyaz repo (src/config.ts):
// AE and unknown keep the AED price written in the HTML; any other known country sees USD.
export const USD_PRICE = "$6,000";

export function priceFor(country) {
  const c = String(country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === "AE") return null;
  return USD_PRICE;
}
```

Replace `price.js` with:

```js
// Visitors from any known country outside the UAE see the sprint price in US dollars.
// The UAE, and anyone whose country cannot be read, keep the AED price written in the HTML.
import { priceFor } from "/price-core.js";

const spots = document.querySelectorAll("[data-price]");
if (spots.length) {
  fetch("/api/geo")
    .then((r) => (r.ok ? r.json() : null))
    .then((geo) => {
      const price = geo && priceFor(geo.country);
      if (price) spots.forEach((el) => { el.textContent = price; });
    })
    .catch(() => {});
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test; echo $?`
Expected: PASS; `0`.

- [ ] **Step 6: Check in the browser**

Run: `npm run dev` and open `http://localhost:4321`. The static dev server has no `/api/geo`, so the fetch fails and the hero and price card keep "AED 25,000". In DevTools console run `(await import("/price-core.js")).priceFor("IN")`. Expected: `"$6,000"`.

- [ ] **Step 7: Commit**

```bash
git add price-core.js price.js tests/price.test.js package.json .gitignore .vercelignore
git commit -m "Price by country: USD 6,000 for every known country outside the UAE; AE and unknown keep AED"
```

---

### Task 11: Token function (getaiengineer repo)

**Files (site worktree):**
- Create: `lib/aiyaz-core.js`, `lib/upstash.js`, `api/aiyaz-token.js`
- Modify: `package.json` (dependency), `.vercelignore` (stop ignoring `package.json`)
- Test: `tests/aiyaz-token.test.js`

**Interfaces:**
- Consumes: Upstash keys from Global Constraints; env `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, optional `AIYAZ_DAILY_CAP_USD`, `AIYAZ_CALLS_PER_DAY`, `AIYAZ_PER_CALL_USD`.
- Produces:
  - `GET /api/aiyaz-token?ref=<slug>` → `200 { company }` or `404 { error: "not found" }`.
  - `POST /api/aiyaz-token` body `{ email?: string, ref?: string }` → `200 { token, url, company }` | `400 { error: "email" }` | `429 { error: "limit" }` | `503 { error: "cap" }` | `503 { error: "unavailable" }`.
  - Token: identity `visitor-<uuid>`, room `aiyaz-<uuid>`, 15-minute TTL, dispatches agent `aiyaz` with metadata JSON `{ country, slug?, email? }`.
  - `lib/aiyaz-core.js`: `SLUG`, `EMAIL`, `LIMITS`, `normEmail`, `normCountry`, `dayOf`, `limitsFromEnv(env)`, `leadCompany(kv, ref)`, `decideCall({ body, country, ip, now, kv, limits })`.
  - `lib/upstash.js`: `upstash(url, token, fetchFn?)` → `{ get(key), incr(key, exSeconds), incrByFloat(key, by, exSeconds) }`.
  - `api/aiyaz-token.js`: `mintToken({ metadata, apiKey, apiSecret })`, default edge handler.

- [ ] **Step 1: Install the SDK and let Vercel see `package.json`**

```bash
npm install livekit-server-sdk@2.19.1
```
Remove the `package.json` line from `.vercelignore` (the edge function needs the dependency installed at deploy). `.vercelignore` is now `scripts` and `tests`.

- [ ] **Step 2: Write the failing test** `tests/aiyaz-token.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCall, leadCompany } from "../lib/aiyaz-core.js";

const NOW = Date.parse("2026-10-05T10:00:00Z");
const DAY = "2026-10-05";
const ACME = JSON.stringify({ company: "Acme", facts: [{ text: "launched an AI assistant", source: "https://acme.example" }] });

function fakeKv(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(k) { return data.has(k) ? String(data.get(k)) : null; },
    async incr(k) { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n; },
    async incrByFloat(k, by) { const n = Number(data.get(k) ?? 0) + by; data.set(k, String(n)); return n; },
  };
}
const call = (kv, body, extra = {}) => decideCall({ body, country: "IN", ip: "1.1.1.1", now: NOW, kv, ...extra });

test("a homepage call needs a real email", async () => {
  for (const email of [undefined, "", "nope", "a@b", "a b@c.co"]) {
    assert.deepEqual(await call(fakeKv(), { email }), { status: 400, error: "email" }, String(email));
  }
});

test("a bad or unknown ref falls back to the email gate", async () => {
  const kv = fakeKv({ "aiyaz:brief:acme-7k2q": ACME });
  assert.equal((await call(kv, { ref: "../x" })).error, "email");
  assert.equal((await call(kv, { ref: "nope-1234" })).error, "email");
});

test("a lead call needs no email and carries the slug", async () => {
  const kv = fakeKv({ "aiyaz:brief:acme-7k2q": ACME });
  const d = await call(kv, { ref: "acme-7k2q" }, { country: "ae" });
  assert.equal(d.status, 200);
  assert.equal(d.company, "Acme");
  assert.deepEqual(d.metadata, { country: "AE", slug: "acme-7k2q" });
});

test("a homepage call carries country and email only", async () => {
  const d = await call(fakeKv(), { email: "cto@example.com" }, { country: "" });
  assert.equal(d.status, 200);
  assert.deepEqual(d.metadata, { country: null, email: "cto@example.com" });
  assert.equal(d.company, null);
});

test("email is normalised before counting", async () => {
  const kv = fakeKv();
  for (const email of ["a@b.co", " A@B.co ", "a@B.CO"]) {
    assert.equal((await call(kv, { email }, { ip: `9.9.9.${email.length}` })).status, 200);
  }
  assert.deepEqual(await call(kv, { email: "A@b.co" }, { ip: "8.8.8.8" }), { status: 429, error: "limit" });
});

test("three calls a day per IP, even with new emails", async () => {
  const kv = fakeKv();
  for (const n of [1, 2, 3]) assert.equal((await call(kv, { email: `p${n}@x.co` })).status, 200);
  assert.deepEqual(await call(kv, { email: "p4@x.co" }), { status: 429, error: "limit" });
  assert.equal((await call(kv, { email: "p5@x.co" }, { ip: "2.2.2.2" })).status, 200);
});

test("each call reserves USD 1 of the USD 5 daily cap", async () => {
  const kv = fakeKv({ [`aiyaz:spend:${DAY}`]: "3.9" });
  assert.equal((await call(kv, { email: "a@x.co" })).status, 200);
  assert.ok(Math.abs(Number(kv.data.get(`aiyaz:spend:${DAY}`)) - 4.9) < 1e-9);
  assert.deepEqual(await call(kv, { email: "b@x.co" }, { ip: "3.3.3.3" }), { status: 503, error: "cap" });
  assert.ok(Math.abs(Number(kv.data.get(`aiyaz:spend:${DAY}`)) - 4.9) < 1e-9, "refused call is refunded");
});

test("two calls at the cap edge: exactly one starts", async () => {
  const kv = fakeKv({ [`aiyaz:spend:${DAY}`]: "3.5" });
  const results = await Promise.all([
    call(kv, { email: "a@x.co" }, { ip: "4.4.4.4" }),
    call(kv, { email: "b@x.co" }, { ip: "5.5.5.5" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 503]);
  assert.ok(Math.abs(Number(kv.data.get(`aiyaz:spend:${DAY}`)) - 4.5) < 1e-9);
});

test("the lead lookup returns the display name only", async () => {
  const kv = fakeKv({ "aiyaz:brief:acme-7k2q": ACME });
  assert.equal(await leadCompany(kv, "acme-7k2q"), "Acme");
  assert.equal(await leadCompany(kv, "nope-1234"), null);
  assert.equal(await leadCompany(kv, "../x"), null);
});

// The handler, end to end, against a fake Upstash and the real LiveKit SDK (signing needs no account).
function fakeUpstash(data) {
  return async (_url, init) => {
    const results = JSON.parse(init.body).map(([op, key, ...rest]) => {
      if (op === "GET") return { result: data.get(key) ?? null };
      if (op === "INCR") { const n = Number(data.get(key) ?? 0) + 1; data.set(key, String(n)); return { result: n }; }
      if (op === "INCRBYFLOAT") { const n = Number(data.get(key) ?? 0) + Number(rest[0]); data.set(key, String(n)); return { result: String(n) }; }
      if (op === "EXPIRE") return { result: 1 };
      return { error: `unknown ${op}` };
    });
    return new Response(JSON.stringify(results));
  };
}

test("the handler serves the lookup, mints a token and gates email", async () => {
  const data = new Map([["aiyaz:brief:acme-7k2q", ACME]]);
  globalThis.fetch = fakeUpstash(data);
  Object.assign(process.env, {
    KV_REST_API_URL: "https://kv.example",
    KV_REST_API_TOKEN: "t",
    LIVEKIT_URL: "wss://aiyaz.livekit.example",
    LIVEKIT_API_KEY: "APIkey",
    LIVEKIT_API_SECRET: "a-test-secret-that-is-long-enough-to-sign-with",
  });
  const { default: handler } = await import("../api/aiyaz-token.js");

  const lookup = await handler(new Request("https://x.test/api/aiyaz-token?ref=acme-7k2q"));
  assert.equal(lookup.status, 200);
  const body = await lookup.json();
  assert.deepEqual(Object.keys(body), ["company"]);
  assert.equal(body.company, "Acme");
  assert.equal((await handler(new Request("https://x.test/api/aiyaz-token?ref=nope-1234"))).status, 404);

  const post = (json, headers = {}) =>
    handler(new Request("https://x.test/api/aiyaz-token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7", "x-vercel-ip-country": "IN", ...headers },
      body: JSON.stringify(json),
    }));
  assert.equal((await post({ email: "nope" })).status, 400);

  const ok = await post({ email: "cto@example.com" });
  assert.equal(ok.status, 200);
  const { token, url } = await ok.json();
  assert.equal(url, "wss://aiyaz.livekit.example");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.match(claims.video.room, /^aiyaz-/);
  assert.equal(claims.video.roomJoin, true);
  const dispatch = claims.roomConfig.agents[0];
  assert.equal(dispatch.agentName, "aiyaz");
  assert.deepEqual(JSON.parse(dispatch.metadata), { country: "IN", email: "cto@example.com" });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../lib/aiyaz-core.js'`.

- [ ] **Step 4: Implement** `lib/upstash.js`

```js
// Upstash Redis over REST, as the tracking function uses it. No SDK, so it runs on the edge.
export function upstash(url, token, fetchFn = (...a) => fetch(...a)) {
  const run = async (commands) => {
    const res = await fetchFn(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const out = await res.json();
    const failed = out.find((r) => r.error);
    if (failed) throw new Error(`Upstash: ${failed.error}`);
    return out.map((r) => r.result);
  };
  return {
    async get(key) {
      const [v] = await run([["GET", key]]);
      return v ?? null;
    },
    async incr(key, exSeconds) {
      const [v] = await run([["INCR", key], ["EXPIRE", key, String(exSeconds)]]);
      return Number(v);
    },
    async incrByFloat(key, by, exSeconds) {
      const [v] = await run([["INCRBYFLOAT", key, String(by)], ["EXPIRE", key, String(exSeconds)]]);
      return Number(v);
    },
  };
}
```

- [ ] **Step 5: Implement** `lib/aiyaz-core.js`

```js
// Who may start an Aiyaz call, and with what metadata. Pure logic over a small store,
// so it is tested without Vercel, Upstash or LiveKit. Keys are shared with the aiyaz worker.
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const LIMITS = { callsPerVisitorPerDay: 3, dailyCapUsd: 5, perCallUsd: 1 };
const TWO_DAYS = 2 * 86_400;

export const normEmail = (e) => String(e ?? "").trim().toLowerCase();
export const normCountry = (c) => {
  const x = String(c ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(x) ? x : null;
};
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function limitsFromEnv(env) {
  const n = (key, fallback) => (env[key] === undefined ? fallback : Number(env[key]));
  return {
    callsPerVisitorPerDay: n("AIYAZ_CALLS_PER_DAY", LIMITS.callsPerVisitorPerDay),
    dailyCapUsd: n("AIYAZ_DAILY_CAP_USD", LIMITS.dailyCapUsd),
    // Must equal AIYAZ_COST_CAP_USD on the worker, which settles this reservation.
    perCallUsd: n("AIYAZ_PER_CALL_USD", LIMITS.perCallUsd),
  };
}

// The display name for a valid lead link, never any fact from the brief.
export async function leadCompany(kv, ref) {
  if (!SLUG.test(String(ref ?? ""))) return null;
  const raw = await kv.get(`aiyaz:brief:${ref}`);
  if (!raw) return null;
  try {
    const company = JSON.parse(raw).company;
    return typeof company === "string" && company.trim() ? company.trim() : null;
  } catch {
    return null;
  }
}

export async function decideCall({ body, country, ip, now, kv, limits = LIMITS }) {
  const ref = typeof body?.ref === "string" ? body.ref : "";
  const company = ref ? await leadCompany(kv, ref) : null;
  const email = normEmail(body?.email);
  const hasEmail = EMAIL.test(email);
  // A lead link identifies the company; everyone else gives an email first.
  if (!company && !hasEmail) return { status: 400, error: "email" };

  const day = dayOf(now);
  const visitorKeys = [`aiyaz:calls:${day}:ip:${ip || "unknown"}`];
  if (hasEmail) visitorKeys.push(`aiyaz:calls:${day}:email:${email}`);
  for (const key of visitorKeys) {
    if ((await kv.incr(key, TWO_DAYS)) > limits.callsPerVisitorPerDay) return { status: 429, error: "limit" };
  }

  // Reserve first, then check, so two calls minted together cannot both pass the cap.
  // The worker settles the real cost when the call closes.
  const spendKey = `aiyaz:spend:${day}`;
  const total = await kv.incrByFloat(spendKey, limits.perCallUsd, TWO_DAYS);
  if (total > limits.dailyCapUsd + 1e-9) {
    await kv.incrByFloat(spendKey, -limits.perCallUsd, TWO_DAYS);
    return { status: 503, error: "cap" };
  }

  const metadata = { country: normCountry(country) };
  if (company) metadata.slug = ref;
  if (hasEmail) metadata.email = email;
  return { status: 200, metadata, company };
}
```

- [ ] **Step 6: Implement** `api/aiyaz-token.js`

```js
// Starts an Aiyaz call: checks the email or lead link, the visitor's daily limit and the
// day's spend cap, then mints a short LiveKit token that dispatches the aiyaz worker.
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { decideCall, leadCompany, limitsFromEnv } from "../lib/aiyaz-core.js";
import { upstash } from "../lib/upstash.js";

export const config = { runtime: "edge" };

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function mintToken({ metadata, apiKey, apiSecret }) {
  const room = `aiyaz-${crypto.randomUUID()}`;
  const at = new AccessToken(apiKey, apiSecret, { identity: `visitor-${crypto.randomUUID()}`, ttl: "15m" });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: "aiyaz", metadata: JSON.stringify(metadata) })],
  });
  return { token: await at.toJwt(), room };
}

export default async function handler(request) {
  const env = process.env;
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return json(503, { error: "unavailable" });
  const kv = upstash(env.KV_REST_API_URL, env.KV_REST_API_TOKEN);
  try {
    if (request.method === "GET") {
      const company = await leadCompany(kv, new URL(request.url).searchParams.get("ref"));
      return company ? json(200, { company }) : json(404, { error: "not found" });
    }
    if (request.method !== "POST") return json(405, { error: "method" });
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return json(503, { error: "unavailable" });
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "email" });
    }
    const d = await decideCall({
      body,
      country: request.headers.get("x-vercel-ip-country"),
      ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim(),
      now: Date.now(),
      kv,
      limits: limitsFromEnv(env),
    });
    if (d.status !== 200) return json(d.status, { error: d.error });
    const { token } = await mintToken({ metadata: d.metadata, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET });
    return json(200, { token, url: env.LIVEKIT_URL, company: d.company });
  } catch {
    return json(503, { error: "unavailable" });
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test; echo $?`
Expected: PASS; `0`. If only the last test fails on `claims.roomConfig.agents[0].agentName`, print `claims` in the test, read the claim name the installed SDK emits, and assert on that name instead; the dispatch metadata assertions stay.

- [ ] **Step 8: Check the edge build** (uses the existing Vercel login; no new account)

Run: `npx vercel@latest pull --yes --environment=preview; npx vercel@latest build; echo $?`
Expected: `0`, and `.vercel/output/functions/api/aiyaz-token.func/.vc-config.json` shows `"runtime": "edge"`. If the build reports a Node-only module inside `livekit-server-sdk`, stop and report to Imran (the fallback is signing the JWT with Web Crypto inside the function).

- [ ] **Step 9: Commit**

```bash
git add lib/aiyaz-core.js lib/upstash.js api/aiyaz-token.js tests/aiyaz-token.test.js package.json package-lock.json .vercelignore
git commit -m "Aiyaz token function: email or lead link, 3 calls a day per email and IP, USD 5 daily cap reserved per call"
```

---

### Task 12: Call page on the site (getaiengineer repo)

**Files (site worktree):**
- Create: `call-core.js`, `call.js`, `vendor/livekit-client-2.22.3.esm.mjs`
- Modify: `index.html` (the `.call` figure and a script tag), `field.js` (drop the mock call), `styles.css`
- Test: `tests/call-page.test.js`

**Interfaces:**
- Consumes: `GET`/`POST /api/aiyaz-token` (Task 11); LiveKit transcription text streams on topic `lk.transcription`.
- Produces: `call-core.js` exports `MESSAGES`, `isEmail(e)`, `cardLabel(company)`, `messageFor(error)`, `refFrom(search, stored)`. The `.call` element dispatches `CustomEvent("aiyaz:state", { detail: "idle" | "connecting" | "live" | "ended" })`, which `field.js` uses for the orb.

- [ ] **Step 1: Vendor the client** (versioned file name: `/vendor/` is cached for a year)

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.esm.mjs -o vendor/livekit-client-2.22.3.esm.mjs
curl -fsSL https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/LICENSE -o vendor/livekit-client.LICENSE
```

- [ ] **Step 2: Write the failing test** `tests/call-page.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MESSAGES, cardLabel, isEmail, messageFor, refFrom } from "../call-core.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = read("index.html");

test("the privacy note is the agreed text", () => {
  assert.ok(html.includes(
    "We use your email to send you a summary of this call and to follow up. Calls are recorded as text to improve Aiyaz and deleted after 30 days.",
  ));
});

test("the microphone message is the agreed text", () => {
  assert.equal(MESSAGES.mic, "Aiyaz needs your microphone to talk. You can book a call or message us instead.");
});

test("the end panel offers booking and WhatsApp", () => {
  const end = html.match(/<div class="call-end"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(end, /https:\/\/cal\.com\/getaiengineer\/30min/);
  assert.match(end, /https:\/\/wa\.me\/919150686857/);
});

test("the example-call mock is gone and the live call is wired", () => {
  assert.ok(!html.includes("Play example"));
  assert.ok(!read("field.js").includes("Play example"));
  assert.ok(html.includes('<script type="module" src="/call.js"></script>'));
  assert.ok(existsSync(new URL("../vendor/livekit-client-2.22.3.esm.mjs", import.meta.url)));
  assert.ok(read("call.js").includes('from "/vendor/livekit-client-2.22.3.esm.mjs"'));
});

test("card label names the company only for a lead link", () => {
  assert.equal(cardLabel(null), "Talk to Aiyaz");
  assert.equal(cardLabel("Acme"), "Talk to Aiyaz about Acme");
});

test("email check", () => {
  assert.ok(isEmail(" cto@example.com "));
  for (const bad of ["", "a@b", "nope", "a b@c.co"]) assert.ok(!isEmail(bad), bad);
});

test("every refusal maps to a message that offers booking or WhatsApp", () => {
  assert.equal(messageFor("cap"), MESSAGES.cap);
  assert.equal(messageFor("limit"), MESSAGES.limit);
  assert.equal(messageFor("unavailable"), MESSAGES.failed);
  assert.equal(messageFor("anything else"), MESSAGES.failed);
  for (const key of ["mic", "cap", "limit", "failed"]) assert.match(MESSAGES[key], /book a call or message us/);
});

test("ref comes from the link, or from earlier in the visit", () => {
  assert.equal(refFrom("?ref=acme-7k2q", ""), "acme-7k2q");
  assert.equal(refFrom("", "acme-7k2q"), "acme-7k2q");
  assert.equal(refFrom("?ref=../x", ""), "");
  assert.equal(refFrom("", ""), "");
});

test("no em-dashes in the call copy", () => {
  for (const f of ["index.html", "call.js", "call-core.js"]) assert.ok(!read(f).includes("\u2014"), f);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../call-core.js'`.

- [ ] **Step 4: Implement** `call-core.js`

```js
// Copy and small checks for the Aiyaz call card, kept apart from the DOM so they are testable.
export const MESSAGES = {
  mic: "Aiyaz needs your microphone to talk. You can book a call or message us instead.",
  cap: "Aiyaz has taken all its calls for today. You can book a call or message us instead.",
  limit: "You have used today's calls with Aiyaz. You can book a call or message us instead.",
  failed: "The call could not start. You can book a call or message us instead.",
  email: "Please enter a valid email address.",
  ended: "Thanks for talking with Aiyaz. The team will follow up.",
  listening: "Aiyaz is listening. Speak whenever you are ready.",
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const isEmail = (e) => EMAIL.test(String(e ?? "").trim());
export const cardLabel = (company) => (company ? `Talk to Aiyaz about ${company}` : "Talk to Aiyaz");
export const messageFor = (error) => (error === "cap" ? MESSAGES.cap : error === "limit" ? MESSAGES.limit : MESSAGES.failed);

// The lead tag from this link, or the one the tracking script kept from earlier in the visit.
export function refFrom(search, stored) {
  const ref = new URLSearchParams(search).get("ref") || stored || "";
  return SLUG.test(ref) ? ref : "";
}
```

- [ ] **Step 5: Replace the call figure** in `index.html` (the whole `<figure class="call" ...>...</figure>` block) with:

```html
    <figure class="call" data-state="idle" aria-label="Talk to Aiyaz, the getaiengineer.dev voice agent">
      <div class="call-head"><span class="rec" aria-hidden="true"></span><span class="call-time">00:00</span></div>
      <div class="orb" aria-hidden="true"><div class="orb-shader"></div></div>
      <p class="who">Talk to Aiyaz</p>
      <p class="call-note">Aiyaz is an AI agent. A call takes up to 10 minutes.</p>
      <form class="call-email" hidden novalidate>
        <label for="call-email-input">Your email</label>
        <input id="call-email-input" name="email" type="email" autocomplete="email" required>
        <p class="call-privacy">We use your email to send you a summary of this call and to follow up. Calls are recorded as text to improve Aiyaz and deleted after 30 days.</p>
        <button class="btn btn-ink btn-sm" type="submit">Start the call</button>
      </form>
      <div class="voice">
        <button class="play" type="button" aria-pressed="false" aria-label="Talk to Aiyaz">
          <svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>
          <svg class="i-stop" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
        </button>
        <p class="play-label">Talk to Aiyaz</p>
      </div>
      <p class="call-status" role="status" aria-live="polite"></p>
      <ol class="captions" aria-live="polite"></ol>
      <div class="call-end" hidden>
        <a class="btn btn-ink btn-sm" href="https://cal.com/getaiengineer/30min">Book a 30-minute call</a>
        <a class="btn btn-soft btn-sm" href="https://wa.me/919150686857?text=Hi%2C%20I%27d%20like%20to%20talk%20about%20our%20AI%20initiative." target="_blank" rel="noopener">WhatsApp us</a>
      </div>
    </figure>
```

Add `<script type="module" src="/call.js"></script>` after the `price.js` script tag in `<head>`.

- [ ] **Step 6: Implement** `call.js`

```js
// The live Aiyaz call on the homepage card: email step (or a lead link), microphone check,
// token, LiveKit room, live captions, and booking and WhatsApp at the end or on any failure.
import { Room, RoomEvent, Track } from "/vendor/livekit-client-2.22.3.esm.mjs";
import { MESSAGES, cardLabel, isEmail, messageFor, refFrom } from "/call-core.js";

const card = document.querySelector(".call");
if (card) {
  const $ = (s) => card.querySelector(s);
  const play = $(".play");
  const label = $(".play-label");
  const who = $(".who");
  const status = $(".call-status");
  const form = $(".call-email");
  const input = $("#call-email-input");
  const captions = $(".captions");
  const end = $(".call-end");
  const time = $(".call-time");

  let stored = "";
  try { stored = sessionStorage.getItem("gae-ref") || ""; } catch {}
  const ref = refFrom(location.search, stored);
  let company = null;
  let room = null;
  let timer = null;
  let agentJoined = false;
  let joinTimeout = null;

  const say = (t) => { status.textContent = t; };
  const setState = (state) => {
    card.dataset.state = state;
    card.classList.toggle("live", state === "live");
    play.setAttribute("aria-pressed", String(state === "live"));
    const text = state === "live" ? "End the call" : state === "connecting" ? "Connecting" : cardLabel(company);
    label.textContent = text;
    play.setAttribute("aria-label", text);
    card.dispatchEvent(new CustomEvent("aiyaz:state", { detail: state }));
  };

  const finish = (message) => {
    if (card.dataset.state === "ended") return;
    clearInterval(timer);
    clearTimeout(joinTimeout);
    room?.disconnect();
    form.hidden = true;
    end.hidden = false;
    play.disabled = true;
    say(message);
    setState("ended");
  };

  if (ref) {
    fetch(`/api/aiyaz-token?ref=${encodeURIComponent(ref)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.company) return;
        company = d.company;
        who.textContent = cardLabel(company);
        setState(card.dataset.state);
      })
      .catch(() => {});
  }

  const caption = (who, id, text) => {
    let li = captions.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!li) {
      li = document.createElement("li");
      li.dataset.id = id;
      li.className = who;
      captions.append(li);
    }
    li.textContent = text;
    captions.scrollTop = captions.scrollHeight;
  };

  const startTimer = () => {
    let secs = 0;
    timer = setInterval(() => {
      secs++;
      time.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
    }, 1000);
  };

  const micAllowed = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  };

  async function start(body) {
    setState("connecting");
    say("Checking your microphone...");
    // Ask for the microphone before minting, so a refusal costs no call from the daily limit.
    if (!(await micAllowed())) return finish(MESSAGES.mic);
    say("Connecting...");
    let data;
    try {
      const res = await fetch("/api/aiyaz-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "email") {
          setState("idle");
          form.hidden = false;
          say(MESSAGES.email);
          input.focus();
          return;
        }
        return finish(messageFor(data.error));
      }
    } catch {
      return finish(MESSAGES.failed);
    }

    room = new Room();
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) card.append(track.attach());
    });
    room.registerTextStreamHandler("lk.transcription", async (reader, participant) => {
      const id = reader.info.attributes?.["lk.segment_id"] ?? reader.info.id;
      const speaker = participant.identity.startsWith("visitor-") ? "you" : "aiyaz";
      let text = "";
      for await (const chunk of reader) {
        text += chunk;
        caption(speaker, id, text);
      }
    });
    // Live only once Aiyaz is in the room: a worker that is down must not leave the visitor in silence.
    const agentArrived = () => {
      if (agentJoined || card.dataset.state === "ended") return;
      agentJoined = true;
      clearTimeout(joinTimeout);
      setState("live");
      say(MESSAGES.listening);
      startTimer();
    };
    room.on(RoomEvent.ParticipantConnected, (p) => { if (p.isAgent) agentArrived(); });
    // The worker leaves when Aiyaz has finished, hit a limit, or failed.
    room.on(RoomEvent.ParticipantDisconnected, (p) => { if (p.isAgent) finish(MESSAGES.ended); });
    room.on(RoomEvent.Disconnected, () => finish(agentJoined ? MESSAGES.ended : MESSAGES.failed));
    try {
      await room.connect(data.url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.startAudio();
    } catch (err) {
      return finish(/NotAllowed|Permission/i.test(String(err?.name ?? err)) ? MESSAGES.mic : MESSAGES.failed);
    }
    form.hidden = true;
    say("Connecting to Aiyaz...");
    joinTimeout = setTimeout(() => { if (!agentJoined) finish(MESSAGES.failed); }, 15_000);
    if ([...room.remoteParticipants.values()].some((p) => p.isAgent)) agentArrived();
  }

  play.addEventListener("click", () => {
    if (card.dataset.state === "live") return finish(MESSAGES.ended);
    if (card.dataset.state !== "idle") return;
    if (company) return start({ ref });
    form.hidden = false;
    input.focus();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!isEmail(input.value)) {
      say(MESSAGES.email);
      input.focus();
      return;
    }
    start({ email: input.value.trim(), ...(ref ? { ref } : {}) });
  });

  setState("idle");
}
```

- [ ] **Step 7: Drop the mock in** `field.js`. Replace everything from the comment `/* ---------- 2. Aiyaz call UI (mock: no audio yet) ---------- */` to the end of the file with:

```js
/* ---------- 2. Aiyaz orb ---------- */
// call.js runs the live call and announces its state; the dithered sphere speeds up while live.
const call = document.querySelector(".call");
if (call) {
  const mount = new ShaderMount(call.querySelector(".orb-shader"), ditheringFragmentShader, {
    u_colorBack: getShaderColorFromString("#f5f5f5"),
    u_colorFront: getShaderColorFromString("#111111"),
    u_shape: 7, u_type: 3, u_pxSize: 2.5,
    u_fit: 1, u_scale: 0.9, u_rotation: 0, u_originX: 0.5, u_originY: 0.5,
    u_offsetX: 0, u_offsetY: 0, u_worldWidth: 0, u_worldHeight: 0,
  }, undefined, still ? 0 : 0.2);
  call.addEventListener("aiyaz:state", (e) => {
    mount.setSpeed(e.detail === "live" && !still ? 0.8 : 0.2);
  });
}
```

Also change the comment at the top of `field.js` line 4 from "that speeds up while a (mock) call is on." to "that speeds up while a call is on."

- [ ] **Step 8: Styles.** Append to `styles.css`:

```css
/* Live call: email step, captions and the end panel inside the Aiyaz card */
.call-note{font-size:.85rem; color:var(--muted); text-align:center}
.call-email{display:grid; gap:.5rem; width:100%}
.call-email[hidden], .call-end[hidden]{display:none}
.call-email label{font-size:.85rem; font-weight:500}
.call-email input{font:inherit; font-size:1rem; padding:.6rem .8rem; border-radius:12px; border:1px solid var(--faint); background:#fff; color:var(--ink)}
.call-email input:focus-visible{outline:2px solid var(--ink); outline-offset:2px}
.call-privacy{font-size:.78rem; line-height:1.4; color:var(--muted)}
.call-status{min-height:1.2em; font-size:.85rem; color:var(--muted); text-align:center}
.captions{list-style:none; margin:0; padding:0; width:100%; max-height:9rem; overflow-y:auto; display:grid; gap:.35rem; font-size:.85rem; line-height:1.4}
.captions:empty{display:none}
.captions .you{color:var(--muted)}
.captions .aiyaz{color:var(--ink)}
.call-end{display:flex; flex-wrap:wrap; gap:.5rem; justify-content:center}
.play:disabled{opacity:.4; cursor:default; transform:none}
```

- [ ] **Step 9: Run tests and the launch check**

Run: `npm test; echo $?` then `npm run check; echo $?`
Expected: PASS and `READY: no gaps, no em-dashes`; both `0`.

- [ ] **Step 10: Browser check without any voice account**

Run: `npm run dev`, open `http://localhost:4321`.
1. Press the card: the email step appears with the privacy note. Submit "nope": "Please enter a valid email address."
2. Submit `test@example.com` and allow the microphone: the static server has no `/api`, so the card shows "The call could not start..." with Book and WhatsApp buttons (the token-failure path from the spec). The agent-never-joins path (15 s timeout) is checked on the preview in Task 17.
3. Reload, block the microphone for localhost in the browser, submit again: the microphone message appears with Book and WhatsApp.
4. At 390 px width: no horizontal scroll, the email field and buttons are reachable, the input does not zoom on iOS (font size 1rem).

- [ ] **Step 11: Commit**

```bash
git add index.html call.js call-core.js field.js styles.css vendor/livekit-client-2.22.3.esm.mjs vendor/livekit-client.LICENSE tests/call-page.test.js
git commit -m "Live Aiyaz call card: email step with privacy note, microphone check, captions, booking and WhatsApp on end or failure"
```

---

### Task 13: Voice worker code (no account needed to build and unit-test)

**Files:**
- Modify: `package.json` (dependencies, scripts), `pnpm-workspace.yaml` (only if pnpm blocks a build script), `src/config.ts` (TTS settings), `.env.example`
- Create: `src/voice/brain-llm.ts`, `src/voice/agent.ts`, `scripts/dev-token.ts`
- Test: `tests/brain-llm.test.ts`

**Interfaces:**
- Consumes: `TurnRunner`, `Brain`, `startCallTimer` (Task 8); `Conversation.end` (Task 8); `parseCallMeta`, `AGENT_NAME` (Task 6); `loadBrief`, `kvFromEnv` (Task 6); `forCountry` (Task 1); `buildCallLog`, `storeCall`, `sendSummaryEmail` (Task 9); `SPEND_KEY`, `dayOf` (Task 9).
- Produces: `class BrainLLM extends llm.LLM` (constructor `(brain: Brain)`); worker entry `src/voice/agent.ts`; `Settings` gains `ttsProvider: "elevenlabs" | "cartesia"` and `ttsVoiceId: string`; scripts `voice:dev`, `voice:start`, `voice:token`.

- [ ] **Step 1: Install** (versions from the earlier plan; the spike in Task 14 proves them)

```bash
pnpm add @livekit/agents@1.9.1 @livekit/rtc-node@1.1.0 zod @livekit/agents-plugin-deepgram@1.9.1 @livekit/agents-plugin-silero@1.9.1 @livekit/agents-plugin-elevenlabs@1.9.1 @livekit/agents-plugin-cartesia@1.9.1
pnpm add -D livekit-server-sdk@2.19.1
```
If pnpm prints "Ignored build scripts" for a `@livekit/*` or `onnxruntime-node` package, add that package name with `true` under `allowBuilds:` in `pnpm-workspace.yaml` and run `pnpm install` again.

Add to `package.json` `scripts`:

```json
    "voice:dev": "tsx --env-file-if-exists=.env src/voice/agent.ts dev",
    "voice:start": "tsx src/voice/agent.ts start",
    "voice:token": "tsx --env-file-if-exists=.env scripts/dev-token.ts"
```

- [ ] **Step 2: Write the failing test** `tests/brain-llm.test.ts`

```ts
import { initializeLogger, llm } from "@livekit/agents";
import { describe, expect, it } from "vitest";
import { BrainLLM } from "../src/voice/brain-llm.js";
import type { Brain } from "../src/voice/turns.js";

// LiveKit's logger must exist before any stream runs.
initializeLogger({ pretty: false, level: "warn" });

const fakeBrain = () => {
  const b = {
    calls: [] as string[],
    ended: false,
    async reply(text: string) {
      b.calls.push(text);
      return "Who buys them?";
    },
  };
  return b satisfies Brain;
};

async function collect(stream: llm.LLMStream): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk.delta?.content ?? "";
  return out;
}

describe("BrainLLM", () => {
  it("hands a finished visitor turn to the brain once, even if LiveKit asks twice", async () => {
    const brain = fakeBrain();
    const chatCtx = llm.ChatContext.empty();
    chatCtx.addMessage({ role: "user", content: "We sell shoes." });
    const b = new BrainLLM(brain);
    expect(await collect(b.chat({ chatCtx }))).toBe("Who buys them?");
    expect(await collect(b.chat({ chatCtx }))).toBe("Who buys them?");
    expect(brain.calls).toEqual(["We sell shoes."]);
  });
  it("says nothing and calls nothing on an empty turn", async () => {
    const brain = fakeBrain();
    const chatCtx = llm.ChatContext.empty();
    chatCtx.addMessage({ role: "user", content: "   " });
    expect(await collect(new BrainLLM(brain).chat({ chatCtx }))).toBe("");
    expect(brain.calls).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- brain-llm`
Expected: FAIL with `Cannot find module '../src/voice/brain-llm.js'`.

- [ ] **Step 4: Implement** `src/voice/brain-llm.ts`

```ts
// Plugs the Aiyaz brain into LiveKit in place of an LLM plugin. LiveKit hears, decides when
// the visitor has finished and speaks; the brain decides what to say, once per turn.
import { DEFAULT_API_CONNECT_OPTIONS, llm } from "@livekit/agents";
import { TurnRunner, type Brain } from "./turns.js";

type StreamOpts = ConstructorParameters<typeof llm.LLMStream>[1];

class BrainStream extends llm.LLMStream {
  constructor(
    private readonly turns: TurnRunner,
    owner: llm.LLM,
    opts: StreamOpts,
  ) {
    super(owner, opts);
  }

  protected async run(): Promise<void> {
    const last = [...this.chatCtx.items]
      .reverse()
      .find((i): i is llm.ChatMessage => i.type === "message" && i.role === "user");
    if (!last) return;
    const said = await this.turns.handle(last.id, last.textContent ?? "");
    if (said) this.queue.put({ id: last.id, delta: { role: "assistant", content: said } });
  }
}

export class BrainLLM extends llm.LLM {
  private readonly turns: TurnRunner;

  constructor(brain: Brain) {
    super();
    this.turns = new TurnRunner(brain);
  }

  label(): string {
    return "aiyaz-brain";
  }

  chat({ chatCtx, toolCtx, connOptions = DEFAULT_API_CONNECT_OPTIONS }: Parameters<llm.LLM["chat"]>[0]): llm.LLMStream {
    // maxRetry 0: a LiveKit retry must never become a second reply() for one turn.
    return new BrainStream(this.turns, this, { chatCtx, toolCtx, connOptions: { ...connOptions, maxRetry: 0 } });
  }
}
```

If `tsc` rejects `ConstructorParameters<typeof llm.LLMStream>[1]`, open `node_modules/@livekit/agents/dist/llm/llm.d.ts`, copy the constructor's second parameter type from `LLMStream`, and use it as `StreamOpts`. If `ChatContext.empty()`, `addMessage` or `textContent` have other names in the installed version, use the names exported in `node_modules/@livekit/agents/dist/llm/chat_context.d.ts` in both this file and the test.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- brain-llm`
Expected: PASS.

- [ ] **Step 6: TTS settings.** In `src/config.ts` add to `Settings`:

```ts
  ttsProvider: "elevenlabs" | "cartesia";
  ttsVoiceId: string;
```

and to `loadSettings()`:

```ts
    // Chosen by ear in the voice audition; empty voice id means the provider's default voice.
    ttsProvider: env("AIYAZ_TTS", "elevenlabs") === "cartesia" ? "cartesia" : "elevenlabs",
    ttsVoiceId: env("AIYAZ_TTS_VOICE_ID", ""),
```

Append to `.env.example`:

```
# Voice (LiveKit Cloud, Deepgram, and ElevenLabs or Cartesia)
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
DEEPGRAM_API_KEY=
ELEVEN_API_KEY=
CARTESIA_API_KEY=
AIYAZ_TTS=elevenlabs
AIYAZ_TTS_VOICE_ID=
```

- [ ] **Step 7: Implement** `src/voice/agent.ts`

```ts
// The Aiyaz voice worker: LiveKit hears and speaks, the Conversation decides what to say.
// Local: pnpm voice:dev      Fly.io: pnpm voice:start
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, voice } from "@livekit/agents";
import * as cartesia from "@livekit/agents-plugin-cartesia";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { loadBrief } from "../briefs.js";
import { buildCallLog, sendSummaryEmail, storeCall } from "../calllog.js";
import { forCountry, loadSettings, type Settings } from "../config.js";
import { Conversation } from "../conversation.js";
import { kvFromEnv } from "../kv.js";
import { AnthropicLLM } from "../llm.js";
import { JsonlTracer } from "../tracer.js";
import { BrainLLM } from "./brain-llm.js";
import { AGENT_NAME, parseCallMeta } from "./meta.js";
import { startCallTimer } from "./turns.js";

function makeTts(s: Settings) {
  return s.ttsProvider === "cartesia"
    ? new cartesia.TTS(s.ttsVoiceId ? { voice: s.ttsVoiceId } : {})
    : new elevenlabs.TTS(s.ttsVoiceId ? { voiceId: s.ttsVoiceId } : {});
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const meta = parseCallMeta(ctx.job.metadata);
    const kv = kvFromEnv();
    const brief = await loadBrief(kv, meta.slug);
    const settings = forCountry(loadSettings(), meta.country);
    const startedAt = Date.now();
    const brain = new Conversation({
      settings,
      llm: new AnthropicLLM(settings.requestTimeoutMs),
      tracer: new JsonlTracer(settings.traceFile),
      brief,
    });

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new deepgram.STT({ model: "nova-3" }),
      tts: makeTts(settings),
      llm: new BrainLLM(brain),
      ttsTextTransforms: ["filter_markdown", "filter_emoji"],
      // Off: a speculative run would call the stateful brain before the visitor finished.
      turnHandling: { preemptiveGeneration: { enabled: false } },
    });

    // Spike measurement: from the visitor's final words to Aiyaz starting to speak.
    let heardAt = 0;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal) heardAt = Date.now();
    });

    let closing = false;
    const hangUp = async (line: string) => {
      if (closing) return;
      closing = true;
      if (line) await session.say(line).waitForPlayout();
      ctx.shutdown("call ended");
    };
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === "speaking" && heardAt) {
        console.log(`[latency] ${Date.now() - heardAt} ms`);
        heardAt = 0;
      }
      // Aiyaz has given its summary and called end_conversation: leave once it stops talking.
      if (ev.newState === "listening" && brain.ended) void hangUp("");
    });
    // The 10-minute cap, even if the visitor never speaks.
    const stopTimer = startCallTimer(settings.maxSeconds, () => void hangUp(brain.end("time_limit")));
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => ctx.shutdown("visitor left"));

    let logged = false;
    ctx.addShutdownCallback(async () => {
      stopTimer();
      if (logged) return;
      logged = true;
      const log = buildCallLog({
        id: brain.id,
        startedAt,
        endedAt: Date.now(),
        meta,
        company: brief?.company ?? null,
        endReason: brain.endReason ?? "visitor_left",
        claudeUsd: brain.costUsd,
        notes: brain.notes,
        transcript: brain.transcript,
        voiceUsdPerMinute: settings.voiceUsdPerMinute,
      });
      if (kv) {
        await storeCall(kv, log, { transcriptDays: settings.transcriptDays, reservedUsd: settings.costCapUsd }).catch((err) =>
          console.error(`[call] store failed: ${String(err)}`),
        );
      }
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey && settings.summaryTo) {
        await sendSummaryEmail(log, { apiKey: resendKey, to: settings.summaryTo, from: settings.summaryFrom });
      }
      // Ids and numbers only: transcripts never go to the logs.
      console.log(
        `[call] ${log.id} ${log.endReason} ${log.durationSec}s USD ${log.costUsd.toFixed(3)} country=${log.country ?? "?"} lead=${log.slug ? "yes" : "no"}`,
      );
    });

    await session.start({ agent: new voice.Agent({ instructions: "" }), room: ctx.room });
    // Fixed text from code: the AI disclosure never depends on the model.
    session.say(brain.start());
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
```

Names not yet run end to end (Task 14 runs them): `turnHandling.preemptiveGeneration`, `AgentSessionEventTypes.AgentStateChanged` / `ev.newState`, `session.say(...).waitForPlayout()`, `ctx.shutdown`, `ctx.addShutdownCallback`, `RoomEvent.ParticipantDisconnected` from `@livekit/rtc-node`, and the TTS option names `voice` (Cartesia) and `voiceId` (ElevenLabs). Where `pnpm typecheck` rejects one, open the matching `.d.ts` under `node_modules/@livekit/` and use the exported name; record each change in the Task 14 commit message.

- [ ] **Step 8: Implement** `scripts/dev-token.ts`

```ts
// Mints a 15-minute token that dispatches the local worker, for testing without the site.
//   pnpm voice:token                                      homepage call, unknown country
//   pnpm voice:token '{"country":"IN"}'                   India visitor
//   pnpm voice:token '{"country":"AE","slug":"acme-test"}' lead call (run pnpm briefs --acme-test --write first)
// Paste the url and token into https://agents-playground.livekit.io (manual connect).
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { SPEND_KEY, dayOf } from "../src/calllog.js";
import { loadSettings } from "../src/config.js";
import { kvFromEnv } from "../src/kv.js";
import { AGENT_NAME } from "../src/voice/meta.js";

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error("Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env");
  process.exit(2);
}
const metadata = process.argv[2] ?? "{}";
JSON.parse(metadata); // fail here, not in the worker, on a typo

// Reserve like the site does, so the worker's settle leaves the day's total correct.
const kv = kvFromEnv();
if (kv) await kv.incrByFloat(SPEND_KEY(dayOf(Date.now())), loadSettings().costCapUsd, 2 * 86_400);

const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: `visitor-${randomUUID()}`, ttl: "15m" });
at.addGrant({ roomJoin: true, room: `aiyaz-dev-${randomUUID()}`, canPublish: true, canSubscribe: true, canPublishData: true });
at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata })] });
console.log(`url:   ${LIVEKIT_URL}\ntoken: ${await at.toJwt()}`);
```

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?`
Expected: both `0`.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml src/config.ts src/voice/brain-llm.ts src/voice/agent.ts scripts/dev-token.ts tests/brain-llm.test.ts .env.example
git commit -m "Voice worker: brain behind LiveKit, one reply per turn, 10-minute timer, call log, spend settle and summary email on close"
```

---

### Task 14: Voice spike with pass/fail gates

**Files:**
- Modify: `src/voice/agent.ts` and `src/voice/brain-llm.ts` only if a gate fails on an API name
- Modify: `src/config.ts` (`voiceUsdPerMinute` default, from the measured numbers)

**Interfaces:**
- Consumes: Task 13's worker and `pnpm voice:token`; Task 7's `pnpm briefs --acme-test --write` (needs Upstash; skip the lead-call gate if Upstash is not connected yet and note it).
- Produces: gate results and measured latency in the commit message; confirmed package versions.

- [ ] **Step 1: Stop: needs LiveKit Cloud, Deepgram and one TTS account (ElevenLabs or Cartesia).** Ask Imran for these values in `.env` (he pastes them; never echo them back): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, and `ELEVEN_API_KEY` (with `AIYAZ_TTS=elevenlabs`) or `CARTESIA_API_KEY` (with `AIYAZ_TTS=cartesia`). Optional for the lead-call gate: `KV_REST_API_URL`, `KV_REST_API_TOKEN`. Do not continue until they are set.

- [ ] **Step 2: Download model files and start the worker**

Run: `pnpm exec tsx src/voice/agent.ts download-files; echo $?` (if the command is unknown in this version, skip it: Silero ships its model in the npm package), then `AIYAZ_MAX_SECONDS=120 pnpm voice:dev`.
Expected: the worker logs that it registered with LiveKit as agent `aiyaz`.

- [ ] **Step 3: Homepage call, India visitor.** In a second terminal: `pnpm voice:token '{"country":"IN"}'`; paste url and token into agents-playground.livekit.io (manual connect). Talk for three turns, ask the price once, interrupt Aiyaz once mid-sentence, then stay silent for 20 seconds.

- [ ] **Step 4: Lead call** (if Upstash is connected): `pnpm briefs --acme-test --write`, then `pnpm voice:token '{"country":"AE","slug":"acme-test"}'`, connect, answer the opener, then close the playground tab mid-call.

- [ ] **Step 5: Time cap.** Connect once more and say nothing for 2 minutes (the worker runs with `AIYAZ_MAX_SECONDS=120`).

- [ ] **Step 6: Check the gates** (write each result in the commit message):
- **G1** The opener is spoken word for word and starts "I'm Aiyaz, an AI agent from getaiengineer.dev." Lead call: it asks about the Acme fact as a question.
- **G2** Price: in the India call, Aiyaz's caption text says "USD 6,000" (or "$6,000") when asked, and never AED.
- **G3** `reply()` once per turn: the number of `"role":"conversation"` lines added to `traces.jsonl` per call equals the visitor turns, plus at most one extra per turn where the reply had no question.
- **G4** Latency: median of the `[latency]` lines. Spec target about 1,500 ms. If the median is over 1,500 ms, stop and report the numbers to Imran with the two options measured: `AIYAZ_CONVERSATION_MODEL=claude-haiku-4-5` (one more run), and keeping Sonnet. Do not change the default model without his answer.
- **G5** Interruption: Aiyaz stops speaking within about half a second, and the next turn is answered once.
- **G6** Silence: 20 seconds of silence adds no `conversation` trace line and no speech.
- **G7** Tab closed early: the worker logs `[call] <id> visitor_left ...`, with no transcript text in the log.
- **G8** Time cap: after 120 s of silence Aiyaz says "We're at our time limit, so I'll stop here. The team will follow up with a summary." and leaves the room.

- [ ] **Step 7: Measure voice cost.** From the Deepgram and TTS dashboards, divide today's usage cost by the call minutes from the `[call]` lines. Set the `AIYAZ_VOICE_USD_PER_MIN` default in `src/config.ts` to that number rounded up to two decimals.

- [ ] **Step 8: Optional, one account fewer.** Repeat Step 3 with LiveKit Inference (`new inference.STT({ model: "deepgram/nova-3" })`, `new inference.TTS({ model: "cartesia/sonic-3" })`, `inference` imported from `@livekit/agents`). If it works, report to Imran that the separate Deepgram account may not be needed; do not switch without his answer.

- [ ] **Step 9: Run tests and typecheck, then commit**

Run: `pnpm test; echo $?` then `pnpm typecheck; echo $?` (both `0`).

```bash
git add src/voice src/config.ts package.json pnpm-lock.yaml
git commit -m "Voice spike: G1-G8 <results>; latency median <n> ms; voice USD <n>/min; versions <as installed>"
```

---

### Task 15: Voice audition

**Files:**
- Create: `scripts/audition.ts`
- Modify: `package.json` (script `voice:audition`), `.env.example` (chosen `AIYAZ_TTS`, `AIYAZ_TTS_VOICE_ID`)

**Interfaces:**
- Consumes: `openingLine`, `formatPrice` (`src/prompt.ts`), `forCountry`, `loadSettings` (`src/config.ts`), `WRAP_UP` (`src/conversation.ts`).
- Produces: `auditions/<provider>-<n>.mp3` (gitignored in Task 6); Imran's choice as `AIYAZ_TTS` and `AIYAZ_TTS_VOICE_ID`.

- [ ] **Step 1: Stop: needs ElevenLabs and Cartesia accounts** (both, to compare). Env: `ELEVEN_API_KEY`, `CARTESIA_API_KEY`. Optional starting voices: `AUDITION_ELEVEN_VOICE_ID`, `AUDITION_CARTESIA_VOICE_ID`. If Imran has only one, run the script with that one and say so.

- [ ] **Step 2: Implement** `scripts/audition.ts`

```ts
// Renders the same Aiyaz lines in each candidate voice so Imran can compare by ear.
// Calls each provider's HTTP API directly, so it does not need LiveKit.
import { mkdirSync, writeFileSync } from "node:fs";
import { forCountry, loadSettings } from "../src/config.js";
import { WRAP_UP } from "../src/conversation.js";
import { formatPrice, openingLine } from "../src/prompt.js";

const base = loadSettings();
const LINES = [
  openingLine(base, null),
  "Got it. When the assistant gives a wrong answer, what does your customer do next?",
  "My guess is the model is answering from memory instead of your own data. Does that match what you see?",
  `The sprint is a fixed price of ${formatPrice(forCountry(base, "AE").sprintPrice)}.`,
  `The sprint is a fixed price of ${formatPrice(forCountry(base, "IN").sprintPrice)}.`,
  WRAP_UP.time_limit,
];

type Voice = { name: string; ready: boolean; render: (text: string) => Promise<ArrayBuffer> };

const voices: Voice[] = [
  {
    name: "elevenlabs",
    ready: Boolean(process.env.ELEVEN_API_KEY),
    render: async (text) => {
      const id = process.env.AUDITION_ELEVEN_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
        method: "POST",
        headers: { "xi-api-key": process.env.ELEVEN_API_KEY ?? "", "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
      });
      if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${await res.text()}`);
      return res.arrayBuffer();
    },
  },
  {
    name: "cartesia",
    ready: Boolean(process.env.CARTESIA_API_KEY),
    render: async (text) => {
      const res = await fetch("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
          "X-API-Key": process.env.CARTESIA_API_KEY ?? "",
          "Cartesia-Version": "2024-11-13",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model_id: "sonic-2",
          transcript: text,
          voice: { mode: "id", id: process.env.AUDITION_CARTESIA_VOICE_ID ?? "a0e99841-438c-4a64-b679-ae501e7d6091" },
          output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
        }),
      });
      if (!res.ok) throw new Error(`cartesia ${res.status}: ${await res.text()}`);
      return res.arrayBuffer();
    },
  },
];

mkdirSync("auditions", { recursive: true });
for (const v of voices.filter((x) => x.ready)) {
  for (const [i, line] of LINES.entries()) {
    try {
      writeFileSync(`auditions/${v.name}-${i + 1}.mp3`, Buffer.from(await v.render(line)));
      console.log(`wrote auditions/${v.name}-${i + 1}.mp3`);
    } catch (err) {
      console.error(String(err));
    }
  }
}
```

Add `"voice:audition": "tsx --env-file-if-exists=.env scripts/audition.ts"` to `package.json` `scripts`.

- [ ] **Step 3: Typecheck and run**

Run: `pnpm typecheck; echo $?` then `pnpm voice:audition`
Expected: `0`, then 6 files per provider in `auditions/`. A 4xx prints the provider's message; check the model id and API version header against the provider's current docs and rerun. Listen for: "Aiyaz" sounds like "Eye-yaaz"; "getaiengineer.dev" is clear; "AED 25,000" and "USD 6,000" are read as amounts. If the name is wrong, rerun that provider with "Ayaz" in line 1 and tell Imran.

- [ ] **Step 4: Imran listens and picks** a provider and voice id. Write them into `.env` and as documented values in `.env.example` (`AIYAZ_TTS=<provider>`, `AIYAZ_TTS_VOICE_ID=<id>`). Restart `pnpm voice:dev` and repeat Task 14 Step 3 once with the chosen voice.

- [ ] **Step 5: Commit**

```bash
git add scripts/audition.ts package.json .env.example
git commit -m "Voice audition script; <provider>/<voice> chosen by Imran"
```

---

### Task 16: Live summary email, transcript store and limits

**Files:**
- Modify: `README.md` (voice section)

**Interfaces:**
- Consumes: Task 13's worker; Task 9's call log; Task 11's token function (run on a Vercel preview in Task 17, or reserve with `pnpm voice:token` here).
- Produces: a checked end-to-end close path.

- [ ] **Step 1: Stop: needs Resend, with getaiengineer.dev verified as a sending domain, and Upstash connected to the getaiengineer Vercel project.** Env in `.env`: `RESEND_API_KEY`, `AIYAZ_SUMMARY_TO`, optional `AIYAZ_SUMMARY_FROM`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`. Check the Upstash values exist on Vercel too: in the site worktree run `npx vercel@latest env ls`; expected `KV_REST_API_URL` and `KV_REST_API_TOKEN` listed for Preview and Production.

- [ ] **Step 2: Lead call, closed early.** `pnpm briefs --acme-test --write`; `pnpm voice:dev`; `pnpm voice:token '{"country":"AE","slug":"acme-test","email":"you@example.com"}'`; connect, confirm the Acme fact, answer one question, close the tab.
Expected within a minute: an email to `AIYAZ_SUMMARY_TO` with subject "Aiyaz call with Acme (AE, <n> min)", body with the visitor email, "Confirmed: launched an AI assistant that answers customer questions on WhatsApp", the transcript, and reply-to set to `you@example.com`.

- [ ] **Step 3: Stored for 30 days, spend settled.** With the call id from the `[call]` log line:

```bash
curl -s -H "Authorization: Bearer $KV_REST_API_TOKEN" "$KV_REST_API_URL/ttl/aiyaz:call:<id>"
curl -s -H "Authorization: Bearer $KV_REST_API_TOKEN" "$KV_REST_API_URL/get/aiyaz:spend:$(date -u +%F)"
```
Expected: TTL between 2,591,000 and 2,592,000; the spend value equals the sum of this session's call costs (each dev token reserved 1 and each close settled it).

- [ ] **Step 4: Homepage call that Aiyaz ends.** `pnpm voice:token '{"country":"IN","email":"you@example.com"}'`; talk until Aiyaz gives its summary. Expected: Aiyaz leaves after speaking, one email arrives with "(IN, ...)" in the subject, and the log line shows `agent_ended`.

- [ ] **Step 5: README.** Add a "Voice" section to `README.md`:

~~~markdown
## Voice

The live call on getaiengineer.dev runs on this repo's worker (`src/voice/agent.ts`) on Fly.io.
LiveKit carries the call, Deepgram hears, ElevenLabs or Cartesia speaks, and `Conversation` decides
what to say, once per finished turn. The site's `/api/aiyaz-token` decides who may call.

```sh
pnpm voice:dev                                  # run the worker locally
pnpm voice:token '{"country":"IN"}'             # token for agents-playground.livekit.io
pnpm briefs                                     # dry run: lead briefs from the private tracker
pnpm voice:audition                             # render candidate voices to auditions/
```

Env vars: see `.env.example`. Lead briefs live only in Upstash (`aiyaz:brief:<slug>`), never in
this repo. Transcripts are kept 30 days (`aiyaz:call:<id>`) and never logged.
~~~

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "README: how the voice worker, tokens, briefs and auditions fit together"
```

---

### Task 17: Deploy the worker to Fly.io, preview, go live

**Files (aiyaz):**
- Create: `Dockerfile`, `fly.toml`, `.dockerignore`

**Interfaces:**
- Consumes: everything above. Site branch `aiyaz-live-voice` (Tasks 10 to 12).
- Produces: a running worker `aiyaz-voice` on Fly.io; the site preview and, after Imran's yes, production.

- [ ] **Step 1: Stop: needs a Fly.io account.** Imran runs `fly auth login` himself. Secrets needed (Step 4): `ANTHROPIC_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `ELEVEN_API_KEY` or `CARTESIA_API_KEY`, `AIYAZ_TTS`, `AIYAZ_TTS_VOICE_ID`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `RESEND_API_KEY`, `AIYAZ_SUMMARY_TO`.

- [ ] **Step 2: Container files**

`Dockerfile`:

```dockerfile
FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY prompts ./prompts
COPY tsconfig.json ./
RUN pnpm exec tsx src/voice/agent.ts download-files || true
CMD ["pnpm", "voice:start"]
```

`.dockerignore`:

```
node_modules
.env
.env.*
*.jsonl
auditions
evals
tests
docs
.claude
```

`fly.toml` (no public HTTP service: the worker dials out to LiveKit; long kill timeout so calls drain on deploy; Mumbai is the closest Fly region to both India and the UAE):

```toml
app = "aiyaz-voice"
primary_region = "bom"
kill_timeout = 600

[[vm]]
  memory = "2gb"
  cpus = 2
```

- [ ] **Step 3: Build locally**

Run: `docker build -t aiyaz-voice .; echo $?`
Expected: `0`.

- [ ] **Step 4: Deploy the worker** (ask Imran before `fly deploy`; it runs a public service that spends money)

```bash
fly launch --no-deploy --copy-config --name aiyaz-voice
fly secrets set ANTHROPIC_API_KEY=... LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... DEEPGRAM_API_KEY=... ELEVEN_API_KEY=... AIYAZ_TTS=... AIYAZ_TTS_VOICE_ID=... KV_REST_API_URL=... KV_REST_API_TOKEN=... RESEND_API_KEY=... AIYAZ_SUMMARY_TO=...
fly deploy
fly logs
```
Expected: the worker registers with LiveKit as `aiyaz`. Stop `pnpm voice:dev` locally first, or two workers will take calls.

- [ ] **Step 5: Commit the worker files**

```bash
git add Dockerfile fly.toml .dockerignore
git commit -m "Deploy the Aiyaz voice worker to Fly.io (Mumbai, no public port)"
```

- [ ] **Step 6: Site preview (workflow step 3 and 4 gates: ask Imran before pushing).** Set on Vercel for Preview: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (`npx vercel@latest env add <NAME> preview`). With Imran's yes, push branch `aiyaz-live-voice` from the site worktree and open its preview URL.

- [ ] **Step 7: Preview checks** (pass/fail, written down for Imran):
- `GET <preview>/node_modules/livekit-server-sdk/package.json` returns 404, and `<preview>/tests/price.test.js` returns 404.
- Homepage call from India: hero and price card show `$6,000`; Aiyaz says USD 6,000 when asked. Ideally someone in the UAE checks AED 25,000 on both.
- Lead call `<preview>/?ref=acme-test`: the card says "Talk to Aiyaz about Acme", no email asked, the opener asks about the Acme fact.
- Fourth call from the same email in one day: the card shows the limit message with Book and WhatsApp.
- Microphone blocked: the agreed microphone message with Book and WhatsApp.
- Worker down: `fly scale count 0`, start a call; within about 15 s the card shows "The call could not start..." with Book and WhatsApp. Then `fly scale count 1`.
- Interrupt once, stay silent 20 s, close the tab mid-call: each behaves as in Task 14; the summary email still arrives.
- Phone (390 px) works as well as the laptop.

- [ ] **Step 8: Go live (workflow steps 4 to 8, each gate is Imran's call).** Set the three `LIVEKIT_*` variables for Production too. Ask Imran to open and merge the site PR, then the aiyaz PR. After the deploy lands, verify on https://getaiengineer.dev, checking the change last: the old "Play example" text is gone and "Talk to Aiyaz" is present; from India the price reads `$6,000`. Then bring both main checkouts up to date, and only then remove the two worktrees after checking that nothing is uncommitted and every commit is on the main line.

---

## Open questions for Imran (found while planning; the plan does not block on them)

1. **Visitor summary.** The privacy note says "We use your email to send you a summary of this call", but the spec only emails the team. This plan emails the team with reply-to set to the visitor, so the team can forward or answer. Should Resend also send the visitor a short summary?
2. **Email on lead calls.** The spec says Aiyaz asks for an email at the end of a lead call, but spoken email addresses transcribe badly and nothing captures one. This plan does not ask, and the team follows up through the known lead contact. Alternative: an optional email field on the end panel.
3. **What the USD 5 cap counts.** It counts Claude tokens plus a per-minute voice estimate (`AIYAZ_VOICE_USD_PER_MIN`, measured in Task 14). LiveKit minutes are not counted (free plan). The per-call USD 1 cap stops Claude spend only.
4. **Transcripts outside the 30 days.** The summary email contains the transcript, so it lives in the team inbox beyond 30 days. Remove the transcript from the email, or accept it?
5. **Latency target.** Measured 2.1 s median per Sonnet call (2026-09-30) is already above the spec's 1.5 s round trip before speech-to-text and voice are added. Task 14 measures and reports; the likely choice is Haiku for voice or accepting about 2.5 s.
6. **Prompt v2 was UAE-only.** It said "a company in the UAE" and had a "UAE market" heading, which an India visitor would hear. This plan adds v3 with the market taken from the pack; v2 stays for history.
7. **Brief facts with money.** Real tracker facts include funding amounts. They are dropped, so some leads may have fewer facts or fall back to a homepage call.
8. **Site deploy settings.** `.vercelignore` currently hides `package.json`; the edge function needs it deployed. Task 11 removes that line and Task 17 checks nothing extra becomes public.
9. **`?ref=` is shared** with the pending `tracking` branch, which counts visits by the same tag. Slugs fit its 40-character rule; whichever branch merges second resolves `index.html` and `package.json` by hand.
10. **Build order differs from the spec.** The spec puts the voice spike before the call page. This plan builds everything that needs no new account first (country settings, guard, packs, briefs, summary, token function, page), then the spike. The page's LiveKit calls are proven only in Task 17's preview, after the spike has proven the worker side.
