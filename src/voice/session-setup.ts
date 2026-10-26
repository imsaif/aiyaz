// How the LiveKit session handles turns. Kept in one place so dev and start behave the same.
import type { voice } from "@livekit/agents";

type TurnHandling = NonNullable<ConstructorParameters<typeof voice.AgentSession>[0]>["turnHandling"];

export const SESSION_TURN_HANDLING = {
  // Off: a speculative run would call the stateful brain before the visitor finished.
  preemptiveGeneration: { enabled: false },
  endpointing: {
    // Silence (from the last speech) before a likely-finished turn is committed. The library's
    // streaming default is 300 ms, below Silero's 550 ms end-of-speech silence, so turns were
    // committed the moment voice activity stopped and a final transcript arriving just after
    // started a second turn (call 2: one final landed 26 ms after the commit). 750 ms leaves
    // 200 ms after end of speech for Deepgram's final, adding about 0.2 s to a normal turn.
    minDelay: 750,
    // Unchanged library default, for turns the turn detector thinks are unfinished.
    maxDelay: 2500,
  },
  interruption: {
    // Pinned: left unset, LiveKit uses its cloud model in dev but voice activity in start,
    // and the model took about 2.5 s to stop Aiyaz in the first live call.
    mode: "vad",
    // Speech this long pauses Aiyaz.
    minDuration: 450,
    // No transcript within 1 s after the pause means it was noise: Aiyaz carries on.
    falseInterruptionTimeout: 1000,
    resumeFalseInterruption: true,
  },
} satisfies TurnHandling;

// One log line per STT, TTS or LLM failure (LiveKit forwards all three as the session's Error
// event). Ids, names and codes only: an error message can quote what was said.
export function sessionErrorLine(callId: string, ev: voice.ErrorEvent): string {
  const failure = ev.error as { type: string; label?: string; recoverable?: boolean; error?: unknown };
  const inner = failure.error instanceof Error ? failure.error : undefined;
  const code = (inner as { statusCode?: unknown } | undefined)?.statusCode;
  return [
    `[call] ${callId} error component=${failure.type}`,
    failure.label ? `label=${failure.label}` : "",
    `name=${inner?.name ?? "unknown"}`,
    typeof code === "number" ? `code=${code}` : "",
    `recoverable=${failure.recoverable ?? false}`,
  ]
    .filter(Boolean)
    .join(" ");
}
