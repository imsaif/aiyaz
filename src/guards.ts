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

// Finds money amounts in any currency Aiyaz might plausibly write.
const MONEY =
  /(?:(?:\$|US\$|USD|AED|EUR|GBP|INR|Rs\.?|€|£|₹)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|m|M)\b)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:k|K)?\s?(?:dollars|usd|aed|euros|pounds|rupees|dirhams)\b)/gi;

export function moneyAmounts(text: string): string[] {
  return text.match(MONEY) ?? [];
}

// True when every money amount in the text is the sprint price.
export function onlySprintPrice(text: string, sprintPriceUsd: number): boolean {
  return moneyAmounts(text).every((m) => {
    const otherCurrency = /\b(?:AED|EUR|GBP|INR)\b|\bRs\.?(?=\s?\d)|€|£|₹|euros|pounds|rupees|dirhams/i;
    const isUsd = /\$|\bUSD\b|dollars/i.test(m) && !otherCurrency.test(m);
    const hasSuffix = /\d\s?(?:k|K|m|M)\b/.test(m);
    const value = Number((m.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
    return isUsd && !hasSuffix && value === sprintPriceUsd;
  });
}
