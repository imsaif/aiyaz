// How the LiveKit session handles turns. Kept in one place so dev and start behave the same.
import type { voice } from "@livekit/agents";

type TurnHandling = NonNullable<ConstructorParameters<typeof voice.AgentSession>[0]>["turnHandling"];

export const SESSION_TURN_HANDLING = {
  // Off: a speculative run would call the stateful brain before the visitor finished.
  preemptiveGeneration: { enabled: false },
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
