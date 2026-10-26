import { describe, expect, it } from "vitest";
import { sessionErrorLine } from "../src/voice/session-setup.js";

describe("session error line", () => {
  class APIStatusError extends Error {
    statusCode = 401;
    constructor(message: string) {
      super(message);
      this.name = "APIStatusError";
    }
  }
  it("names the call, the component and the error, never the message", () => {
    const line = sessionErrorLine("call-1", {
      type: "error",
      createdAt: 0,
      error: { type: "tts_error", timestamp: 0, label: "elevenlabs.TTS", recoverable: false, error: new APIStatusError("could not say: our budget is tight") },
    });
    expect(line).toBe("[call] call-1 error component=tts_error label=elevenlabs.TTS name=APIStatusError code=401 recoverable=false");
    expect(line).not.toContain("budget");
  });
  it("leaves the code out when the error has none", () => {
    const line = sessionErrorLine("call-2", {
      type: "error",
      createdAt: 0,
      error: { type: "stt_error", timestamp: 0, label: "deepgram.STT", recoverable: true, error: new Error("heard: hello there") },
    });
    expect(line).toBe("[call] call-2 error component=stt_error label=deepgram.STT name=Error recoverable=true");
  });
});
