// Copies a stored lead brief to a second slug, for testing a lead's page without its link
// counting the test as the lead's activity.
//   pnpm tsx --env-file-if-exists=.env scripts/copy-brief.ts <from-slug> <to-slug>
import { BRIEF_KEY, isValidSlug } from "../src/briefs.js";
import { kvFromEnv } from "../src/kv.js";

const [from, to] = process.argv.slice(2);
if (!from || !to || !isValidSlug(from) || !isValidSlug(to)) {
  console.error("usage: copy-brief.ts <from-slug> <to-slug>");
  process.exit(2);
}
const kv = kvFromEnv();
if (!kv) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN in .env first.");
  process.exit(2);
}
const raw = await kv.get(BRIEF_KEY(from));
if (!raw) {
  console.error(`no brief at ${from}`);
  process.exit(1);
}
await kv.set(BRIEF_KEY(to), raw);
console.log(`copied: https://getaiengineer.dev/aiyaz?ref=${to}`);
