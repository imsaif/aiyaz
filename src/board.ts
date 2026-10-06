// The brief board: what the visitor watches build up during a call, saved at a private link.
// Built only from notes and known facts, so the visitor's name, role and email never reach it.
// Twin of board-core.js in the getaiengineer repo: same card keys, same edit rules, same edit table.
import { isValidSlug } from "./briefs.js";
import type { KV } from "./kv.js";
import { emptyNotes, type Brief, type Notes } from "./notes.js";

export const CARD_KEYS = ["company", "aiFeature", "users", "stage", "owner", "blockers", "tried"] as const;
export type CardKey = (typeof CARD_KEYS)[number];
type ListCard = "blockers" | "tried";
type TextCard = Exclude<CardKey, ListCard>;
const TEXT_CARDS: readonly string[] = ["company", "aiFeature", "users", "stage", "owner"];

export const CARD_LABELS: Record<CardKey, string> = {
  company: "Company",
  aiFeature: "What AI should do",
  users: "Who it's for",
  stage: "Stage",
  owner: "Who owns it",
  blockers: "What's blocking it",
  tried: "What they've tried",
};

export const MAX_CARD_CHARS = 200;
const MAX_FACT_CHARS = 300;
const MAX_LIST_ITEMS = 20;
const MAX_EDIT_PAYLOAD = 2000;
export const BOARD_DAYS = 30;
export const BOARD_ID = /^[A-Za-z0-9_-]{22}$/;
const FACT_ID = /^[bf]\d{1,2}$/;
export const isBoardId = (id: unknown): id is string => typeof id === "string" && BOARD_ID.test(id);
export const BOARD_KEY = (id: string) => `aiyaz:board:${id}`;
export const boardUrl = (siteUrl: string, id: string) => `${siteUrl.replace(/\/+$/, "")}/aiyaz/b/${id}`;

export type FactKind = "brief" | "found";
export type KnownFact = { id: string; text: string; source: string; kind: FactKind };
export type BoardFact = KnownFact & { status: "to_confirm" | "confirmed" };
export type BoardCards = {
  company: string | null;
  aiFeature: string | null;
  users: string | null;
  stage: string | null;
  owner: string | null;
  blockers: string[];
  tried: string[];
};
export type Board = {
  company: string | null;
  slug: string | null;
  cards: BoardCards;
  facts: BoardFact[];
  researching: boolean;
  researched: boolean;
  updatedAt: string;
};
export type BoardExtra = { slug: string | null; researching?: boolean; researched?: boolean };
export type Edit = { card: string; value: string };
// note: one line describing the edit for the model, values quoted as JSON strings.
export type EditResult = { notes: Notes; known: KnownFact[]; note: string };
export type SavedStart = { notes: Notes; known: KnownFact[]; researched: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clip = (s: string) => cleanValue(s) ?? "";
const clipOrNull = (s: string | null) => (s ? clip(s) || null : null);

// Plain text only: control characters become spaces, < and > go (so no value can close a
// marked block in the prompt), whitespace collapses, at most 200 characters.
export function cleanValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const text = v
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Cut by whole characters so an emoji is never split into a lone surrogate.
  return Array.from(text).slice(0, MAX_CARD_CHARS).join("").trim();
}

export function knownFromBrief(brief: Brief | null): KnownFact[] {
  return (brief?.facts ?? []).map((f, i) => ({ id: `b${i + 1}`, text: f.text, source: f.source, kind: "brief" }));
}

export function boardFromNotes(notes: Notes, known: KnownFact[], now: number, extra: BoardExtra): Board {
  const facts: BoardFact[] = [];
  for (const f of known) {
    if (notes.confirmedFacts.includes(f.text)) facts.push({ ...f, status: "confirmed" });
    else if (notes.unconfirmedFacts.includes(f.text)) facts.push({ ...f, status: "to_confirm" });
  }
  const company = clipOrNull(notes.company);
  return {
    company,
    slug: extra.slug,
    cards: {
      company,
      aiFeature: clipOrNull(notes.aiFeature),
      users: clipOrNull(notes.users),
      stage: clipOrNull(notes.stage),
      owner: clipOrNull(notes.owner),
      blockers: notes.symptoms.map(clip).filter(Boolean),
      tried: notes.tried.map(clip).filter(Boolean),
    },
    facts,
    researching: extra.researching ?? false,
    researched: extra.researched ?? false,
    updatedAt: new Date(now).toISOString(),
  };
}

