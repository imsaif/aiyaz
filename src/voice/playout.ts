// Tells the brain when a reply was cut off, and how much of it the visitor heard, so unheard
// words never count as said. LiveKit reports this per speech; this links each speech to the
// visitor turn it answers.

// The parts of a LiveKit SpeechHandle this needs.
export type SpeechLike = {
  readonly interrupted: boolean;
  readonly chatItems: readonly { type: string; role?: string; textContent?: string }[];
  addDoneCallback(cb: (speech: SpeechLike) => void): void;
};

export class PlayoutTracker {
  private pendingTurn: string | null = null;

  constructor(private readonly onCutOff: (turnId: string, played: string) => void) {}

  // From Agent.onUserTurnCompleted. LiveKit creates that turn's reply right after the hook
  // returns, and handles one visitor turn at a time, so the next reply speech belongs to it.
  userTurn(turnId: string): void {
    this.pendingTurn = turnId;
  }

  // From the session's SpeechCreated event. say() lines (opener, goodbye) are not replies.
  speechCreated(ev: { source: string; speechHandle: SpeechLike }): void {
    if (ev.source !== "generate_reply" || this.pendingTurn === null) return;
    const turnId = this.pendingTurn;
    this.pendingTurn = null;
    ev.speechHandle.addDoneCallback((speech) => {
      if (!speech.interrupted) return;
      // LiveKit adds the played part as an assistant message; none means nothing played.
      const played = speech.chatItems.find((i) => i.type === "message" && i.role === "assistant");
      this.onCutOff(turnId, played?.textContent ?? "");
    });
  }
}
