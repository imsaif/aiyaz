import { describe, expect, it } from "vitest";
import { PlayoutTracker, type SpeechLike } from "../src/voice/playout.js";

function fakeSpeech(interrupted: boolean, played?: string) {
  let done: ((s: SpeechLike) => void) | undefined;
  const speech: SpeechLike = {
    interrupted,
    chatItems: played === undefined ? [] : [{ type: "message", role: "assistant", textContent: played }],
    addDoneCallback: (cb) => (done = cb),
  };
  return { speech, finish: () => done?.(speech) };
}

describe("PlayoutTracker", () => {
  it("reports what played of a cut-off reply, for the visitor turn it answered", () => {
    const reports: [string, string][] = [];
    const tracker = new PlayoutTracker((turn, played) => reports.push([turn, played]));
    tracker.userTurn("u1");
    const s = fakeSpeech(true, "We build");
    tracker.speechCreated({ source: "generate_reply", speechHandle: s.speech });
    s.finish();
    expect(reports).toEqual([["u1", "We build"]]);
  });
  it("reports an empty string when nothing played", () => {
    const reports: [string, string][] = [];
    const tracker = new PlayoutTracker((turn, played) => reports.push([turn, played]));
    tracker.userTurn("u1");
    const s = fakeSpeech(true);
    tracker.speechCreated({ source: "generate_reply", speechHandle: s.speech });
    s.finish();
    expect(reports).toEqual([["u1", ""]]);
  });
  it("says nothing for a reply that played in full, for say() lines, or without a visitor turn", () => {
    const reports: [string, string][] = [];
    const tracker = new PlayoutTracker((turn, played) => reports.push([turn, played]));
    const said = fakeSpeech(true, "Bye");
    tracker.speechCreated({ source: "say", speechHandle: said.speech });
    said.finish();
    const orphan = fakeSpeech(true, "x");
    tracker.speechCreated({ source: "generate_reply", speechHandle: orphan.speech });
    orphan.finish();
    tracker.userTurn("u2");
    const full = fakeSpeech(false, "All of it.");
    tracker.speechCreated({ source: "generate_reply", speechHandle: full.speech });
    full.finish();
    expect(reports).toEqual([]);
  });
  it("links each reply to its own turn, even when an earlier one finishes later", () => {
    const reports: [string, string][] = [];
    const tracker = new PlayoutTracker((turn, played) => reports.push([turn, played]));
    tracker.userTurn("u1");
    const a = fakeSpeech(true, "");
    tracker.speechCreated({ source: "generate_reply", speechHandle: a.speech });
    tracker.userTurn("u2");
    const b = fakeSpeech(true, "Hel");
    tracker.speechCreated({ source: "generate_reply", speechHandle: b.speech });
    b.finish();
    a.finish();
    expect(reports).toEqual([["u2", "Hel"], ["u1", ""]]);
  });
});
