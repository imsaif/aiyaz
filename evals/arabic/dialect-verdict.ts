// CAMeL Tools city labels counted as Gulf. MADAR has no Dubai or Abu Dhabi label.
export const GULF_LABELS = new Set(["DOH", "RIY", "MUS"]);

// MSA always fails: drifting into formal Arabic is the main risk, and CAMeL
// detects MSA reliably. Other non-Gulf labels fail only when the gate is "fail".
export function dialectVerdict(labels: string[], gate: "fail" | "report"): { ok: boolean; reason: string } {
  const msa = labels.indexOf("MSA");
  if (msa !== -1) return { ok: false, reason: `turn ${msa} labelled MSA` };
  const other = labels.findIndex((l) => !GULF_LABELS.has(l));
  if (other === -1) return { ok: true, reason: "all Gulf" };
  const ok = gate === "report";
  return { ok, reason: `turn ${other} labelled ${labels[other]}${ok ? " (report only)" : ""}` };
}

// CAMeL is unreliable on long text, so a reply is labelled sentence by sentence.
export function sentences(text: string): string[] {
  return (text.match(/[^.!?؟\n]+[.!?؟]?/g) ?? []).map((s) => s.trim()).filter(Boolean);
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
