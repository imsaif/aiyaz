import { afterEach, describe, expect, it, vi } from "vitest";
import { HANGUP_PLAYOUT_CAP_MS, PLAYOUT_WAIT_MS, TurnRunner, makeHangUp, startCallTimer, type Brain } from "../src/voice/turns.js";

function fakeBrain(ms = 5, endAfter = Infinity) {
  let running = 0;
  const brain = {
    calls: [] as string[],
    maxRunning: 0,
    ended: false,
    async reply(text: string) {
      running++;
      brain.maxRunning = Math.max(brain.maxRunning, running);
      brain.calls.push(text);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      if (brain.calls.length >= endAfter) brain.ended = true;
      return `answer to ${text}`;
    },
  };
  return brain satisfies Brain;
}

describe("TurnRunner", () => {
  it("answers the same turn id once, even when asked twice", async () => {
    const brain = fakeBrain();
    const turns = new TurnRunner(brain);
    const [a, b] = await Promise.all([turns.handle("t1", "hello"), turns.handle("t1", "hello")]);
    expect(a).toBe("answer to hello");
    expect(b).toBe("answer to hello");
    expect(await turns.handle("t1", "hello")).toBe("answer to hello");
    expect(brain.calls).toEqual(["hello"]);
  });
  it("never runs two turns at once, and keeps their order", async () => {
    const brain = fakeBrain(20);
    const turns = new TurnRunner(brain);
    const out = await Promise.all([turns.handle("t1", "one"), turns.handle("t2", "two"), turns.handle("t3", "three")]);
    expect(brain.maxRunning).toBe(1);
    expect(brain.calls).toEqual(["one", "two", "three"]);
    expect(out).toEqual(["answer to one", "answer to two", "answer to three"]);
  });
  it("silence makes no model call", async () => {
    const brain = fakeBrain();
    const turns = new TurnRunner(brain);
    expect(await turns.handle("t1", "   ")).toBeNull();
    expect(await turns.handle("t2", "")).toBeNull();
    expect(brain.calls).toEqual([]);
  });
  it("says nothing more once the conversation has ended", async () => {
    const brain = fakeBrain(5, 1);
    const turns = new TurnRunner(brain);
    const [first, second] = await Promise.all([turns.handle("t1", "bye"), turns.handle("t2", "still there?")]);
    expect(first).toBe("answer to bye");
    expect(second).toBeNull();
    expect(brain.calls).toEqual(["bye"]);
  });
  it("keeps going after a failed turn", async () => {
    let fail = true;
    const brain: Brain = {
      ended: false,
      async reply(text) {
        if (fail) {
          fail = false;
          throw new Error("boom");
        }
        return text;
      },
    };
    const turns = new TurnRunner(brain);
    await expect(turns.handle("t1", "a")).rejects.toThrow("boom");
    expect(await turns.handle("t2", "b")).toBe("b");
  });
});

