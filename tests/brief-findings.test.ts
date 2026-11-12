import { describe, expect, it } from "vitest";
import { parseFactsCell } from "../scripts/brief-rows.js";
import { knownFromBrief } from "../src/board.js";
import { toBrief } from "../src/briefs.js";
import { loadSettings } from "../src/config.js";
import { emptyNotes, type Brief } from "../src/notes.js";
import { buildSystemPrompt } from "../src/prompt.js";

// Added 2026-10-26: a brief can carry what we saw testing their product ("findings") and the
// cards our research already answers. Findings are ours, never facts for them to confirm.
const brief: Brief = {
  company: "Acme",
  facts: [
    { text: "launched an AI assistant for clinics", source: "acme.example/ai" },
    { text: "a date written day-first was read as month-first", source: "our test", kind: "finding" },
  ],
  cards: { aiFeature: "drafts appointment reminders", users: "clinics", stage: "live" },
};

describe("brief findings and cards", () => {
  it("parses a finding: prefix and keeps plain facts as facts about them", () => {
    const { facts } = parseFactsCell("launched an AI assistant (acme.example); finding: drops bounced cheques (our test)");
    expect(facts).toEqual([
      { text: "launched an AI assistant", source: "acme.example" },
      { text: "drops bounced cheques", source: "our test", kind: "finding" },
    ]);
  });

  it("keeps kind and valid cards, and drops a stage the model could not record", () => {
    const b = toBrief({ ...brief, cards: { ...brief.cards, stage: "scaling" } });
    expect(b?.facts[1]?.kind).toBe("finding");
    expect(b?.cards).toEqual({ aiFeature: "drafts appointment reminders", users: "clinics" });
  });

  it("drops a card that carries money", () => {
    expect(toBrief({ ...brief, cards: { users: "clinics paying AED 90,000" } })?.cards).toBeUndefined();
  });

  it("prefills cards but never puts findings among the facts to confirm or on the board", () => {
    const n = emptyNotes(brief);
    expect(n.aiFeature).toBe("drafts appointment reminders");
    expect(n.stage).toBe("live");
    expect(n.unconfirmedFacts).toEqual(["launched an AI assistant for clinics"]);
    expect(knownFromBrief(brief).map((f) => f.text)).toEqual(["launched an AI assistant for clinics"]);
  });

  it("tells the model findings are our observations, not facts to confirm", () => {
    const text = buildSystemPrompt(loadSettings(), brief).text;
    expect(text).toContain("These are OUR observations");
    expect(text).toContain("Raise at most two");
    expect(text).toContain('What AI should do: "drafts appointment reminders"');
    const facts = text.slice(text.indexOf("Facts about them"), text.indexOf("Cards our research"));
    expect(facts).not.toContain("thousand times");
  });
});

describe("brief evidence", () => {
  const ev = [{ src: "/e/acme-7k2q/1.png", caption: "the review screen after our upload" }];
  it("keeps evidence and a test file on the site's /e/ path only", () => {
    const b = toBrief({ ...brief, evidence: [...ev, { src: "https://evil.example/x.png", caption: "x" }], file: { href: "/e/acme-7k2q/test.csv", label: "our test rent roll" } });
    expect(b?.evidence).toEqual(ev);
    expect(b?.file).toEqual({ href: "/e/acme-7k2q/test.csv", label: "our test rent roll" });
    expect(toBrief({ ...brief, file: { href: "/elsewhere.csv", label: "x" } })?.file).toBeUndefined();
  });

  it("tells the model to point to the screenshots, by number", () => {
    const text = buildSystemPrompt(loadSettings(), { ...brief, evidence: ev, file: { href: "/e/acme-7k2q/t.csv", label: "our test rent roll" } }).text;
    expect(text).toContain("Screenshot 1: the review screen after our upload");
    expect(text).toContain("A file they can download and run in their own product: our test rent roll");
  });
});

describe("findings on a revisit and when asked", () => {
  const saved = { notes: emptyNotes(brief), known: [] };
  it("a resumed call still carries our findings and proof", () => {
    const text = buildSystemPrompt(loadSettings(), null, { saved, proof: { ...brief, evidence: [{ src: "/e/acme-7k2q/1.png", caption: "the review screen" }] } }).text;
    expect(text).toContain("Finding: a date written day-first was read as month-first");
    expect(text).toContain("Screenshot 1: the review screen");
    expect(text).toContain("raise the strongest one first");
  });

  it("leads with a finding and never claims to have found nothing", () => {
    const text = buildSystemPrompt(loadSettings(), brief).text;
    expect(text).toContain("Lead with one");
    expect(text).toContain("Never say you have nothing");
  });

  it("a resumed call without a lead brief has no findings section", () => {
    expect(buildSystemPrompt(loadSettings(), null, { saved }).text).not.toContain("OUR observations");
  });
});
