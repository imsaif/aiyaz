import { describe, expect, it } from "vitest";
import { BRIEF_KEY, isValidSlug } from "../src/briefs.js";
import { MemoryKV } from "../src/kv.js";
import { ACME_TEST, SLUG_FOR_KEY, companyKey, newSlug, parseFactsCell, planBriefs, writeBriefs } from "../scripts/brief-rows.js";

const zeros = (n: number) => new Uint8Array(n);
const cell =
  "launched an AI assistant that answers customer questions (acme.example/news); " +
  "are piloting AI to read supplier invoices (acme.example/blog; acme.example/careers); " +
  "raised USD 12M in a Series A (acme.example/press); " +
  "runs a loyalty app";

describe("brief rows", () => {
  it("splits the tracker cell into facts with sources, ignoring semicolons inside brackets", () => {
    const { facts, dropped } = parseFactsCell(cell);
    expect(facts).toEqual([
      { text: "launched an AI assistant that answers customer questions", source: "acme.example/news" },
      { text: "are piloting AI to read supplier invoices", source: "acme.example/blog; acme.example/careers" },
    ]);
    expect(dropped).toEqual(["raised USD 12M in a Series A (acme.example/press)", "runs a loyalty app"]);
  });
  it("makes short, valid, unguessable slugs", () => {
    expect(companyKey("Acme Trading L.L.C.")).toBe("acme-trading-l-l-c");
    expect(companyKey("A".repeat(60)).length).toBeLessThanOrEqual(30);
    expect(newSlug("Acme", zeros)).toBe("acme-aaaa");
    expect(isValidSlug(newSlug("Acme Trading L.L.C. and Sons International Holdings"))).toBe(true);
  });
  it("reuses a company's existing slug so links stay stable", async () => {
    const kv = new MemoryKV();
    await kv.set(SLUG_FOR_KEY("acme"), "acme-7k2q");
    const [p] = await planBriefs([{ company: "Acme", facts: cell }], kv, zeros);
    expect(p!.slug).toBe("acme-7k2q");
    expect(p!.isNew).toBe(false);
  });
  it("writes the brief and the slug, and skips companies with no usable fact", async () => {
    const kv = new MemoryKV();
    const plan = await planBriefs(
      [
        { company: "Acme", facts: cell },
        { company: "Empty Co", facts: "raised $5M (x.example)" },
      ],
      kv,
      zeros,
    );
    expect(await writeBriefs(plan, kv)).toBe(1);
    expect(await kv.get(SLUG_FOR_KEY("acme"))).toBe("acme-aaaa");
    expect(JSON.parse((await kv.get(BRIEF_KEY("acme-aaaa")))!).facts).toHaveLength(2);
    expect(await kv.get(SLUG_FOR_KEY("empty-co"))).toBeNull();
  });
  it("skips two companies in one batch that share a company key", async () => {
    const kv = new MemoryKV();
    const base = "Acme International Trading Holdings";
    const plan = await planBriefs(
      [
        { company: `${base} North`, facts: cell },
        { company: `${base} South`, facts: cell },
        { company: "Acme", facts: cell },
      ],
      kv,
      zeros,
    );
    expect(companyKey(`${base} North`)).toBe(companyKey(`${base} South`));
    expect(plan[0]!.brief).toBeNull();
    expect(plan[1]!.brief).toBeNull();
    expect(plan[0]!.skipped).toMatch(/same key/);
    expect(plan[2]!.brief).not.toBeNull();
    expect(await writeBriefs(plan, kv)).toBe(1);
  });
  it("never reuses a slug whose stored brief belongs to another company", async () => {
    const kv = new MemoryKV();
    const stored = JSON.stringify({ company: "Acme Two", facts: [{ text: "x", source: "y" }] });
    await kv.set(SLUG_FOR_KEY("acme"), "acme-7k2q");
    await kv.set(BRIEF_KEY("acme-7k2q"), stored);
    const [p] = await planBriefs([{ company: "Acme", facts: cell }], kv, zeros);
    expect(p!.brief).toBeNull();
    expect(p!.skipped).toMatch(/another company/);
    expect(await writeBriefs([p!], kv)).toBe(0);
    expect(await kv.get(BRIEF_KEY("acme-7k2q"))).toBe(stored);
  });
  it("reuses the slug when the stored brief is the same company, ignoring case and spaces", async () => {
    const kv = new MemoryKV();
    await kv.set(SLUG_FOR_KEY("acme"), "acme-7k2q");
    await kv.set(BRIEF_KEY("acme-7k2q"), JSON.stringify({ company: " ACME ", facts: [] }));
    const [p] = await planBriefs([{ company: "Acme", facts: cell }], kv, zeros);
    expect(p!.slug).toBe("acme-7k2q");
    expect(p!.brief).not.toBeNull();
  });
  it("treats an invalid stored slug as absent", async () => {
    const kv = new MemoryKV();
    await kv.set(SLUG_FOR_KEY("acme"), "Bad Slug!");
    const [p] = await planBriefs([{ company: "Acme", facts: cell }], kv, zeros);
    expect(p!.slug).toBe("acme-aaaa");
    expect(p!.isNew).toBe(true);
  });
  it("has a made-up Acme brief for tests and the spike", () => {
    expect(ACME_TEST.slug).toBe("acme-test");
    expect(ACME_TEST.brief.company).toBe("Acme");
  });
});
