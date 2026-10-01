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
