import { describe, expect, it } from "vitest";
import { forCountry, loadSettings, normCountry, priceKey } from "../src/config.js";

const base = loadSettings();

describe("country", () => {
  // The same table is tested on the site in tests/price.test.js. Change both or neither.
  it("maps country codes the same way as the site", () => {
    const table: [string | null, "AE" | "other" | "unknown"][] = [
      ["AE", "AE"],
      ["ae", "AE"],
      ["IN", "other"],
      ["US", "other"],
      ["GB", "other"],
      [" in ", "other"],
      ["", "unknown"],
      [null, "unknown"],
      ["UAE", "unknown"],
    ];
    for (const [country, key] of table) expect(priceKey(country), String(country)).toBe(key);
  });
  it("normalises country codes and drops anything that is not two letters", () => {
    expect(normCountry(" in ")).toBe("IN");
    expect(normCountry("UAE")).toBeNull();
    expect(normCountry(undefined)).toBeNull();
  });
  it("an India visitor gets USD 6,000 and the general pack", () => {
    const s = forCountry(base, "IN");
    expect(s.sprintPrice).toEqual({ amount: 6000, currency: "USD" });
    expect(s.knowledgePack).toBe("general.v1");
    expect(s.country).toBe("IN");
  });
  it("a UAE visitor and an unknown visitor get AED 25,000 and the UAE pack", () => {
    for (const c of ["AE", null]) {
      const s = forCountry(base, c);
      expect(s.sprintPrice).toEqual({ amount: 25000, currency: "AED" });
      expect(s.knowledgePack).toBe("uae.v1");
    }
  });
  it("defaults to the unknown visitor, so text chat and old evals keep AED", () => {
    expect(base.sprintPrice).toEqual({ amount: 25000, currency: "AED" });
    expect(base.knowledgePack).toBe("uae.v1");
    expect(base.country).toBeNull();
  });
  it("does not change the settings it was given", () => {
    forCountry(base, "IN");
    expect(base.sprintPrice.currency).toBe("AED");
  });
});
