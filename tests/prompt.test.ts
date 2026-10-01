import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";
import { moneyAmounts } from "../src/guards.js";
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
  it("the pack contains no money amounts", () => {
    const pack = readFileSync(new URL("../prompts/knowledge/uae.v1.md", import.meta.url), "utf8");
    expect(moneyAmounts(pack)).toEqual([]);
  });
  it("the pack gives no language instruction, so it cannot override the Arabic switch", () => {
    const pack = readFileSync(new URL("../prompts/knowledge/uae.v1.md", import.meta.url), "utf8");
    expect(pack).not.toMatch(/answer in|reply in/i);
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
  });
  it("opens by asking what the company wants to do with AI", () => {
    expect(openingLine(v2, null)).toBe(
      "I'm Aiyaz, an AI agent from getaiengineer.dev. What is your company trying to do with AI?",
    );
  });
  it("keeps the brief-confirmation opener when there is a brief", () => {
    const brief = { company: "X", facts: [{ text: "launched an AI assistant", source: "s" }] };
    expect(openingLine(v2, brief)).toBe(
      "I'm Aiyaz, an AI agent from getaiengineer.dev. I read that you launched an AI assistant. Is that right?",
    );
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
    expect(p.text).not.toContain("you can only continue in English for now");
  });
  it("defaults to off", () => {
    expect(base.arabicEnabled).toBe(false);
  });
});
