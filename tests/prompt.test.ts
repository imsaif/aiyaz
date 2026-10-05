import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forCountry, loadSettings } from "../src/config.js";
import { disclosesAtOpening, moneyAmounts } from "../src/guards.js";
import { buildSystemPrompt, formatPrice, openingLine } from "../src/prompt.js";

const base = loadSettings();

describe("system prompt", () => {
  it("formats the price as AED 25,000", () => {
    expect(formatPrice(base.sprintPrice)).toBe("AED 25,000");
  });
  it("names the pack in the id and hashes it", () => {
    const withPack = buildSystemPrompt({ ...base, knowledgePack: "uae.v1" }, null);
    const without = buildSystemPrompt({ ...base, knowledgePack: null }, null);
    expect(withPack.id).toMatch(/^system\/v\d\+uae\.v1@[0-9a-f]{8}$/);
    expect(without.id).toMatch(/^system\/v\d@[0-9a-f]{8}$/);
    expect(withPack.id.split("@")[1]).not.toBe(without.id.split("@")[1]);
  });
  it("leaves no unfilled placeholders", () => {
    const p = buildSystemPrompt(base, null);
    expect(p.text).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe("v2 prompt", () => {
  const v2 = { ...base, promptVersion: "v2" };
  it("includes the UAE pack text, and leaves it out when knowledge is none", () => {
    expect(buildSystemPrompt({ ...v2, knowledgePack: "uae.v1" }, null).text).toContain("UAE market context");
    expect(buildSystemPrompt({ ...v2, knowledgePack: null }, null).text).not.toContain("UAE market context");
  });
  it("is about the AI initiative and quotes only AED 25,000", () => {
    const p = buildSystemPrompt(v2, null);
    expect(p.text).toContain("AI initiative");
    expect(p.text).toContain("AED 25,000");
    expect(p.text).not.toContain("$");
    expect(p.text).toContain("Everything you write is spoken");
  });
  it("opens by asking what the company wants to do with AI", () => {
    expect(openingLine(v2, null)).toBe(
      "I'm Aiyaz, an AI agent. What is your company trying to do with AI?",
    );
  });
  it("never speaks the forbidden name from a company name", () => {
    const brief = { company: "Imran's Bakery", facts: [{ text: "x", source: "s" }] };
    const line = openingLine({ ...v2, forbiddenNames: ["Imran"] }, brief);
    expect(line).not.toContain("Imran");
    expect(line).toContain("Hi the team Bakery");
  });
  it("greets the company by name and asks who is speaking when there is a brief", () => {
    const brief = { company: "  Acme ", facts: [{ text: "launched an AI assistant", source: "s" }] };
    const line = openingLine(v2, brief);
    expect(line).toBe("Hi Acme, I'm Aiyaz, an AI agent. Who am I speaking with?");
    expect(disclosesAtOpening(line, "Aiyaz")).toBe(true);
    expect(line).not.toContain("I read that");
  });
});

describe("Arabic switch", () => {
  const v2 = { ...base, promptVersion: "v2" };
  it("off: replies in English to other languages", () => {
    const p = buildSystemPrompt({ ...v2, arabicEnabled: false }, null);
    expect(p.text).toContain("you can only continue in English for now");
    expect(p.text).not.toContain("Gulf (Khaleeji) Arabic");
  });
  it("on: mirrors the caller in Gulf Arabic, not Modern Standard Arabic", () => {
    const p = buildSystemPrompt({ ...v2, arabicEnabled: true }, null);
    expect(p.text).toContain("Gulf (Khaleeji) Arabic");
    expect(p.text).toContain("not Modern Standard Arabic");
    expect(p.text).toContain("not Levantine");
    expect(p.text).toContain("In English replies, the price is AED 25,000");
    expect(p.text).toContain("شو not وش");
    expect(p.text).not.toContain("you can only continue in English for now");
  });
  it("defaults to off", () => {
    expect(base.arabicEnabled).toBe(false);
  });
});

describe("market packs", () => {
  const dir = new URL("../prompts/knowledge/", import.meta.url);
  const packs = readdirSync(dir).filter((f) => f.endsWith(".md"));
  it("include the general pack", () => {
    expect(packs).toContain("general.v1.md");
  });
  for (const file of packs) {
    const text = readFileSync(new URL(file, dir), "utf8");
    it(`${file} contains no money amounts`, () => {
      expect(moneyAmounts(text)).toEqual([]);
    });
    it(`${file} gives no language instruction, so it cannot override the Arabic switch`, () => {
      expect(text).not.toMatch(/answer in|reply in/i);
    });
  }
  it("the general pack names no country or region", () => {
    const text = readFileSync(new URL("general.v1.md", dir), "utf8");
    expect(text).not.toMatch(/UAE|Dubai|Emirat|India|Gulf|Saudi|AED|USD/);
  });
});

describe("v3 prompt by country", () => {
  it("is the default version", () => {
    expect(base.promptVersion).toBe("v3");
  });
  it("an India visitor gets USD 6,000, the general pack and no UAE framing", () => {
    const p = buildSystemPrompt(forCountry(base, "IN"), null);
    expect(p.id).toMatch(/^system\/v3\+general\.v1@[0-9a-f]{8}$/);
    expect(p.text).toContain("fixed price USD 6,000");
    expect(p.text).toContain("General context");
    expect(p.text).not.toMatch(/AED|UAE|Dubai/);
  });
  it("a UAE visitor and an unknown visitor get AED 25,000 and the UAE pack", () => {
    for (const c of ["AE", null]) {
      const p = buildSystemPrompt(forCountry(base, c), null);
      expect(p.text).toContain("a company in the UAE");
      expect(p.text).toContain("UAE market context");
      expect(p.text).toContain("fixed price AED 25,000");
    }
  });
  it("leaves no unfilled placeholders for any country", () => {
    for (const c of ["IN", "AE", null]) {
      expect(buildSystemPrompt(forCountry(base, c), null).text).not.toMatch(/\{\{\w+\}\}/);
    }
  });
  it("asks for the spoken reply in the same message as record_notes", () => {
    expect(buildSystemPrompt(base, null).text).toContain("in the same message as the tool call");
  });
  it("wraps up after two silent turns", () => {
    expect(buildSystemPrompt(base, null).text).toContain('"(no answer)" twice in a row');
  });
  it("keeps English only for a USD visitor even with the Arabic switch on", () => {
    const p = buildSystemPrompt({ ...forCountry(base, "IN"), arabicEnabled: true }, null);
    expect(p.text).toContain("you can only continue in English for now");
    expect(p.text).not.toContain("Gulf (Khaleeji) Arabic");
  });
  it("keeps spoken replies short, with room for a longer closing summary", () => {
    const p = buildSystemPrompt(base, null);
    expect(p.text).toContain("Keep every spoken reply to two or three short sentences");
    expect(p.text).toContain("The closing summary may be up to five short sentences.");
  });
  it("asks for end_conversation in the same message as the closing summary", () => {
    expect(buildSystemPrompt(base, null).text).toContain("Call `end_conversation` in the same message as the closing summary.");
  });
  it("tells Aiyaz to speak first and never send record_notes on its own", () => {
    const p = buildSystemPrompt(base, null);
    expect(p.text).toContain("Never send `record_notes` without a spoken reply.");
  });
  it("tells Aiyaz never to say the website address aloud", () => {
    const p = buildSystemPrompt(base, null);
    expect(p.text).toContain('Never say the website address aloud; say "the team" or "us" instead.');
  });
  it("opens like v2", () => {
    expect(openingLine(base, null)).toBe(
      "I'm Aiyaz, an AI agent. What is your company trying to do with AI?",
    );
  });
});

describe("lead-call email step", () => {
  const brief = { company: "Acme", facts: [{ text: "launched an AI support bot", source: "https://acme.test" }] };
  it("a lead call asks for the visitor's email before the summary and records it", () => {
    const text = buildSystemPrompt(base, brief).text;
    expect(text).toContain("ask for their email");
    expect(text).toContain("visitor_email");
    expect(text).toContain("the team");
    expect(text).not.toContain("Imran");
    expect(text).not.toContain("\u2014");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });
  it("a lead call records who they are, then asks the brief facts as questions", () => {
    const text = buildSystemPrompt(base, brief).text;
    expect(text).toContain("visitor_name");
    expect(text).toContain("visitor_role");
    expect(text).toContain("asked who they are");
    expect(text).not.toContain("first fact");
    expect(text).not.toContain("Imran");
    expect(text).not.toContain("\u2014");
  });
  it("a call with no brief does not ask for an email", () => {
    const text = buildSystemPrompt(base, null).text;
    expect(text).not.toContain("visitor_email");
    expect(text).not.toContain("ask for their email");
  });
});
