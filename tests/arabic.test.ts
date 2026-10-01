import { describe, expect, it } from "vitest";
import { dialectVerdict, replyLabel, sentences } from "../evals/arabic/dialect-verdict.js";
import { parseVerdict } from "../evals/arabic/judge.js";

describe("dialect verdict", () => {
  it("passes when every reply is labelled Gulf", () => {
    expect(dialectVerdict(["DOH", "RIY", "MUS"], "fail")).toEqual({ ok: true, reason: "all Gulf" });
  });
  it("fails on MSA even in report mode", () => {
    const v = dialectVerdict(["DOH", "MSA"], "report");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("turn 1 labelled MSA");
  });
  it("reports another dialect without failing in report mode", () => {
    const v = dialectVerdict(["DOH", "JED"], "report");
    expect(v.ok).toBe(true);
    expect(v.reason).toBe("turn 1 labelled JED (report only)");
  });
  it("fails another dialect in fail mode", () => {
    expect(dialectVerdict(["ALE"], "fail").ok).toBe(false);
  });
});

describe("judge verdict parsing", () => {
  it("reads JSON wrapped in other text", () => {
    expect(parseVerdict('Here: {"score": 4, "reason": "طبيعي"} done')).toEqual({ score: 4, reason: "طبيعي" });
  });
  it("throws when there is no JSON or no score", () => {
    expect(() => parseVerdict("no json")).toThrow();
    expect(() => parseVerdict('{"reason": "x"}')).toThrow();
  });
});

describe("labelling a long reply", () => {
  it("splits on Arabic and Latin sentence ends and line breaks", () => {
    expect(sentences("أهلا. شلونك؟ زين!\nتمام")).toEqual(["أهلا.", "شلونك؟", "زين!", "تمام"]);
  });
  it("takes the most common sentence label", () => {
    expect(replyLabel(["MUS", "MSA", "DOH", "MUS"])).toBe("MUS");
  });
  it("counts the Gulf labels together against MSA", () => {
    expect(replyLabel(["DOH", "MUS", "RIY", "MSA", "MSA"])).toBe("DOH");
  });
  it("is MSA when most sentences are MSA", () => {
    expect(replyLabel(["MSA", "MSA", "DOH"])).toBe("MSA");
  });
});