const said = (label: string, value: string) => (value ? `${label}: ${JSON.stringify(value)}` : `${label}: (they cleared it)`);

export function applyEdit(notes: Notes, known: KnownFact[], edit: unknown): EditResult | null {
  if (!isObj(edit) || typeof edit.card !== "string") return null;
  const value = cleanValue(edit.value);
  if (value === null) return null;
  const card = edit.card;
  const next: Notes = structuredClone(notes);

  if (card === "blockers" || card === "tried") {
    const list = value ? [value] : [];
    if (card === "blockers") next.symptoms = list;
    else next.tried = list;
    return { notes: next, known, note: said(CARD_LABELS[card], value) };
  }
  if (TEXT_CARDS.includes(card)) {
    next[card as TextCard] = value || null;
    return { notes: next, known, note: said(CARD_LABELS[card as TextCard], value) };
  }
  if (!card.startsWith("fact:")) return null;

  const id = card.slice("fact:".length);
  const i = known.findIndex((f) => f.id === id);
  if (!FACT_ID.test(id) || i < 0) return null;
  const old = known[i]!.text;
  // A fact the model has already rejected is gone from the board: the edit is refused.
  if (!next.confirmedFacts.includes(old) && !next.unconfirmedFacts.includes(old)) return null;
  next.confirmedFacts = next.confirmedFacts.filter((t) => t !== old);
  next.unconfirmedFacts = next.unconfirmedFacts.filter((t) => t !== old);
  if (!value) return { notes: next, known, note: `They removed this fact as wrong: ${JSON.stringify(old)}` };
  // Editing a fact counts as confirming the edited version.
  next.confirmedFacts.push(value);
  const nextKnown = known.map((f, j) => (j === i ? { ...f, text: value } : f));
  return { notes: next, known: nextKnown, note: `They corrected this fact, which now counts as confirmed: ${JSON.stringify(value)}` };
}

export function parseEdit(payload: string): Edit | null {
  if (payload.length > MAX_EDIT_PAYLOAD) return null;
  try {
    const v: unknown = JSON.parse(payload);
    return isObj(v) && typeof v.card === "string" && typeof v.value === "string" ? { card: v.card, value: v.value } : null;
  } catch {
    return null;
  }
}

const textOrNull = (v: unknown) => (typeof v === "string" ? clip(v) || null : null);
const listOf = (v: unknown) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map(clip).filter(Boolean).slice(0, MAX_LIST_ITEMS) : [];

function factOf(f: unknown): BoardFact[] {
  if (!isObj(f)) return [];
  const { id, text, source, kind, status } = f;
  if (typeof id !== "string" || !FACT_ID.test(id)) return [];
  if (typeof text !== "string" || !text.trim() || text.length > MAX_FACT_CHARS) return [];
  if (typeof source !== "string" || !source.trim() || (kind !== "brief" && kind !== "found")) return [];
  if (status !== "to_confirm" && status !== "confirmed") return [];
  return [{ id, text: text.trim(), source, kind, status }];
}

// A stored board, checked field by field: anything unexpected is dropped, never passed on.
export function toBoard(v: unknown): Board | null {
  if (!isObj(v) || !isObj(v.cards) || !Array.isArray(v.facts)) return null;
  const c = v.cards;
  const company = textOrNull(c.company);
  return {
    company,
    slug: typeof v.slug === "string" && isValidSlug(v.slug) ? v.slug : null,
    cards: {
      company,
      aiFeature: textOrNull(c.aiFeature),
      users: textOrNull(c.users),
      stage: textOrNull(c.stage),
      owner: textOrNull(c.owner),
      blockers: listOf(c.blockers),
      tried: listOf(c.tried),
    },
    facts: v.facts.flatMap(factOf).slice(0, MAX_LIST_ITEMS),
    // Only a live call is ever researching; a stored flag is stale.
    researching: false,
    researched: v.researched === true,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
  };
}

