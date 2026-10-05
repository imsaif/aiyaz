import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnRunner, startCallTimer, type Brain } from "../src/voice/turns.js";

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
