// One visitor turn, one reply() call. LiveKit decides when a turn is finished; this makes
// sure each finished turn reaches the stateful brain exactly once, one at a time, in order.

export type Brain = {
  reply(text: string, turnId?: string): Promise<string>;
  // The reply for turnId was cut off and the visitor heard only `played` ("" for nothing).
  heard?(turnId: string, played: string): void;
  readonly ended: boolean;
};

export class TurnRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly answered = new Map<string, Promise<string | null>>();
  private readonly replied = new Set<string>();
  private readonly cutOff = new Map<string, string>();
  private readonly reported = new Set<string>();

  constructor(private readonly brain: Brain) {}

  handle(turnId: string, heard: string): Promise<string | null> {
    // Asked again for a turn already in hand (interruption, resume, retry): same answer, no new call.
    const known = this.answered.get(turnId);
    if (known) return known;
    const text = heard.trim();
    // Silence or noise: say nothing and spend nothing.
    if (!text) return Promise.resolve(null);
    const run = async () => {
      // What the visitor missed of earlier replies goes into the history before the next reply.
      this.settle();
      if (this.brain.ended) return null;
      const said = await this.brain.reply(text, turnId);
      this.replied.add(turnId);
      return said;
    };
    const answer = this.tail.then(run, run);
    this.tail = answer.catch(() => undefined);
    this.answered.set(turnId, answer);
    return answer;
  }

  // LiveKit cut the reply to turnId off after `played`. Applied once, after that reply is done.
  played(turnId: string, played: string): void {
    const answer = this.answered.get(turnId);
    if (!answer || this.reported.has(turnId)) return;
    this.reported.add(turnId);
    this.cutOff.set(turnId, played);
    void answer.then(
      () => this.settle(),
      () => undefined,
    );
  }

  private settle(): void {
    for (const [turnId, played] of this.cutOff) {
      if (!this.replied.has(turnId)) continue;
      this.cutOff.delete(turnId);
      this.brain.heard?.(turnId, played);
    }
  }
}

// The brain only checks the time limit when someone speaks, so a silent call needs its own clock.
export function startCallTimer(maxSeconds: number, onExpire: () => void): () => void {
  const timer = setTimeout(onExpire, maxSeconds * 1000);
  return () => clearTimeout(timer);
}

// Longest we wait for the goodbye to finish playing before leaving anyway.
export const HANGUP_PLAYOUT_CAP_MS = 15_000;

// Say the closing line (if any), then shut down exactly once. Playout that never settles or a
// say that throws must not keep the call open or skip the shutdown callback.
export function makeHangUp(io: { say: (line: string) => Promise<void>; shutdown: () => void }) {
  let closing = false;
  return async (line: string): Promise<void> => {
    if (closing) return;
    closing = true;
    let cap: ReturnType<typeof setTimeout> | undefined;
    try {
      if (line) {
        const timeout = new Promise<void>((r) => (cap = setTimeout(r, HANGUP_PLAYOUT_CAP_MS)));
        await Promise.race([io.say(line), timeout]);
      }
    } catch (err) {
      console.error(`[call] hang-up speech failed: ${err instanceof Error ? err.name : "unknown"}`);
    } finally {
      clearTimeout(cap);
      io.shutdown();
    }
  };
}
