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
