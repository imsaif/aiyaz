// One visitor turn, one reply() call. LiveKit decides when a turn is finished; this makes
// sure each finished turn reaches the stateful brain exactly once, one at a time, in order.

export type Brain = {
  reply(text: string, turnId?: string): Promise<string>;
  // The reply for turnId was cut off and the visitor heard only `played` ("" for nothing).
  heard?(turnId: string, played: string): void;
  readonly ended: boolean;
};

// Longest the next reply waits for LiveKit to report how the previous reply played out.
// LiveKit starts the next turn's reply before the cut-off reply has finished unwinding.
export const PLAYOUT_WAIT_MS = 1000;

export type TurnRunnerOptions = {
  // Resolves when the reply speech for turnId is done (after any cut-off report for it).
  playoutDone?: (turnId: string) => Promise<void>;
  playoutWaitMs?: number;
};

export class TurnRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly answered = new Map<string, Promise<string | null>>();
  private readonly replied = new Set<string>();
  private readonly cutOff = new Map<string, string>();
  private readonly reported = new Set<string>();
  private lastReplied: string | null = null;
  // Words of turns LiveKit dropped before their reply started, said again with the next turn.
  private carried = "";

  constructor(
    private readonly brain: Brain,
    private readonly options: TurnRunnerOptions = {},
  ) {}

  // Cut-off reports still waiting for their reply to finish (for tests and diagnostics).
  get pendingReports(): number {
    return this.cutOff.size;
  }

  // signal: LiveKit aborts it when it drops this turn's reply (a newer turn superseded it).
  handle(turnId: string, heard: string, signal?: AbortSignal): Promise<string | null> {
    // Asked again for a turn already in hand (interruption, resume, retry): same answer, no new call.
    const known = this.answered.get(turnId);
    if (known) return known;
    const text = heard.trim();
    // Silence or noise: say nothing and spend nothing.
    if (!text) return Promise.resolve(null);
    const run = async () => {
      // What the visitor missed of earlier replies goes into the history before the next reply.
      await this.previousPlayout();
      this.settle();
      // Dropped while waiting: no model call; the visitor's words join the next turn instead.
      if (signal?.aborted) {
        this.carried = `${this.carried} ${text}`.trim();
        return null;
      }
      if (this.brain.ended) return null;
      const words = `${this.carried} ${text}`.trim();
      try {
        // Once started, a reply runs to the end even if LiveKit drops it (it is never spoken,
        // and the played-only trim removes it from the history).
        const said = await this.brain.reply(words, turnId);
        // Cleared only once the brain has them, so a failed reply does not lose them.
        this.carried = "";
        this.replied.add(turnId);
        this.lastReplied = turnId;
        return said;
      } catch (err) {
        this.cutOff.delete(turnId);
        throw err;
      }
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
      (said) => (said === null ? this.cutOff.delete(turnId) : this.settle()),
      () => this.cutOff.delete(turnId),
    );
  }

  private async previousPlayout(): Promise<void> {
    const previous = this.lastReplied;
    if (previous === null || !this.options.playoutDone) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<void>((r) => (timer = setTimeout(r, this.options.playoutWaitMs ?? PLAYOUT_WAIT_MS)));
    try {
      await Promise.race([this.options.playoutDone(previous), bound]);
    } finally {
      clearTimeout(timer);
    }
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
// opts.interrupt (the time limit): cut off any reply being spoken or queued first, so the
// closing line plays at once instead of after it.
export function makeHangUp(io: { say: (line: string) => Promise<void>; shutdown: () => void; interrupt?: () => void }) {
  let closing = false;
  return async (line: string, opts: { interrupt?: boolean } = {}): Promise<void> => {
    if (closing) return;
    closing = true;
    let cap: ReturnType<typeof setTimeout> | undefined;
    if (opts.interrupt) {
      try {
        io.interrupt?.();
      } catch (err) {
        console.error(`[call] interrupt failed: ${err instanceof Error ? err.name : "unknown"}`);
      }
    }
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
