import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Row = { persona: string; turn: number; text: string; dialect?: { label: string }; judge?: { score: number; reason: string } };

if (!existsSync("arabic-review.jsonl")) {
  console.error("No arabic-review.jsonl. Run: AIYAZ_ARABIC=true pnpm evals");
  process.exit(1);
}
const rows = readFileSync("arabic-review.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row);
const merged = new Map<string, Row>();
for (const r of rows) {
  const key = `${r.persona}#${r.text}`;
  merged.set(key, { ...merged.get(key), ...r });
}
const lines = [
  "# Aiyaz Gulf Arabic review",
  "",
  "For each reply mark: natural Gulf phrasing (yes/no), respectful tone (yes/no), would a Dubai CEO keep talking (yes/no), and a fix if needed.",
  "",
];
for (const r of merged.values()) {
  lines.push(
    `## ${r.persona}, reply ${r.turn + 1}`,
    "",
    r.text,
    "",
    `Dialect: ${r.dialect?.label ?? "?"} · Judge: ${r.judge?.score ?? "?"}/5, ${r.judge?.reason ?? ""}`,
    "",
    "Natural Gulf: ___  Respectful: ___  Keeps talking: ___  Fix: ___",
    "",
  );
}
writeFileSync("arabic-review.md", lines.join("\n"));
console.log(`Wrote arabic-review.md with ${merged.size} replies`);
