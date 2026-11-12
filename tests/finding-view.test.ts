import { describe, expect, it } from "vitest";
import { withViews } from "../scripts/brief-rows.js";
import { toBrief, toView } from "../src/briefs.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { loadSettings } from "../src/config.js";

// Added 2026-11-12: a finding can carry its page layout. Page-only; Aiyaz still speaks the text.
const view = {
  label: "Patient safety",
  icon: "safety",
  checked: "does it ask safety questions first?",
  headline: "It sent a symptom to a specialist without a safety question",
  how: "It named a department and two doctors straight away.",
  question: "What should it ask first?",
  quote: { who: "AI agent, 2:13", text: "the right department is cardiology" },
  clip: { from: 0, to: 43 },
  proof: "/e/acme-7k2q/1.jpg",
};
const base = {
  company: "Acme",
  facts: [
    { text: "runs an AI booking assistant", source: "acme.example" },
    { text: "a symptom went straight to a specialist", source: "our test", kind: "finding", view },
  ],
  summary: "AI agent 7+ min · your team about 1.5 min",
};

describe("finding view", () => {
  it("keeps a full view and the summary line", () => {
    const b = toBrief(base);
    expect(b?.facts[1]?.view).toEqual(view);
    expect(b?.summary).toBe("AI agent 7+ min · your team about 1.5 min");
  });

  it("drops a view with an unknown icon or a missing field, but keeps the finding", () => {
    expect(toView({ ...view, icon: "rocket" })).toBeUndefined();
    const { headline: _h, ...noHeadline } = view;
    const b = toBrief({ ...base, facts: [base.facts[0], { ...base.facts[1], view: noHeadline }] });
    expect(b?.facts[1]?.text).toBe("a symptom went straight to a specialist");
    expect(b?.facts[1]?.view).toBeUndefined();
  });

  it("drops money, off-site proof and a bad clip, keeping the rest", () => {
    expect(toView({ ...view, how: "It quoted AED 25,000." })).toBeUndefined();
    const v = toView({ ...view, proof: "https://evil.example/x.jpg", clip: { from: 50, to: 10 }, quote: { who: "x", text: 5 } });
    expect(v?.proof).toBeUndefined();
    expect(v?.clip).toBeUndefined();
    expect(v?.quote).toBeUndefined();
    expect(v?.headline).toBe(view.headline);
  });

  it("never attaches a view to a fact about them", () => {
    const b = toBrief({ ...base, facts: [{ ...base.facts[0], view }, base.facts[1]] });
    expect(b?.facts[0]?.view).toBeUndefined();
  });

  it("pairs views with findings in order, skipping facts about them", () => {
    const facts = [
      { text: "a", source: "s" },
      { text: "b", source: "s", kind: "finding" as const },
      { text: "c", source: "s", kind: "finding" as const },
    ];
    const out = withViews(facts, ["v1", "v2"]) as { view?: unknown }[];
    expect(out.map((f) => f.view)).toEqual([undefined, "v1", "v2"]);
  });

  it("does not put view fields into what Aiyaz is told", () => {
    const text = buildSystemPrompt(loadSettings(), toBrief(base)).text;
    expect(text).toContain("a symptom went straight to a specialist");
    expect(text).not.toContain("does it ask safety questions first?");
  });
});
