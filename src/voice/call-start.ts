// What a call starts from: a saved board ("Talk again"), else the lead brief, else nothing.
// A revisit never reloads the brief, so facts the visitor rejected last time stay rejected.
import { baselineOf, loadBoard, startFromBoard, type Baseline, type SavedStart } from "../board.js";
import { loadBrief } from "../briefs.js";
import type { KV } from "../kv.js";
import type { Brief } from "../notes.js";
import type { CallMeta } from "./meta.js";

// baseline: the loaded board's time and fact ids, for the worker's compare-and-set saves.
// Present only when a saved board was loaded.
// proof: on a revisit, the lead brief's findings and screenshots. They are ours, never the
// visitor's facts, so reloading them cannot undo anything the visitor rejected (2026-10-26:
// a "Talk again" call had lost them and told the CEO it had found nothing).
export type CallStart = {
  brief: Brief | null;
  saved: SavedStart | null;
  company: string | null;
  slug: string | null;
  baseline?: Baseline;
  proof?: Brief | null;
};

export async function callStart(kv: KV | null, meta: CallMeta): Promise<CallStart> {
  const board = await loadBoard(kv, meta.board);
  if (board) {
    const slug = board.slug ?? meta.slug;
    const lead = await loadBrief(kv, slug);
    return {
      brief: null,
      saved: startFromBoard(board),
      company: board.company,
      slug,
      baseline: baselineOf(board),
      ...(lead ? { proof: lead } : {}),
    };
  }
  const brief = await loadBrief(kv, meta.slug);
  return { brief, saved: null, company: brief?.company ?? null, slug: brief ? meta.slug : null };
}
