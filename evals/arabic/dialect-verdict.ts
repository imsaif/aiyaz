// CAMeL Tools city labels counted as Gulf. MADAR has no Dubai or Abu Dhabi label.
export const GULF_LABELS = new Set(["DOH", "RIY", "MUS"]);

// Any non-Gulf label, MSA included, fails only when the gate is "fail". CAMeL labelled
// clearly Gulf replies as MSA in live runs, so the judge and a human review decide.
export function dialectVerdict(labels: string[], gate: "fail" | "report"): { ok: boolean; reason: string } {
  const other = labels.findIndex((l) => !GULF_LABELS.has(l));
  if (other === -1) return { ok: true, reason: "all Gulf" };
  const ok = gate === "report";
  return { ok, reason: `turn ${other} labelled ${labels[other]}${ok ? " (report only)" : ""}` };
}

// CAMeL is unreliable on long text, so a reply is labelled sentence by sentence.
// Sentences with fewer than two Arabic words ("AED 25,000.", "Evals, monitoring.") are
// dropped: once Latin letters are stripped, CAMeL labels them MSA.
export function sentences(text: string): string[] {
  return (text.match(/[^.!?؟\n]+[.!?؟]?/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => (s.match(/[\u0600-\u06FF]+/g) ?? []).length >= 2);
}

const mostCommon = (labels: string[]): string => {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best = labels[0] ?? "";
  for (const l of labels) if ((counts.get(l) ?? 0) > (counts.get(best) ?? 0)) best = l;
  return best;
};

// The Gulf labels count together; a tie with another dialect goes to Gulf.
export function replyLabel(sentenceLabels: string[]): string {
  const gulf = sentenceLabels.filter((l) => GULF_LABELS.has(l));
  const other = sentenceLabels.filter((l) => !GULF_LABELS.has(l));
  const topOther = mostCommon(other);
  const topOtherCount = other.filter((l) => l === topOther).length;
  return gulf.length >= topOtherCount && gulf.length > 0 ? mostCommon(gulf) : topOther;
}
