import { RpcError } from "@livekit/rtc-node";
import { describe, expect, it, vi } from "vitest";
import {
  BOARD_KEY,
  baselineOf,
  boardFromNotes,
  boardUrl,
  knownFromBrief,
  loadBoard,
  saveBoard,
  saveUnlessNewer,
  type Board,
  type BoardFact,
} from "../src/board.js";
import { buildCallLog } from "../src/calllog.js";
import { loadSettings } from "../src/config.js";
import { Conversation } from "../src/conversation.js";
import { MemoryKV, type KV } from "../src/kv.js";
import { applyNotesUpdate, emptyNotes } from "../src/notes.js";
import { MemoryTracer } from "../src/tracer.js";
import { BoardLink, boardSaver, EDIT_REJECTED, editHandler, helloHandler } from "../src/voice/board-link.js";
import { FLUSH_CAP_MS, finishCall } from "../src/voice/call-end.js";
import { callStart } from "../src/voice/call-start.js";
import { BRIEF_KEY } from "../src/briefs.js";
import { FakeLLM, text, tool } from "./fake-llm.js";

// The company card too: a stored board's company is read back from its card.
const boardNamed = (company: string): Board => {
  const b = boardFromNotes(emptyNotes(null), [], 0, { slug: null });
  return { ...b, company, cards: { ...b.cards, company } };
};

describe("BoardLink", () => {
  it("sends and saves the newest board last, even when boards arrive during a slow send", async () => {
    const sent: string[] = [];
    const saved: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    let sends = 0;
    const link = new BoardLink({
      send: async (json) => {
        if (sends++ === 0) await slow;
        sent.push(JSON.parse(json).company);
      },
      save: async (b) => {
        saved.push(b.company!);
      },
      log: () => {},
    });
    link.push(boardNamed("A"));
    link.push(boardNamed("B"));
    link.push(boardNamed("C"));
    release();
    await link.flush();
    expect(sent).toEqual(["A", "C"]);
    expect(saved).toEqual(["A", "C"]);
  });

  it("a failed send or save is logged without content and the next board still goes out", async () => {
    const lines: string[] = [];
    const saved: string[] = [];
    let fail = true;
    const link = new BoardLink({
      send: async () => {
        if (fail) throw new Error("room gone: Acme secret");
      },
      save: async (b) => {
        if (fail) throw new Error("Upstash 500");
        saved.push(b.company!);
      },
      log: (what) => lines.push(what),
    });
    link.push(boardNamed("Acme first"));
    await link.flush();
    fail = false;
    link.push(boardNamed("Acme second"));
    await link.flush();
    expect(lines).toEqual(["send failed", "save failed"]);
    expect(saved).toEqual(["Acme second"]);
  });

  it("flush resolves at once when nothing is waiting", async () => {
    const link = new BoardLink({ send: async () => {}, save: async () => {}, log: () => {} });
    await expect(link.flush()).resolves.toBeUndefined();
  });

  it("push and flush never throw, even when send, save and log all throw synchronously", async () => {
    const link = new BoardLink({
      send: () => {
        throw new Error("Acme");
      },
      save: () => {
        throw new Error("Acme");
      },
      log: () => {
        throw new Error("Acme");
      },
    });
    expect(() => link.push(boardNamed("Acme"))).not.toThrow();
    await expect(link.flush()).resolves.toBeUndefined();
  });
});

describe("saveUnlessNewer", () => {
  const id = "AbCdEfGhIjKlMnOpQr_-12";
  const at = (iso: string, company: string): Board => ({ ...boardNamed(company), updatedAt: iso });
  it("a later PUT edit wins over a late worker save", async () => {
    const kv = new MemoryKV();
    await saveBoard(kv, id, at("2026-10-05T10:05:00.000Z", "Edited after the call"));
    expect(await saveUnlessNewer(kv, id, at("2026-10-05T10:04:59.000Z", "Worker"))).toBe(false);
    expect((await loadBoard(kv, id))?.company).toBe("Edited after the call");
  });
  it("saves when nothing newer is stored", async () => {
    const kv = new MemoryKV();
    expect(await saveUnlessNewer(kv, id, at("2026-10-05T10:00:00.000Z", "First"))).toBe(true);
    expect(await saveUnlessNewer(kv, id, at("2026-10-05T10:01:00.000Z", "Second"))).toBe(true);
    expect((await loadBoard(kv, id))?.company).toBe("Second");
    expect(kv.ttl.get(BOARD_KEY(id))).toBe(2_592_000);
  });
});

