import { describe, expect, it } from "vitest";
import { MemoryKV, UpstashKV, kvFromEnv } from "../src/kv.js";

describe("MemoryKV", () => {
  it("gets, sets with expiry and adds floats", async () => {
    const kv = new MemoryKV();
    await kv.set("a", "1", 60);
    expect(await kv.get("a")).toBe("1");
    expect(kv.ttl.get("a")).toBe(60);
    expect(await kv.incrByFloat("s", 0.25)).toBeCloseTo(0.25);
    expect(await kv.incrByFloat("s", -1)).toBeCloseTo(-0.75);
    expect(await kv.get("missing")).toBeNull();
  });
});

describe("UpstashKV", () => {
  it("sends commands to the REST pipeline with the bearer token", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify([{ result: "1.5" }, { result: 1 }]));
    }) as unknown as typeof fetch;
    const kv = new UpstashKV("https://kv.example", "tok", fake);
    expect(await kv.incrByFloat("aiyaz:spend:2026-10-05", 0.5, 172800)).toBe(1.5);
    expect(sent[0]!.url).toBe("https://kv.example/pipeline");
    expect((sent[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual([
      ["INCRBYFLOAT", "aiyaz:spend:2026-10-05", "0.5"],
      ["EXPIRE", "aiyaz:spend:2026-10-05", "172800"],
    ]);
  });
  it("throws on an error so callers can fall back", async () => {
    const fake = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(new UpstashKV("https://kv.example", "tok", fake).get("x")).rejects.toThrow(/Upstash 500/);
  });
  it("is null when the env has no Upstash settings", () => {
    expect(kvFromEnv({})).toBeNull();
    expect(kvFromEnv({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" })).toBeInstanceOf(UpstashKV);
  });
});
