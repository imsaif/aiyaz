// What a call starts from: a saved board ("Talk again"), else the lead brief, else nothing.
// A revisit never reloads the brief, so facts the visitor rejected last time stay rejected.
import { baselineOf, loadBoard, startFromBoard, type Baseline, type SavedStart } from "../board.js";
import { loadBrief } from "../briefs.js";
import type { KV } from "../kv.js";
import type { Brief } from "../notes.js";
import type { CallMeta } from "./meta.js";

// baseline: the loaded board's time and fact ids, for the worker's compare-and-set saves.
// Present only when a saved board was loaded.
export type CallStart = { brief: Brief | null; saved: SavedStart | null; company: string | null; slug: string | null; baseline?: Baseline };

export async function callStart(kv: KV | null, meta: CallMeta): Promise<CallStart> {
  const board = await loadBoard(kv, meta.board);
  if (board) {
    return { brief: null, saved: startFromBoard(board), company: board.company, slug: board.slug ?? meta.slug, baseline: baselineOf(board) };
  }
  const brief = await loadBrief(kv, meta.slug);
  return { brief, saved: null, company: brief?.company ?? null, slug: brief ? meta.slug : null };
}
