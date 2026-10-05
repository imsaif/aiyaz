import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRIEF_KEY, isValidSlug, loadBrief } from "../src/briefs.js";
import { MemoryKV, type KV } from "../src/kv.js";
import { parseCallMeta } from "../src/voice/meta.js";

const fact = { text: "launched an AI assistant that answers customer questions", source: "https://acme.example/news" };
const store = async (value: unknown, slug = "acme-7k2q") => {
  const kv = new MemoryKV();
  await kv.set(BRIEF_KEY(slug), typeof value === "string" ? value : JSON.stringify(value));
  return kv;
};

describe("briefs", () => {
  it("loads a stored brief by slug", async () => {
    const brief = await loadBrief(await store({ company: "Acme", facts: [fact] }), "acme-7k2q");
    expect(brief).toEqual({ company: "Acme", facts: [fact] });
  });
  it("runs as a homepage call for a missing, unknown or malformed slug, or no store", async () => {
    const kv = await store({ company: "Acme", facts: [fact] });
    expect(await loadBrief(kv, null)).toBeNull();
    expect(await loadBrief(kv, "nope-1234")).toBeNull();
    expect(await loadBrief(null, "acme-7k2q")).toBeNull();
    for (const bad of ["../etc", "a/b", "", "A B", "x".repeat(41), "-acme"]) expect(isValidSlug(bad), bad).toBe(false);
    expect(isValidSlug("acme-7k2q")).toBe(true);
  });
  it("drops facts with money amounts or no source", async () => {
    const brief = await loadBrief(
      await store({
        company: "Acme",
        facts: [
          { text: "raised USD 12M in a Series A", source: "https://acme.example/press" },
          { text: "closed a 40 million dollar round", source: "https://acme.example/press" },
          { text: "hired a data team", source: "" },
          fact,
        ],
      }),
      "acme-7k2q",
    );
    expect(brief?.facts).toEqual([fact]);
  });
  it("drops money figures written without a currency symbol, in words or in Indian units", async () => {
    const amounts = [
      "raised 12M", "raised 40m", "a 2B valuation", "raised 12 mn", "grew to 5k", "valued at 3 bn",
      "raised 50 crore", "raised 20 lakh", "raised 20 lakhs", "twelve million dollars", "raised five million",
      "worth two billion", "a seven figures deal", "an eight-figure round", "raised 1.5 Cr",
    ];
    const facts = amounts.map((text) => ({ text, source: "https://acme.example/press" }));
    const plain = { text: "Acme sells software to clinics", source: "https://acme.example/about" };
    const brief = await loadBrief(await store({ company: "Acme", facts: [...facts, plain] }), "acme-7k2q");
    expect(brief?.facts).toEqual([plain]);
  });
  it("is null when no usable fact is left, so the call runs as a homepage call", async () => {
    expect(await loadBrief(await store({ company: "Acme", facts: [{ text: "raised $5M", source: "s" }] }), "acme-7k2q")).toBeNull();
  });
  it("keeps at most 8 facts of at most 300 characters", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `runs pilot number ${i}`, source: "s" }));
    const brief = await loadBrief(
      await store({ company: "Acme", facts: [{ text: "x".repeat(301), source: "s" }, ...many] }),
      "acme-7k2q",
    );
    expect(brief?.facts).toHaveLength(8);
    expect(brief?.facts[0]!.text).toBe("runs pilot number 0");
  });
  it("never crashes a call on bad data or a store error", async () => {
    expect(await loadBrief(await store("{not json"), "acme-7k2q")).toBeNull();
    expect(await loadBrief(await store({ facts: [fact] }), "acme-7k2q")).toBeNull();
    expect(await loadBrief(await store({ company: "x".repeat(81), facts: [fact] }), "acme-7k2q")).toBeNull();
    const broken: KV = {
      get: async () => {
        throw new Error("down");
      },
      set: async () => {},
      incrByFloat: async () => 0,
    };
    expect(await loadBrief(broken, "acme-7k2q")).toBeNull();
  });
  it("never reads files: briefs come only from the store", () => {
    const source = readFileSync(new URL("../src/briefs.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:fs|readFile|AIYAZ_BRIEFS/);
  });
});

describe("call metadata", () => {
  it("reads country, slug, email and the reservation from the token metadata", () => {
    expect(
      parseCallMeta('{"country":"in","slug":"acme-7k2q","email":" A@B.co ","day":"2026-10-05","reservedUsd":0.75}'),
    ).toEqual({
      country: "IN",
      slug: "acme-7k2q",
      email: "a@b.co",
      day: "2026-10-05",
      reservedUsd: 0.75,
    });
    expect(parseCallMeta('{"reservedUsd":0}').reservedUsd).toBe(0);
  });
  it("drops a malformed reservation day or amount", () => {
    for (const day of ['"2026-1-5"', '"2026-10-05T00:00"', '"yesterday"', "20261005", "null"]) {
      expect(parseCallMeta(`{"day":${day}}`).day, day).toBeNull();
    }
    for (const amount of ['"1"', "-1", "1e999", "true", "null", "[1]"]) {
      expect(parseCallMeta(`{"reservedUsd":${amount}}`).reservedUsd, amount).toBeNull();
    }
  });
  it("treats anything missing or malformed as unknown", () => {
    const none = { country: null, slug: null, email: null, day: null, reservedUsd: null };
    for (const raw of [undefined, null, "", "not json", "[]", "null"]) expect(parseCallMeta(raw), String(raw)).toEqual(none);
    expect(parseCallMeta('{"country":"UAE","slug":"../x","email":"nope"}')).toEqual(none);
  });
});
