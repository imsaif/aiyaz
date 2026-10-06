// The token function on the site puts { country, slug?, email?, day, reservedUsd, board } in the
// dispatch metadata: day and reservedUsd say which spend key it reserved on, and how much.
// Everything is checked again here: the worker trusts nothing it did not parse.
import { isBoardId } from "../board.js";
import { isValidSlug } from "../briefs.js";
import { normCountry } from "../config.js";

export const AGENT_NAME = "aiyaz";

export type CallMeta = {
  country: string | null;
  slug: string | null;
  email: string | null;
  day: string | null;
  reservedUsd: number | null;
  board: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

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
    day: DAY.test(str(o.day)) ? str(o.day) : null,
    reservedUsd: typeof o.reservedUsd === "number" && Number.isFinite(o.reservedUsd) && o.reservedUsd >= 0 ? o.reservedUsd : null,
    board: isBoardId(o.board) ? o.board : null,
  };
}
