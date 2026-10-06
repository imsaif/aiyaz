import { afterEach, describe, expect, it } from "vitest";
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

describe("voice provider setting", () => {
  const withTts = (value: string | undefined, fn: () => void) => {
    const saved = process.env.AIYAZ_TTS;
    try {
      if (value === undefined) delete process.env.AIYAZ_TTS;
      else process.env.AIYAZ_TTS = value;
      fn();
    } finally {
      if (saved === undefined) delete process.env.AIYAZ_TTS;
      else process.env.AIYAZ_TTS = saved;
    }
  };
  it("accepts elevenlabs and cartesia, and defaults to elevenlabs when unset or empty", () => {
    withTts("cartesia", () => expect(loadSettings().ttsProvider).toBe("cartesia"));
    withTts("elevenlabs", () => expect(loadSettings().ttsProvider).toBe("elevenlabs"));
    withTts(undefined, () => expect(loadSettings().ttsProvider).toBe("elevenlabs"));
    withTts("", () => expect(loadSettings().ttsProvider).toBe("elevenlabs"));
  });
  it("refuses an unknown provider instead of quietly using elevenlabs", () => {
    for (const v of ["Cartesia", "eleven", "google"]) {
      withTts(v, () => expect(() => loadSettings(), v).toThrow(/AIYAZ_TTS/));
    }
  });
});

describe("voice model setting", () => {
  const withModel = (value: string | undefined, fn: () => void) => {
    const saved = process.env.AIYAZ_TTS_MODEL;
    try {
      if (value === undefined) delete process.env.AIYAZ_TTS_MODEL;
      else process.env.AIYAZ_TTS_MODEL = value;
      fn();
    } finally {
      if (saved === undefined) delete process.env.AIYAZ_TTS_MODEL;
      else process.env.AIYAZ_TTS_MODEL = saved;
    }
  };
  it("is empty (provider default) when unset, and passes any value through", () => {
    withModel(undefined, () => expect(loadSettings().ttsModel).toBe(""));
    withModel("eleven_flash_v2_5", () => expect(loadSettings().ttsModel).toBe("eleven_flash_v2_5"));
  });
});

describe("LiveKit Cloud recording setting", () => {
  const saved = process.env.AIYAZ_LIVEKIT_RECORD;
  afterEach(() => {
    if (saved === undefined) delete process.env.AIYAZ_LIVEKIT_RECORD;
    else process.env.AIYAZ_LIVEKIT_RECORD = saved;
  });
  const withRecord = (value: string | undefined) => {
    if (value === undefined) delete process.env.AIYAZ_LIVEKIT_RECORD;
    else process.env.AIYAZ_LIVEKIT_RECORD = value;
    return loadSettings().livekitRecord;
  };
  it("is off unless AIYAZ_LIVEKIT_RECORD is exactly true", () => {
    expect(withRecord(undefined)).toBe(false);
    expect(withRecord("")).toBe(false);
    expect(withRecord("false")).toBe(false);
    expect(withRecord("yes")).toBe(false);
    expect(withRecord("true")).toBe(true);
  });
});
