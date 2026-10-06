// Pushes private lead briefs from the tracker to Upstash. Dry run unless --write.
//   AIYAZ_LEADS_FILE=/path/outside/this/repo/tracker.xlsx pnpm briefs              prints the plan
//   AIYAZ_LEADS_FILE=... pnpm briefs --only "<company>" --write                    stores one brief
//   pnpm briefs --acme-test --write                                               stores the made-up Acme brief
import { spawnSync } from "node:child_process";
import { BRIEF_KEY } from "../src/briefs.js";
import { MemoryKV, kvFromEnv } from "../src/kv.js";
import { ACME_TEST, planBriefs, writeBriefs, type LeadRow } from "./brief-rows.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1]?.toLowerCase() : undefined;
if (onlyAt >= 0 && (!only || only.startsWith("--"))) {
  console.error('--only needs a company name, for example: --only "<company>"');
  process.exit(2);
}
const kv = kvFromEnv();
if (write && !kv) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN (from the getaiengineer Vercel project) in .env first.");
  process.exit(2);
}

if (args.includes("--acme-test")) {
  if (write) await kv!.set(BRIEF_KEY(ACME_TEST.slug), JSON.stringify(ACME_TEST.brief));
  console.log(`${write ? "wrote" : "would write"} ${BRIEF_KEY(ACME_TEST.slug)}: https://getaiengineer.dev/aiyaz?ref=${ACME_TEST.slug}`);
  process.exit(0);
}

const file = process.env.AIYAZ_LEADS_FILE;
if (!file) {
  console.error("Set AIYAZ_LEADS_FILE to the lead tracker .xlsx (kept outside this repo).");
  process.exit(2);
}
const read = spawnSync("python3", ["scripts/read-leads.py", file], { encoding: "utf8" });
if (read.status !== 0) {
  console.error(read.stderr);
  process.exit(1);
}
const rows = JSON.parse(read.stdout) as LeadRow[];
const picked = only ? rows.filter((r) => r.company.toLowerCase() === only) : rows;
if (only && picked.length === 0) {
  console.error(`--only matched no company: ${args[onlyAt + 1]}`);
  process.exit(1);
}

const plan = await planBriefs(picked, kv ?? new MemoryKV());
for (const p of plan) {
  const link = p.skipped ?? (p.brief ? `https://getaiengineer.dev/aiyaz?ref=${p.slug}${p.isNew ? " (new link)" : ""}` : "no usable facts, skipped");
  console.log(`\n${p.company}: ${link}`);
  for (const f of p.brief?.facts ?? []) console.log(`  keep ${f.text}`);
  for (const d of p.dropped) console.log(`  drop ${d}`);
}
if (write) console.log(`\nwrote ${await writeBriefs(plan, kv!)} briefs`);
else console.log("\nDry run. Add --write to store these briefs.");
