import { describe, expect, it } from "vitest";
import { mentionsForbiddenName, moneyAmounts, onlySprintPrice, scrubForbiddenNames } from "../src/guards.js";
import { costUsd } from "../src/prices.js";
import { applyNotesUpdate, emptyNotes } from "../src/notes.js";

describe("forbidden names", () => {
  it("replaces the name and its possessive with 'the team'", () => {
    expect(scrubForbiddenNames("Imran will call. It's Imran's team.", ["Imran"])).toBe(
      "the team will call. It's the team team.",
    );
  });
  it("is case-insensitive and leaves other words alone", () => {
    expect(mentionsForbiddenName("ask IMRAN", ["Imran"])).toBe(true);
    expect(mentionsForbiddenName("Imranovich is a surname", ["Imran"])).toBe(false);
  });
});

describe("only the sprint price", () => {
  it("accepts the ways $3,000 is usually written", () => {
    for (const t of ["It costs $3,000.", "$3000 fixed", "3,000 dollars", "USD 3,000", "no price here"]) {
      expect(onlySprintPrice(t, 3000), t).toBe(true);
    }
  });
  it("rejects any other amount, echoed figures and other currencies", () => {
    for (const t of ["$3k", "$100 an hour", "you make $20,000 MRR", "AED 8,000", "₹2,50,000", "$3,000 or $2,500"]) {
      expect(onlySprintPrice(t, 3000), t).toBe(false);
    }
  });
  it("finds amounts in several formats", () => {
    expect(moneyAmounts("$5 and 40 dollars and €30")).toHaveLength(3);
  });
});

describe("cost", () => {
  it("prices Sonnet 5 at $2 in and $10 out per million tokens", () => {
    expect(costUsd("claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12);
  });
  it("throws on an unknown model instead of counting it as free", () => {
    expect(() => costUsd("claude-mystery", { input_tokens: 1, output_tokens: 1 })).toThrow();
  });
});

describe("notes", () => {
  const brief = { company: "Acme", facts: [{ text: "launched an AI support bot", source: "https://acme.test" }] };
  it("starts every brief fact as unconfirmed", () => {
    expect(emptyNotes(brief).unconfirmedFacts).toEqual(["launched an AI support bot"]);
  });
  it("confirms only facts that were in the brief", () => {
    const n = applyNotesUpdate(emptyNotes(brief), {
      confirm_facts: ["launched an AI support bot", "raised $50M"],
    });
    expect(n.confirmedFacts).toEqual(["launched an AI support bot"]);
    expect(n.unconfirmedFacts).toEqual([]);
  });
  it("drops rejected facts without confirming them", () => {
    const n = applyNotesUpdate(emptyNotes(brief), { reject_facts: ["launched an AI support bot"] });
    expect(n.confirmedFacts).toEqual([]);
    expect(n.unconfirmedFacts).toEqual([]);
  });
});
