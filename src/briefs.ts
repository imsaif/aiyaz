// Lead briefs are private client material. They live only in the site's Upstash store
// under aiyaz:brief:<slug>, written by `pnpm briefs` from the private lead tracker.
// Nothing here reads files. A bad or missing brief makes the call a homepage call.
import { moneyAmounts } from "./guards.js";
import type { KV } from "./kv.js";
import { STAGES, type Brief, type BriefCards, type BriefEvidence, type BriefFact, type BriefFile } from "./notes.js";

export const BRIEF_KEY = (slug: string) => `aiyaz:brief:${slug}`;

// At most 40 characters: it also travels as the site's ?ref= tracking tag.
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const isValidSlug = (slug: string) => SLUG.test(slug);

const MAX_FACTS = 8;
const MAX_FACT_CHARS = 300;
const MAX_COMPANY_CHARS = 80;
// Money with no currency sign: "12M", "5k", "50 crore", "two billion", "seven figures".
// Broad on purpose: a false positive ("12M users") only drops a fact.
const BARE_SUFFIX = /\d[\d.,]*\s?(?:k|m|mn|b|bn|cr|million|billion|crore|lakh)s?\b/i;
const BIG_WORD = /\b(?:million|billion|trillion|crore|lakh)s?\b/i;
const FIGURES = /\b(?:\w+)[\s-]figures?\b/i;
const WORDED_BIG_NUMBER = new RegExp(`${BARE_SUFFIX.source}|${BIG_WORD.source}|${FIGURES.source}`, "i");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// A fact needs a source, and must carry no money figure: the opener is spoken by code,
// so a funding amount in the first fact would be said word for word.
export function usableFact(f: unknown): f is BriefFact {
  if (!isObj(f) || typeof f.text !== "string" || typeof f.source !== "string") return false;
  const text = f.text.trim();
  if (!text || !f.source.trim() || text.length > MAX_FACT_CHARS) return false;
  return moneyAmounts(text).length === 0 && !WORDED_BIG_NUMBER.test(text);
}

const MAX_CARD_CHARS = 200;
// A prefilled card is shown on the page and read back on the call, so it follows the fact rules
// (no money). Stage must be one the model itself could record.
function toCards(v: unknown): BriefCards | undefined {
  if (!isObj(v)) return undefined;
  const out: BriefCards = {};
  for (const k of ["aiFeature", "users", "stage"] as const) {
    const t = typeof v[k] === "string" ? (v[k] as string).trim() : "";
    if (!t || t.length > MAX_CARD_CHARS || moneyAmounts(t).length || WORDED_BIG_NUMBER.test(t)) continue;
    if (k === "stage" && !(STAGES as readonly string[]).includes(t.toLowerCase())) continue;
    out[k] = k === "stage" ? t.toLowerCase() : t;
  }
  return Object.keys(out).length ? out : undefined;
}

// Evidence lives on the site under /e/<slug>/<file>; nothing else is accepted, so a brief can never
// point the page at another site. Captions are read aloud, so they follow the fact rules (no money).
const EVIDENCE_PATH = /^\/e\/[a-z0-9-]{1,40}\/[A-Za-z0-9._-]{1,80}$/;
const MAX_EVIDENCE = 4;
const okCaption = (t: unknown): t is string =>
  typeof t === "string" && t.trim().length > 0 && t.trim().length <= MAX_FACT_CHARS && !moneyAmounts(t).length && !WORDED_BIG_NUMBER.test(t);

function toEvidence(v: unknown): BriefEvidence[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((e): e is Record<string, unknown> => isObj(e) && typeof e.src === "string" && EVIDENCE_PATH.test(e.src) && okCaption(e.caption))
    .map((e) => ({ src: e.src as string, caption: (e.caption as string).trim() }))
    .slice(0, MAX_EVIDENCE);
  return out.length ? out : undefined;
}

function toFile(v: unknown): BriefFile | undefined {
  if (!isObj(v) || typeof v.href !== "string" || !EVIDENCE_PATH.test(v.href) || !okCaption(v.label)) return undefined;
  return { href: v.href, label: (v.label as string).trim() };
}

export function toBrief(v: unknown): Brief | null {
  if (!isObj(v) || typeof v.company !== "string" || !Array.isArray(v.facts)) return null;
  const company = v.company.trim();
  if (!company || company.length > MAX_COMPANY_CHARS) return null;
  const facts = v.facts
    .filter(usableFact)
    .map((f): BriefFact => ({ text: f.text.trim(), source: f.source.trim(), ...(f.kind === "finding" ? { kind: "finding" } : {}) }))
    .slice(0, MAX_FACTS);
  const cards = toCards(v.cards);
  const evidence = toEvidence(v.evidence);
  const file = toFile(v.file);
  if (!facts.length) return null;
  return { company, facts, ...(cards ? { cards } : {}), ...(evidence ? { evidence } : {}), ...(file ? { file } : {}) };
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
