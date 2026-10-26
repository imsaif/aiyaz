import { initializeLogger, log } from "@livekit/agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hideSpokenTextInLibraryLogs } from "../src/voice/log-redact.js";

// The LiveKit library logs what the visitor and Aiyaz said under "lk.pii.*" keys. The worker
// must print ids and numbers only, so those keys never reach stdout.
describe("library logs carry no spoken text", () => {
  let printed: string[] = [];
  beforeEach(() => {
    printed = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      printed.push(String(chunk));
      return true;
    });
    // As the job process does: a root logger, then a per-job child in the logger slot.
    initializeLogger({ pretty: false, level: "debug" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops lk.pii fields from a log line and keeps the ids", () => {
    hideSpokenTextInLibraryLogs();
    log().debug({ "lk.pii.transcript": "acme wants a support bot", speech_id: "speech_1" }, "interim transcript");
    const out = printed.join("");
    expect(out).toContain("interim transcript");
    expect(out).toContain("speech_1");
    expect(out).not.toContain("support bot");
    expect(out).not.toContain("lk.pii");
  });

  it("drops lk.pii fields bound on a child and a grandchild logger", () => {
    hideSpokenTextInLibraryLogs();
    const child = log().child({ "lk.pii.message": "acme wants a support bot", jobId: "AJ_test" });
    child.warn("received unexpected message");
    child.child({ "lk.pii.user_transcript": "budget is tight" }).info({ speech_id: "speech_2" }, "playout completed");
    const out = printed.join("");
    expect(out).toContain("AJ_test");
    expect(out).toContain("speech_2");
    expect(out).not.toContain("support bot");
    expect(out).not.toContain("budget");
  });

  it("is what log() returns afterwards, so components built later use it", () => {
    hideSpokenTextInLibraryLogs();
    const later = log();
    later.info({ "lk.pii.output": "the sprint is two weeks" }, "generation done");
    expect(printed.join("")).not.toContain("two weeks");
  });
});
