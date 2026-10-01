// Checks shared by the live conversation and the evals.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Replaces any forbidden name (e.g. "Imran", "Imran's") with "the team".
export function scrubForbiddenNames(text: string, names: string[]): string {
  let out = text;
  for (const name of names) {
    out = out.replace(new RegExp(`\\b${escape(name)}(?:'s|’s)?\\b`, "gi"), "the team");
  }
  return out;
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
    String.raw`(?:(?:\$|US\$|USD|AED|Dhs?\.?|EUR|GBP|INR|Rs\.?|€|£|₹)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|m|M)\b)?)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:k|K)?\s?(?:US\s?)?(?:dollars|usd|aed|euros|pounds|rupees|dirhams?)\b)`,
    String.raw`(?:\d[\d,]*(?:\.\d+)?\s?(?:(?:[أا]لف|آلاف)\s?)?(?:${AR_CURRENCY}))`,
    String.raw`(?:(?:${AR_CURRENCY})\s?\d[\d,]*(?:\.\d+)?)`,
  ].join("|"),
  "gi",
);

// An amount written in words ("seven thousand dollars", "ثمانية آلاف درهم") has no digits to check.
const WORDED_AMOUNT = new RegExp(String.raw`(?:thousand|hundred|million|[أا]لف|آلاف|مية|مليون)\s+(?:US\s?)?(?:dollars|dirhams?|${AR_CURRENCY})`, "i");

export function moneyAmounts(text: string): string[] {
  return toLatinDigits(text).match(MONEY) ?? [];
}

// True when every money amount in the text is the sprint price, in its own currency.
export function onlySprintPrice(text: string, price: { amount: number; currency: "AED" }): boolean {
  if (WORDED_AMOUNT.test(text) && !/\d/.test(text.match(WORDED_AMOUNT)?.[0] ?? "")) {
    // Allow only the price itself written as "25 ألف درهم"; any amount spelled out in words fails.
    const before = text.slice(0, text.search(WORDED_AMOUNT));
    if (!/\d\s*$/.test(toLatinDigits(before))) return false;
  }
  return moneyAmounts(text).every((m) => {
    const isAed = /AED|Dhs?|dirham|درهم|دراهم/i.test(m);
    const other = /\$|USD|\bUS\b|dollars|EUR|GBP|INR|Rs\.?|€|£|₹|euros|pounds|rupees|دولار|روبية|يورو|جنيه/i.test(m);
    const hasSuffix = /\d\s?(?:k|K|m|M)\b/.test(m);
    let value = Number((m.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
    if (/[أا]لف|آلاف/.test(m)) value *= 1000;
    return isAed && !other && !hasSuffix && value === price.amount;
  });
}
