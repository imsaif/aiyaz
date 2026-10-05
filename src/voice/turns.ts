// One visitor turn, one reply() call. LiveKit decides when a turn is finished; this makes
// sure each finished turn reaches the stateful brain exactly once, one at a time, in order.

export type Brain = { reply(text: string): Promise<string>; readonly ended: boolean };

export class TurnRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly answered = new Map<string, Promise<string | null>>();

  constructor(private readonly brain: Brain) {}

  handle(turnId: string, heard: string): Promise<string | null> {
    // Asked again for a turn already in hand (interruption, resume, retry): same answer, no new call.
    const known = this.answered.get(turnId);
    if (known) return known;
    const text = heard.trim();
    // Silence or noise: say nothing and spend nothing.
    if (!text) return Promise.resolve(null);
    const run = () => (this.brain.ended ? Promise.resolve(null) : this.brain.reply(text));
    const answer = this.tail.then(run, run);
    this.tail = answer.catch(() => undefined);
    this.answered.set(turnId, answer);
    return answer;
  }
}

// The brain only checks the time limit when someone speaks, so a silent call needs its own clock.
export function startCallTimer(maxSeconds: number, onExpire: () => void): () => void {
  const timer = setTimeout(onExpire, maxSeconds * 1000);
  return () => clearTimeout(timer);
}