// The notes and facts a "Talk again" call starts from. Contact details start empty.
export function startFromBoard(board: Board): SavedStart {
  const notes = emptyNotes(null);
  notes.company = board.cards.company;
  notes.aiFeature = board.cards.aiFeature;
  notes.users = board.cards.users;
  notes.stage = board.cards.stage;
  notes.owner = board.cards.owner;
  notes.symptoms = [...board.cards.blockers];
  notes.tried = [...board.cards.tried];
  notes.confirmedFacts = board.facts.filter((f) => f.status === "confirmed").map((f) => f.text);
  notes.unconfirmedFacts = board.facts.filter((f) => f.status === "to_confirm").map((f) => f.text);
  const known = board.facts.map(({ id, text, source, kind }) => ({ id, text, source, kind }));
  return { notes, known, researched: board.researched };
}

// A board that cannot be read (bad id, missing, bad JSON, store down) is simply not there.
export async function loadBoard(kv: KV | null, id: string | null): Promise<Board | null> {
  if (!kv || !isBoardId(id)) return null;
  try {
    const raw = await kv.get(BOARD_KEY(id));
    return raw ? toBoard(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// Every save refreshes the 30-day expiry.
export async function saveBoard(kv: KV, id: string, board: Board): Promise<void> {
  await kv.set(BOARD_KEY(id), JSON.stringify(board), BOARD_DAYS * 86_400);
}

// The worker's saves run after the visitor may have edited the board with PUT (after the call,
// or when phase 2 findings land late). A stored board with a later updatedAt wins.
export async function saveUnlessNewer(kv: KV, id: string, board: Board): Promise<boolean> {
  const stored = await loadBoard(kv, id);
  if (stored && stored.updatedAt > board.updatedAt) return false;
  await saveBoard(kv, id, board);
  return true;
}

// What the worker last loaded or saved: its time, and which facts it held. A fact id that was
// in the baseline but is missing from the stored board was removed, so it stays removed.
export type Baseline = { updatedAt: string; factIds: string[] };
export const baselineOf = (board: Board): Baseline => ({ updatedAt: board.updatedAt, factIds: board.facts.map((f) => f.id) });

// A stored board changed by someone else wins: its cards, facts and statuses stay. Only facts
// that are new since the baseline (in neither the baseline nor the stored board, for example
// found during this call) are added. With no baseline, the stored board decides every fact.
export function mergeBoards(stored: Board, mine: Board, baseline: Baseline | null): Board {
  const known = new Set([...stored.facts.map((f) => f.id), ...(baseline?.factIds ?? [])]);
  const added = baseline ? mine.facts.filter((f) => !known.has(f.id)) : [];
  return {
    ...stored,
    facts: [...stored.facts, ...added].slice(0, MAX_LIST_ITEMS),
    researching: mine.researching,
    researched: stored.researched || mine.researched,
    updatedAt: mine.updatedAt > stored.updatedAt ? mine.updatedAt : stored.updatedAt,
  };
}

// Compare-and-set for the worker. `baseline` is the board it last loaded or saved (null for
// none). If the stored board is newer than that (a visitor's PUT edit), the two are
// merged instead of overwritten. Unlike loadBoard, a store that cannot be read throws, so a
// failed read never looks like "nothing stored". Returns the board it wrote.
export async function saveSince(kv: KV, id: string, board: Board, baseline: Baseline | null): Promise<Board> {
  const raw = await kv.get(BOARD_KEY(id));
  let stored: Board | null = null;
  try {
    stored = raw ? toBoard(JSON.parse(raw)) : null;
  } catch {
    stored = null;
  }
  const newer = stored && (baseline === null || stored.updatedAt > baseline.updatedAt);
  const next = stored && newer ? mergeBoards(stored, board, baseline) : board;
  await saveBoard(kv, id, next);
  return next;
}
