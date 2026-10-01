import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";
import { moneyAmounts } from "../src/guards.js";
import { buildSystemPrompt, formatPrice } from "../src/prompt.js";

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
  it("leaves no unfilled placeholders", () => {
    const p = buildSystemPrompt(base, null);
    expect(p.text).not.toMatch(/\{\{\w+\}\}/);
  });
});