describe("the worker's saves never overwrite a newer stored board", () => {
  const id = "AbCdEfGhIjKlMnOpQr_-12";
  const fact = (id: string, text: string, status: BoardFact["status"]): BoardFact => ({
    id,
    text,
    source: "https://acme.example/news",
    kind: id.startsWith("b") ? "brief" : "found",
    status,
  });
  const board = (iso: string, company: string, facts: BoardFact[], users: string | null = null): Board => {
    const b = boardNamed(company);
    return { ...b, cards: { ...b.cards, company, users }, facts, updatedAt: iso };
  };

  it("a visitor edit saved after the call (newer updatedAt) survives the worker's final save", async () => {
    const kv = new MemoryKV();
    const save = boardSaver(kv, id, null);
    await save(board("2026-10-05T10:00:00.000Z", "Acme", [fact("b1", "runs a support bot", "to_confirm")]));
    // The visitor edits on the site after the call: a newer board, with the fact confirmed.
    await saveBoard(kv, id, board("2026-10-05T10:05:00.000Z", "Acme Edited", [fact("b1", "runs a support bot", "confirmed")], "support team"));
    // The worker's last save lands later, carrying a stale card, a stale status and one new fact.
    await save(
      board("2026-10-05T10:04:00.000Z", "Acme worker", [fact("b1", "runs a support bot", "to_confirm"), fact("f1", "hiring a data engineer", "to_confirm")]),
    );
    const stored = await loadBoard(kv, id);
    expect(stored?.company).toBe("Acme Edited");
    expect(stored?.cards.users).toBe("support team");
    expect(stored?.facts.map((f) => [f.id, f.status])).toEqual([
      ["b1", "confirmed"],
      ["f1", "to_confirm"],
    ]);
    expect(kv.ttl.get(BOARD_KEY(id))).toBe(2_592_000);
  });

  it("a save with nothing newer stored writes the worker board", async () => {
    const kv = new MemoryKV();
    const save = boardSaver(kv, id, null);
    await save(board("2026-10-05T10:00:00.000Z", "Acme", []));
    const second = board("2026-10-05T10:01:00.000Z", "Acme Labs", [fact("b1", "runs a support bot", "confirmed")], "support team");
    await save(second);
    expect(await loadBoard(kv, id)).toEqual(second);
  });

  it("an edit made while Talk again was connecting is kept, even though the worker's clock is later", async () => {
    const kv = new MemoryKV();
    const loaded = board("2026-10-05T10:00:00.000Z", "Acme", [fact("b1", "runs a support bot", "to_confirm")]);
    await saveBoard(kv, id, loaded);
    const save = boardSaver(kv, id, baselineOf(loaded));
    await saveBoard(kv, id, board("2026-10-05T10:00:05.000Z", "Acme Edited", [fact("b1", "runs a support bot", "confirmed")]));
    await save(board("2026-10-05T10:00:09.000Z", "Acme", [fact("b1", "runs a support bot", "to_confirm")]));
    const stored = await loadBoard(kv, id);
    expect(stored?.company).toBe("Acme Edited");
    expect(stored?.facts.map((f) => f.status)).toEqual(["confirmed"]);
  });

  it("a stored board the worker never saw (no baseline) is merged, not overwritten", async () => {
    const kv = new MemoryKV();
    await saveBoard(kv, id, board("2026-10-05T09:00:00.000Z", "Acme Saved", []));
    await boardSaver(kv, id, null)(board("2026-10-05T10:00:00.000Z", "Acme", [fact("f1", "hiring a data engineer", "to_confirm")]));
    const stored = await loadBoard(kv, id);
    expect(stored?.company).toBe("Acme Saved");
    // With no baseline the stored board decides the facts: nothing is added.
    expect(stored?.facts).toEqual([]);
  });

  it("a fact the visitor removed after the call stays removed after the worker's final save", async () => {
    const kv = new MemoryKV();
    const save = boardSaver(kv, id, null);
    const b1 = fact("b1", "runs a support bot", "to_confirm");
    const b2 = fact("b2", "is hiring a data engineer", "to_confirm");
    await save(board("2026-10-05T10:00:00.000Z", "Acme", [b1, b2]));
    // After the call the visitor deletes b2 on the site.
    await saveBoard(kv, id, board("2026-10-05T10:05:00.000Z", "Acme", [b1]));
    // The worker's last save still carries b2, plus a fact found during this call.
    await save(board("2026-10-05T10:04:00.000Z", "Acme", [b1, b2, fact("f1", "opened an office in Dubai", "to_confirm")]));
    expect((await loadBoard(kv, id))?.facts.map((f) => f.id)).toEqual(["b1", "f1"]);
  });

  it("a talk-again start that failed to load the board does not bring rejected brief facts back", async () => {
    const kv = new MemoryKV();
    // Saved last time with b2 rejected; the worker's load failed, so it started from the brief.
    await saveBoard(kv, id, board("2026-10-05T09:00:00.000Z", "Acme", [fact("b1", "runs a support bot", "confirmed")]));
    await boardSaver(kv, id, null)(
      board("2026-10-05T10:00:00.000Z", "Acme", [fact("b1", "runs a support bot", "to_confirm"), fact("b2", "is hiring a data engineer", "to_confirm")]),
    );
    const stored = await loadBoard(kv, id);
    expect(stored?.facts.map((f) => [f.id, f.status])).toEqual([["b1", "confirmed"]]);
  });

  it("a store that cannot be read fails the save instead of overwriting blind", async () => {
    const writes: string[] = [];
    const down: KV = {
      get: async () => {
        throw new Error("Upstash 500");
      },
      set: async (k) => void writes.push(k),
      incrByFloat: async () => 0,
    };
    await expect(boardSaver(down, id, null)(board("2026-10-05T10:00:00.000Z", "Acme", []))).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});

describe("aiyaz.edit RPC", () => {
  const brief = { company: "Acme", facts: [{ text: "runs a support bot", source: "https://acme.example/news" }] };
  const settings = loadSettings();
  const brain = () => new Conversation({ settings, llm: new FakeLLM([]), tracer: new MemoryTracer(), brief });
  const call = (handler: ReturnType<typeof editHandler>, payload: string) => handler({ payload } as Parameters<typeof handler>[0]);

  it("answers ok and applies a valid edit", async () => {
    const c = brain();
    await expect(call(editHandler((e) => c.edit(e)), JSON.stringify({ card: "users", value: "the support team" }))).resolves.toBe("ok");
    expect(c.board().cards.users).toBe("the support team");
  });

  it("rejects unknown cards, facts no longer on the board, non-string values and oversized payloads, echoing nothing", async () => {
    const c = brain();
    const handler = editHandler((e) => c.edit(e));
    // Remove the fact, so a second edit to it finds it gone from the board.
    await expect(call(handler, JSON.stringify({ card: "fact:b1", value: "" }))).resolves.toBe("ok");
    const bad = [
      JSON.stringify({ card: "secretCard Acme", value: "Acme private" }),
      JSON.stringify({ card: "fact:b1", value: "Acme private" }),
      JSON.stringify({ card: "fact:b9", value: "Acme private" }),
      JSON.stringify({ card: "users", value: 42 }),
      JSON.stringify({ card: "users", value: ["Acme private"] }),
      JSON.stringify({ card: "users", value: "Acme private".repeat(300) }),
      "not json Acme private",
    ];
    for (const payload of bad) {
      const err = await call(handler, payload).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(EDIT_REJECTED);
      expect((err as RpcError).message).toBe("invalid edit");
      expect((err as RpcError).message).not.toContain("Acme");
    }
    expect(EDIT_REJECTED < 1001 || EDIT_REJECTED > 1999).toBe(true);
    expect(c.board().cards.users).toBeNull();
  });

  it("an unexpected throw while applying still answers with the same clean rejection", async () => {
    const handler = editHandler(() => {
      throw new Error("Acme private");
    });
    const err = await call(handler, JSON.stringify({ card: "users", value: "x" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(EDIT_REJECTED);
    expect((err as RpcError).message).toBe("invalid edit");
  });
});

describe("the board callback never throws into the Conversation", () => {
  it("a throwing send and a throwing save leave reply() and edit() working, with every tool call answered", async () => {
    const brief = { company: "Acme", facts: [{ text: "runs a support bot", source: "https://acme.example/news" }] };
    const lines: string[] = [];
    const link = new BoardLink({
      send: () => {
        throw new Error("Acme room gone");
      },
      save: async () => {
        throw new Error("Upstash 500");
      },
      log: (what) => lines.push(what),
    });
    const llm = new FakeLLM([[text("Who uses it?"), tool("record_notes", { ai_feature: "answer support emails" })], [text("Thanks.")]]);
    const c = new Conversation({ settings: loadSettings(), llm, tracer: new MemoryTracer(), brief, onBoard: (b) => link.push(b) });
    c.start();
    expect(await c.reply("We want AI to answer support emails.")).toBe("Who uses it?");
    expect(c.edit({ card: "users", value: "the support team" })?.cards.users).toBe("the support team");
    expect(await c.reply("The support team.")).toBe("Thanks.");
    await link.flush();
    const blocks = llm.requests[1]!.messages.flatMap((m) => (typeof m.content === "string" ? [] : m.content));
    expect(blocks.some((b) => b.type === "tool_result")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l === "send failed" || l === "save failed")).toBe(true);
  });
});

describe("board link", () => {
  it("is the site URL without a trailing slash, then /aiyaz/b/ and the id", () => {
    expect(boardUrl("https://x/", "AbCdEfGhIjKlMnOpQr_-12")).toBe("https://x/aiyaz/b/AbCdEfGhIjKlMnOpQr_-12");
    expect(boardUrl("https://x", "AbCdEfGhIjKlMnOpQr_-12")).toBe("https://x/aiyaz/b/AbCdEfGhIjKlMnOpQr_-12");
  });
});

describe("call end", () => {
  const id = "AbCdEfGhIjKlMnOpQr_-12";
  const meta = { country: "AE", slug: null, email: null, day: null, reservedUsd: null, board: id };
  const log = () =>
    buildCallLog({
      id: "call-1",
      startedAt: 0,
      endedAt: 60_000,
      meta,
      company: "Acme",
      endReason: "visitor_left",
      claudeUsd: 0.1,
      notes: emptyNotes(null),
      transcript: [],
      voiceUsdPerMinute: 0.05,
      board: boardNamed("Acme"),
      boardUrl: boardUrl("https://x", id),
    });

  it("a board store that is down does not stop storing the call or the emails, and logs ids only", async () => {
    const lines: string[] = [];
    const down: KV = {
      get: async () => {
        throw new Error("Upstash 500 Acme");
      },
      set: async () => {
        throw new Error("Upstash 500 Acme");
      },
      incrByFloat: async () => 0,
    };
    const link = new BoardLink({ send: async () => {}, save: boardSaver(down, id, null), log: (w) => lines.push(`[board] call-1 ${w}`) });
    link.push(boardNamed("Acme"));
    const done: string[] = [];
    await finishCall({
      id: "call-1",
      flush: () => link.flush(),
      build: log,
      store: async () => void done.push("store"),
      email: async () => void done.push("email"),
      error: (l) => lines.push(l),
    });
    expect(done).toEqual(["store", "email"]);
    expect(lines).toEqual(["[board] call-1 save failed"]);
  });

  it("a failed store or email is logged by error name only, and the other still runs", async () => {
    const lines: string[] = [];
    const done: string[] = [];
    await finishCall({
      id: "call-1",
      flush: async () => {
        throw new Error("Acme");
      },
      build: log,
      store: async () => {
        throw new Error(`Acme ${id}`);
      },
      email: async () => void done.push("email"),
      error: (l) => lines.push(l),
    });
    expect(done).toEqual(["email"]);
    for (const l of lines) {
      expect(l).not.toContain("Acme");
      expect(l).not.toContain(id);
    }
    expect(lines).toContain("[call] call-1 store failed: Error");
  });

  it("without a store, only the emails run", async () => {
    const done: string[] = [];
    const out = await finishCall({ id: "call-1", flush: async () => {}, build: log, store: null, email: async () => void done.push("email"), error: () => {} });
    expect(done).toEqual(["email"]);
    expect(out.id).toBe("call-1");
  });
});

describe("call end, with a board store that never answers", () => {
  it("stops waiting for the board after the cap and still stores the call and sends the emails", async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const done: string[] = [];
      const link = new BoardLink({ send: async () => {}, save: () => new Promise<void>(() => {}), log: () => {} });
      link.push(boardNamed("Acme"));
      const finished = finishCall({
        id: "call-1",
        flush: () => link.flush(),
        build: () =>
          buildCallLog({
            id: "call-1", startedAt: 0, endedAt: 60_000,
            meta: { country: "AE", slug: null, email: null, day: null, reservedUsd: null, board: null },
            company: "Acme", endReason: "visitor_left", claudeUsd: 0, notes: emptyNotes(null), transcript: [], voiceUsdPerMinute: 0,
          }),
        store: async () => void done.push("store"),
        email: async () => void done.push("email"),
        error: (l) => lines.push(l),
      });
      await vi.advanceTimersByTimeAsync(FLUSH_CAP_MS - 1);
      expect(done).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await finished;
      expect(FLUSH_CAP_MS).toBe(5000);
      expect(done).toEqual(["store", "email"]);
      expect(lines).toEqual(["[call] call-1 board flush timed out after 5000 ms"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("aiyaz.hello RPC", () => {
  it("re-pushes the current board through the same queue and answers ok", async () => {
    const sent: string[] = [];
    const link = new BoardLink({ send: async (json) => void sent.push(JSON.parse(json).company), save: async () => {}, log: () => {} });
    const handler = helloHandler(() => link.push(boardNamed("Acme")));
    await expect(handler({ payload: "" } as Parameters<typeof handler>[0])).resolves.toBe("ok");
    await link.flush();
    expect(sent).toEqual(["Acme"]);
  });

  it("still answers ok if the push throws", async () => {
    const handler = helloHandler(() => {
      throw new Error("Acme");
    });
    await expect(handler({ payload: "" } as Parameters<typeof handler>[0])).resolves.toBe("ok");
  });
});

describe("callStart", () => {
  const brief = {
    company: "Acme",
    facts: [
      { text: "launched an AI assistant for support", source: "https://acme.example/news" },
      { text: "is hiring a data engineer", source: "https://acme.example/jobs" },
    ],
  };
  const meta = { country: "AE", slug: "acme-7k2q", email: null, day: null, reservedUsd: null, board: "AbCdEfGhIjKlMnOpQr_-12" };

  it("a saved board wins over the brief, so rejected facts stay rejected", async () => {
    const kv = new MemoryKV();
    await kv.set(BRIEF_KEY("acme-7k2q"), JSON.stringify(brief));
    const notes = applyNotesUpdate(emptyNotes(brief), { reject_facts: ["is hiring a data engineer"] });
    const saved = boardFromNotes(notes, knownFromBrief(brief), 0, { slug: "acme-7k2q" });
    await saveBoard(kv, meta.board, saved);
    const start = await callStart(kv, meta);
    expect(start.brief).toBeNull();
    expect(start.saved?.notes.unconfirmedFacts).toEqual(["launched an AI assistant for support"]);
    expect(start.saved?.known.map((f) => f.id)).toEqual(["b1"]);
    expect(start.company).toBe("Acme");
    expect(start.slug).toBe("acme-7k2q");
    // The worker's save baseline: the stored board's own time.
    expect(start.baseline).toEqual({ updatedAt: saved.updatedAt, factIds: ["b1"] });
  });

  it("a new board id starts from the brief, or from nothing", async () => {
    const kv = new MemoryKV();
    await kv.set(BRIEF_KEY("acme-7k2q"), JSON.stringify(brief));
    const lead = await callStart(kv, meta);
    expect(kv.data.has(BOARD_KEY(meta.board))).toBe(false);
    expect(lead.saved).toBeNull();
    expect(lead.brief?.company).toBe("Acme");
    expect(lead.slug).toBe("acme-7k2q");
    const homepage = await callStart(kv, { ...meta, slug: null });
    expect(homepage).toEqual({ brief: null, saved: null, company: null, slug: null });
  });
});
