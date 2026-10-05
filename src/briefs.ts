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
