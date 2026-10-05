import { describe, expect, it } from "vitest";
import { mentionsForbiddenName, moneyAmounts, onlySprintPrice, scrubForbiddenNames, toLatinDigits } from "../src/guards.js";
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
  const price = { amount: 25000, currency: "AED" as const };
  it("accepts the ways AED 25,000 is written, in English and Arabic", () => {
    for (const t of [
      "It costs AED 25,000.",
      "25,000 AED fixed",
      "25,000 dirhams",
      "AED 25000",
      "السعر ٢٥٬٠٠٠ درهم",
      "السعر 25 ألف درهم",
      "السعر 25 الف درهم",
      "درهم ٢٥٬٠٠٠",
      "Dhs 25,000",
      "no price here",
    ]) {
      expect(onlySprintPrice(t, price), t).toBe(true);
    }
  });
  it("rejects other amounts, other currencies, suffixes and conversions", () => {
    for (const t of [
      "$3,000",
      "AED 25k",
      "AED 8,000",
      "about $6,800",
      "25,000 dollars",
      "AED 25,000, about $6,800",
      "٨٬٠٠٠ درهم",
      "25 ألف دولار",
      "₹2,50,000",
      "AED 25,000, about 6,800 US dollars",
      "10 آلاف درهم",
      "8 الف درهم",
      "درهم ٨٬٠٠٠",
      "8,000 دراهم",
      "Dh 8,000",
      "Dhs 8,000",
      "ثمانية آلاف درهم",
      "roughly seven thousand dollars",
    ]) {
      expect(onlySprintPrice(t, price), t).toBe(false);
    }
  });
  it("finds amounts in several formats", () => {
    expect(moneyAmounts("$5 and 40 dollars and €30")).toHaveLength(3);
    expect(moneyAmounts("٢٥٬٠٠٠ درهم و 10 دولار")).toHaveLength(2);
  });
  it("converts Arabic-Indic digits and separators", () => {
    expect(toLatinDigits("٢٥٬٠٠٠٫٥")).toBe("25,000.5");
  });
});

describe("only the sprint price, USD visitor", () => {
  const usd = { amount: 6000, currency: "USD" as const };
  it("accepts the ways USD 6,000 is written", () => {
    for (const t of [
      "It costs $6,000.",
      "USD 6,000 fixed",
      "US$6,000",
      "6,000 dollars",
      "6,000 US dollars",
      "6,000 USD",
      "6 thousand dollars",
      "no price here",
    ]) {
      expect(onlySprintPrice(t, usd), t).toBe(true);
    }
  });
  it("rejects other amounts, AED, suffixes and conversions", () => {
    for (const t of [
      "$3,000",
      "$6k",
      "USD 6,000.50",
      "AED 25,000",
      "6,000 AED",
      "$6,000, about AED 22,000",
      "six thousand dollars",
      "8 thousand dollars",
      "₹5,00,000",
      "€6,000",
    ]) {
      expect(onlySprintPrice(t, usd), t).toBe(false);
    }
  });
  it("an AED visitor still may not hear dollars, even the USD price", () => {
    const aed = { amount: 25000, currency: "AED" as const };
    expect(onlySprintPrice("$6,000", aed)).toBe(false);
    expect(onlySprintPrice("25 thousand dirhams", aed)).toBe(true);
    expect(onlySprintPrice("8 thousand dirhams", aed)).toBe(false);
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