describe("call timer", () => {
  afterEach(() => vi.useRealTimers());
  it("the call timer fires with no turns at all", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    startCallTimer(600, onExpire);
    vi.advanceTimersByTime(599_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });
  it("can be cancelled when the call ends first", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const cancel = startCallTimer(600, onExpire);
    cancel();
    vi.advanceTimersByTime(600_000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});

describe("makeHangUp", () => {
  afterEach(() => vi.useRealTimers());
  it("shuts down after the cap when playout never settles", async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn();
    const hang = makeHangUp({ say: () => new Promise<void>(() => {}), shutdown });
    const done = hang("Goodbye.");
    await vi.advanceTimersByTimeAsync(HANGUP_PLAYOUT_CAP_MS - 1);
    expect(shutdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await done;
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
  it("shuts down when say throws", async () => {
    const shutdown = vi.fn();
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => void errs.push(String(m)));
    await makeHangUp({ say: async () => { throw new Error("secret transcript"); }, shutdown })("Bye.");
    spy.mockRestore();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(errs.join()).not.toContain("secret transcript");
  });
  it("shuts down at once with no line, and a second call is a no-op", async () => {
    const shutdown = vi.fn();
    const say = vi.fn(async () => {});
    const hang = makeHangUp({ say, shutdown });
    await hang("");
    await hang("Bye.");
    expect(say).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});

describe("TurnRunner and what was heard", () => {
  const recorder = (ms = 5) => {
    const log: string[] = [];
    const brain = {
      ended: false,
      async reply(text: string, turnId?: string) {
        log.push(`reply ${turnId} start`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`reply ${turnId} done`);
        return `answer to ${text}`;
      },
      heard(turnId: string, played: string) {
        log.push(`heard ${turnId} "${played}"`);
      },
    };
    return { brain: brain satisfies Brain, log };
  };

  it("applies a cut-off report after that turn's reply and before the next reply", async () => {
    const { brain, log } = recorder();
    const turns = new TurnRunner(brain);
    const first = turns.handle("t1", "one");
    const second = turns.handle("t2", "two");
    turns.played("t1", "ans");
    await Promise.all([first, second]);
    expect(log).toEqual(['reply t1 start', 'reply t1 done', 'heard t1 "ans"', 'reply t2 start', 'reply t2 done']);
  });

  it("reports once per turn, and never for a turn the brain did not answer", async () => {
    const { brain, log } = recorder();
    const turns = new TurnRunner(brain);
    await turns.handle("t1", "one");
    turns.played("t1", "a");
    turns.played("t1", "b");
    turns.played("silent", "");
    await turns.handle("t2", "   ");
    turns.played("t2", "");
    await new Promise((r) => setTimeout(r, 10));
    expect(log.filter((l) => l.startsWith("heard"))).toEqual(['heard t1 "a"']);
  });
});

describe("TurnRunner waits for the previous reply's playout", () => {
  const recorder = () => {
    const log: string[] = [];
    const brain = {
      ended: false,
      async reply(text: string, turnId?: string) {
        log.push(`reply ${turnId}`);
        await new Promise((r) => setTimeout(r, 2));
        return `answer to ${text}`;
      },
      heard(turnId: string, played: string) {
        log.push(`heard ${turnId} "${played}"`);
      },
    };
    return { brain: brain satisfies Brain, log };
  };

  it("a cut-off report that arrives after the next turn started still lands before the next reply", async () => {
    const { brain, log } = recorder();
    let finishT1: () => void = () => {};
    const t1Done = new Promise<void>((r) => (finishT1 = r));
    const turns = new TurnRunner(brain, { playoutDone: (id) => (id === "t1" ? t1Done : Promise.resolve()) });
    await turns.handle("t1", "one");
    const second = turns.handle("t2", "two");
    await new Promise((r) => setTimeout(r, 10));
    expect(log).toEqual(["reply t1"]);
    // LiveKit reports t1's playout only after t2's turn has begun.
    turns.played("t1", "ans");
    finishT1();
    await second;
    expect(log).toEqual(["reply t1", 'heard t1 "ans"', "reply t2"]);
  });

  it("stops waiting after the bound when no playout report ever comes", async () => {
    const { brain, log } = recorder();
    const turns = new TurnRunner(brain, { playoutDone: () => new Promise<void>(() => {}), playoutWaitMs: 30 });
    await turns.handle("t1", "one");
    const started = Date.now();
    await turns.handle("t2", "two");
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(log).toEqual(["reply t1", "reply t2"]);
  });

  it("waits a bounded time by default", () => {
    expect(PLAYOUT_WAIT_MS).toBe(1000);
  });

  it("forgets a cut-off report for a turn whose reply failed", async () => {
    let fail = true;
    const log: string[] = [];
    const brain = {
      ended: false,
      async reply(text: string, turnId?: string) {
        if (fail) throw new Error("model down");
        log.push(`reply ${turnId}`);
        return text;
      },
      heard(turnId: string, played: string) {
        log.push(`heard ${turnId} "${played}"`);
      },
    } satisfies Brain;
    const turns = new TurnRunner(brain);
    await turns.handle("t1", "one").catch(() => undefined);
    turns.played("t1", "x");
    fail = false;
    await new Promise((r) => setTimeout(r, 5));
    await turns.handle("t2", "two");
    expect(log).toEqual(["reply t2"]);
    expect(turns.pendingReports).toBe(0);
  });
});
