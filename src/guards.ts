// Checks shared by the live conversation and the evals.

import type { Currency, SprintPrice } from "./config.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Replaces any forbidden name (e.g. "Imran", "Imran's") with "the team".
export function scrubForbiddenNames(text: string, names: string[]): string {
  let out = text;
  for (const name of names) {
    out = out.replace(new RegExp(`\\b${escape(name)}(?:'s|’s)?\\b`, "gi"), "the team");
  }
  return out;
}

// True when the first turn says it is an AI agent before anything else: either it
// opens with the disclosure, or only a "Hi <company>, " greeting comes first.
// A company name may end in a full stop ("Acme Inc."), so sentences are not split on it.
export function disclosesAtOpening(first: string, agentName: string): boolean {
  const line = `I'm ${agentName}, an AI agent from getaiengineer.dev.`;
  const at = first.indexOf(line);
  if (at < 0) return false;
  const before = first.slice(0, at);
  return before === "" || (/^Hi [^?!]{1,80}, $/.test(before) && !before.includes(". "));
}

export function mentionsForbiddenName(text: string, names: string[]): boolean {
  return names.some((n) => new RegExp(`\\b${escape(n)}\\b`, "i").test(text));
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// Arabic-Indic digits and separators become Latin, so one parser handles both.
export function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}

// Finds money amounts in any currency Aiyaz might plausibly write, in English or Arabic.
const AR_CURRENCY = "درهم|دراهم|دولار|روبية|يورو|جنيه";
const MONEY = new RegExp(
  [
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:thousand|hundred|million)\s?(?:US\s?)?(?:dollars|usd|aed|dirhams?)\b)`,
    String.raw`(?:(?:\$|US\$|USD|AED|Dhs?\.?|EUR|GBP|INR|Rs\.?|€|£|₹)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|m|M)\b)?)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:k|K)?\s?(?:US\s?)?(?:dollars|usd|aed|euros|pounds|rupees|dirhams?)\b)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:(?:[أا]لف|آلاف)\s?)?(?:${AR_CURRENCY}))`,
    String.raw`(?:(?:${AR_CURRENCY})\s?\d[\d,]*(?:\.\d+)?)`,
  ].join("|"),
  "gi",
);

// An amount written in words ("seven thousand dollars", "ثمانية آلاف درهم") has no digits to check.
const WORDED_AMOUNT = new RegExp(String.raw`(?:thousand|hundred|million|[أا]لف|آلاف|مية|مليون)\s+(?:US\s?)?(?:dollars|dirhams?|${AR_CURRENCY})`, "i");

const WORDED_AMOUNT_ALL = new RegExp(WORDED_AMOUNT.source, "gi");

export function moneyAmounts(text: string): string[] {
  return toLatinDigits(text).match(MONEY) ?? [];
}

const CURRENCY_OF: [Currency, RegExp][] = [
  ["AED", /AED|Dhs?|dirham|درهم|دراهم/i],
  ["USD", /\$|USD|\bUS\b|dollars|دولار/i],
];
const OTHER_CURRENCY = /EUR|GBP|INR|\bRs\b\.?|€|£|₹|euros|pounds|rupees|روبية|يورو|جنيه/i;

// True when every money amount in the text is the visitor's own sprint price, in its own currency.
export function onlySprintPrice(text: string, price: SprintPrice): boolean {
  // Every worded amount must follow a digit ("6 thousand dollars"); one spelled out fully in words fails.
  for (const w of text.matchAll(WORDED_AMOUNT_ALL)) {
    if (!/\d\s*$/.test(toLatinDigits(text.slice(0, w.index)))) return false;
  }
  return moneyAmounts(text).every((m) => {
    const currencies = CURRENCY_OF.filter(([, re]) => re.test(m)).map(([c]) => c);
    const hasSuffix = /\d\s?(?:k|K|m|M)\b/.test(m);
    let value = Number((m.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
    if (/thousand|[أا]لف|آلاف/i.test(m)) value *= 1000;
    else if (/hundred/i.test(m)) value *= 100;
    else if (/million/i.test(m)) value *= 1_000_000;
    return (
      currencies.length === 1 &&
      currencies[0] === price.currency &&
      !OTHER_CURRENCY.test(m) &&
      !hasSuffix &&
      value === price.amount
    );
  });
}
