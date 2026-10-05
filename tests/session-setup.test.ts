import { initializeLogger, voice } from "@livekit/agents";
import { describe, expect, it } from "vitest";
import { SESSION_TURN_HANDLING } from "../src/voice/session-setup.js";

initializeLogger({ pretty: false, level: "warn" });

describe("session turn handling", () => {
  it("uses voice-activity interruptions in every mode, with a short false-interruption wait", () => {
    const session = new voice.AgentSession({ turnHandling: SESSION_TURN_HANDLING });
    const { interruption, preemptiveGeneration } = session.sessionOptions.turnHandling;
    expect(interruption.mode).toBe("vad");
    expect(interruption.enabled).toBe(true);
    expect(interruption.minDuration).toBe(450);
    expect(interruption.falseInterruptionTimeout).toBe(1000);
    expect(interruption.resumeFalseInterruption).toBe(true);
    expect(preemptiveGeneration.enabled).toBe(false);
  });
});

describe("session endpointing", () => {
  it("waits 750 ms after speech before committing a likely-finished turn, so a slow final transcript joins it", () => {
    const session = new voice.AgentSession({ turnHandling: SESSION_TURN_HANDLING });
    const { endpointing } = session.sessionOptions.turnHandling;
    expect(endpointing.minDelay).toBe(750);
    expect(endpointing.maxDelay).toBe(2500);
  });
});
