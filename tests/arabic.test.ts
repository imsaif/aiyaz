import { describe, expect, it } from "vitest";
import { dialectVerdict, replyLabel, sentences } from "../evals/arabic/dialect-verdict.js";
import { parseVerdict } from "../evals/arabic/judge.js";

describe("dialect verdict", () => {
  it("passes when every reply is labelled Gulf", () => {
    expect(dialectVerdict(["DOH", "RIY", "MUS"], "fail")).toEqual({ ok: true, reason: "all Gulf" });
  });
  it("reports MSA without failing in report mode, since CAMeL mislabels some Gulf text as MSA", () => {
    const v = dialectVerdict(["DOH", "MSA"], "report");
    expect(v.ok).toBe(true);
    expect(v.reason).toBe("turn 1 labelled MSA (report only)");
  });
  it("fails MSA in fail mode", () => {
    expect(dialectVerdict(["MSA"], "fail").ok).toBe(false);
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
  it("reads the score from an answer cut off before the closing brace", () => {
    expect(parseVerdict('{"score": 4, "reason": "الرد يستخدم لهجة خليجية')).toEqual({ score: 4, reason: "الرد يستخدم لهجة خليجية" });
  });
  it("throws when there is no JSON or no score", () => {
    expect(() => parseVerdict("no json")).toThrow();
    expect(() => parseVerdict('{"reason": "x"}')).toThrow();
  });
});

describe("labelling a long reply", () => {
  it("splits on Arabic and Latin sentence ends and line breaks", () => {
    expect(sentences("أهلا وسهلا. شلونك اليوم؟ زين والله!\nتمام الحمدلله")).toEqual(["أهلا وسهلا.", "شلونك اليوم؟", "زين والله!", "تمام الحمدلله"]);
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

describe("only Arabic sentences are labelled", () => {
  it("drops sentences with fewer than two Arabic words", () => {
    expect(sentences("نقدر نسوي هذا. Evals, monitoring. AED 25,000. 25 ألف درهم")).toEqual(["نقدر نسوي هذا.", "25 ألف درهم"]);
  });
});
