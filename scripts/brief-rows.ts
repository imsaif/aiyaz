// Turns the lead tracker's "Aiyaz brief facts" cells into briefs for Upstash.
// The tracker and its contents are private and never enter this repo; only this parsing code does.
import { randomBytes } from "node:crypto";
import { BRIEF_KEY, isValidSlug, toBrief, usableFact } from "../src/briefs.js";
import type { KV } from "../src/kv.js";
import type { Brief, BriefFact } from "../src/notes.js";

export type LeadRow = { company: string; facts: string };
export type PlannedBrief = { company: string; slug: string; isNew: boolean; brief: Brief | null; dropped: string[]; skipped?: string };

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

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

export async function planBriefs(
  rows: LeadRow[],
  kv: KV,
  rand?: (n: number) => Uint8Array,
): Promise<PlannedBrief[]> {
  // Companies that share a key must never share a slug, or one lead's brief would sit at another's link.
  const namesByKey = new Map<string, string[]>();
  for (const row of rows) {
    const key = companyKey(row.company);
    const names = namesByKey.get(key) ?? [];
    if (!names.some((n) => sameName(n, row.company))) names.push(row.company);
    namesByKey.set(key, names);
  }
  const out: PlannedBrief[] = [];
  for (const row of rows) {
    const { facts, dropped } = parseFactsCell(row.facts);
    const key = companyKey(row.company);
    const skip = (reason: string): PlannedBrief => ({
      company: row.company,
      slug: "",
      isNew: false,
      brief: null,
      dropped,
      skipped: reason,
    });
    if ((namesByKey.get(key)?.length ?? 0) > 1) {
      out.push(skip("skipped: another company in this batch has the same key, rename one in the tracker"));
      continue;
    }
    const stored = await kv.get(SLUG_FOR_KEY(key));
    const existing = stored && isValidSlug(stored) ? stored : null;
    if (existing) {
      const raw = await kv.get(BRIEF_KEY(existing));
      let owner: string | null = null;
      if (raw) {
        try {
          owner = (JSON.parse(raw) as { company?: string }).company ?? "";
        } catch {
          owner = "";
        }
      }
      if (owner !== null && !sameName(owner, row.company)) {
        out.push(skip("skipped: the stored slug for this key holds a brief for another company"));
        continue;
      }
    }
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
    await kv.set(BRIEF_KEY(p.slug), JSON.stringify(p.brief));
    await kv.set(SLUG_FOR_KEY(companyKey(p.company)), p.slug);
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
