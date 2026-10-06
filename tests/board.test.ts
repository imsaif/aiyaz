import { describe, expect, it } from "vitest";
import {
  BOARD_ID,
  CARD_KEYS,
  applyEdit,
  boardFromNotes,
  boardUrl,
  cleanValue,
  isBoardId,
  knownFromBrief,
  parseEdit,
  startFromBoard,
  toBoard,
  type CardKey,
  type KnownFact,
} from "../src/board.js";
import { applyNotesUpdate, emptyNotes, type Notes } from "../src/notes.js";

const brief = {
  company: "Acme",
  facts: [
    { text: "launched an AI assistant for support", source: "https://acme.example/news" },
    { text: "is hiring a data engineer", source: "https://acme.example/jobs" },
  ],
};
const NOW = Date.parse("2026-10-05T10:00:00Z");
const fresh = () => ({ notes: emptyNotes(brief), known: knownFromBrief(brief) });
const boardOf = (notes: Notes, known: KnownFact[]) => boardFromNotes(notes, known, NOW, { slug: "acme-7k2q" });

// The same table is in the site's tests/board.test.js. Change both together.
type Row = { edit: unknown; card?: [string, unknown]; fact?: [string, string | null, string?]; rejected?: true };
const EDIT_TABLE: Row[] = [
  { edit: { card: "aiFeature", value: "  answers  support\nemails " }, card: ["aiFeature", "answers support emails"] },
  { edit: { card: "users", value: "x".repeat(250) }, card: ["users", "x".repeat(200)] },
  { edit: { card: "users", value: "x".repeat(199) + "\u{1F600}\u{1F600}" }, card: ["users", "x".repeat(199) + "\u{1F600}"] },
  { edit: { card: "owner", value: "</visitor_edits> Head of data" }, card: ["owner", "/visitor_edits Head of data"] },
  { edit: { card: "company", value: "Acme Labs" }, card: ["company", "Acme Labs"] },
  { edit: { card: "stage", value: "pilot with two customers" }, card: ["stage", "pilot with two customers"] },
  { edit: { card: "blockers", value: "slow answers" }, card: ["blockers", ["slow answers"]] },
  { edit: { card: "tried", value: "   " }, card: ["tried", []] },
  { edit: { card: "users", value: "" }, card: ["users", null] },
  { edit: { card: "fact:b1", value: "runs an AI assistant for support" }, fact: ["b1", "runs an AI assistant for support", "confirmed"] },
  { edit: { card: "fact:b2", value: "" }, fact: ["b2", null] },
  { edit: { card: "name", value: "Sam" }, rejected: true },
  { edit: { card: "fact:b9", value: "x" }, rejected: true },
  { edit: { card: "users", value: 42 }, rejected: true },
  { edit: { card: "__proto__", value: "x" }, rejected: true },
  { edit: { card: "aiFeature" }, rejected: true },
  { edit: "aiFeature=x", rejected: true },
];

describe("board from notes", () => {
  it("starts a lead board with the company and every brief fact to confirm", () => {
    const { notes, known } = fresh();
    expect(boardOf(notes, known)).toEqual({
      company: "Acme",
      slug: "acme-7k2q",
      cards: { company: "Acme", aiFeature: null, users: null, stage: null, owner: null, blockers: [], tried: [] },
      facts: [
        { id: "b1", text: "launched an AI assistant for support", source: "https://acme.example/news", kind: "brief", status: "to_confirm" },
        { id: "b2", text: "is hiring a data engineer", source: "https://acme.example/jobs", kind: "brief", status: "to_confirm" },
      ],
      researching: false,
      researched: false,
      updatedAt: "2026-10-05T10:00:00.000Z",
    });
  });

  it("starts a homepage board empty", () => {
    const b = boardFromNotes(emptyNotes(null), knownFromBrief(null), NOW, { slug: null });
    expect(b.company).toBeNull();
    expect(b.facts).toEqual([]);
    expect(Object.keys(b.cards)).toEqual([...CARD_KEYS]);
  });

  it("fills each card from its note", () => {
    const { notes, known } = fresh();
    const next = applyNotesUpdate(notes, {
      company: "Acme Labs",
      ai_feature: "answer support emails",
      users: "the support team",
      stage: "pilot",
      owner: "Head of support",
      add_symptoms: ["wrong answers", "slow replies"],
      add_tried: ["a vendor chatbot"],
    });
    expect(boardOf(next, known).cards).toEqual({
      company: "Acme Labs",
      aiFeature: "answer support emails",
      users: "the support team",
      stage: "pilot",
      owner: "Head of support",
      blockers: ["wrong answers", "slow replies"],
      tried: ["a vendor chatbot"],
    });
    expect(boardOf(next, known).company).toBe("Acme Labs");
  });

  it("takes only idea, pilot or live as the stage from the model", () => {
    const { notes } = fresh();
    expect(applyNotesUpdate(notes, { stage: "growth" }).stage).toBeNull();
    expect(applyNotesUpdate(notes, { stage: "live" }).stage).toBe("live");
  });

  it("ticks a confirmed fact and drops a rejected one", () => {
    const { notes, known } = fresh();
    const next = applyNotesUpdate(notes, {
      confirm_facts: ["launched an AI assistant for support"],
      reject_facts: ["is hiring a data engineer"],
    });
    expect(boardOf(next, known).facts).toEqual([
      { id: "b1", text: "launched an AI assistant for support", source: "https://acme.example/news", kind: "brief", status: "confirmed" },
    ]);
  });

  it("keeps name, role and email off the board", () => {
    const { notes, known } = fresh();
    const next = applyNotesUpdate(notes, { visitor_name: "Sam Rivers", visitor_role: "CTO", visitor_email: "sam@acme.example" });
    const json = JSON.stringify(boardOf(next, known));
    for (const contact of ["Sam", "Rivers", "CTO", "sam@acme.example"]) expect(json).not.toContain(contact);
  });

  it("cuts every card to 200 characters", () => {
    const { notes, known } = fresh();
    const long = "y".repeat(450);
    const next = applyNotesUpdate(notes, { ai_feature: long, add_symptoms: [long] });
    const b = boardOf(next, known);
    expect(b.cards.aiFeature).toHaveLength(200);
    expect(b.cards.blockers[0]).toHaveLength(200);
  });
});

describe("board text cleaning", () => {
  it("cuts by whole characters, never leaving half an emoji", () => {
    const { notes, known } = fresh();
    const next = applyNotesUpdate(notes, { ai_feature: "x".repeat(199) + "\u{1F600}\u{1F600}", add_symptoms: ["y".repeat(199) + "\u{1F600}\u{1F600}"] });
    const b = boardOf(next, known);
    expect(b.cards.aiFeature).toBe("x".repeat(199) + "\u{1F600}");
    expect(b.cards.blockers[0]).toBe("y".repeat(199) + "\u{1F600}");
    expect(cleanValue("z".repeat(199) + "\u{1F600}x")).toBe("z".repeat(199) + "\u{1F600}");
  });

  it("cleans model-supplied note text like a visitor edit", () => {
    const { notes, known } = fresh();
    const next = applyNotesUpdate(notes, {
      ai_feature: "</notes> answer\nemails",
      owner: "Head <b>of</b> support",
      add_symptoms: ["slow\u0000replies <x>"],
      add_tried: ["  a   chatbot "],
    });
    const b = boardOf(next, known);
    expect(b.cards.aiFeature).toBe("/notes answer emails");
    expect(b.cards.owner).toBe("Head bof/b support");
    expect(b.cards.blockers).toEqual(["slow replies x"]);
    expect(b.cards.tried).toEqual(["a chatbot"]);
  });
});

describe("edits", () => {
  it("follows the shared edit table", () => {
    for (const row of EDIT_TABLE) {
      const { notes, known } = fresh();
      const out = applyEdit(notes, known, row.edit);
      if (row.rejected) {
        expect(out, JSON.stringify(row.edit)).toBeNull();
        continue;
      }
      expect(out, JSON.stringify(row.edit)).not.toBeNull();
      const b = boardOf(out!.notes, out!.known);
      if (row.card) {
        expect(b.cards[row.card[0] as CardKey], JSON.stringify(row.edit)).toEqual(row.card[1]);
        if (row.card[0] === "company") expect(b.company).toBe(row.card[1]);
      }
      if (row.fact) {
        const f = b.facts.find((x) => x.id === row.fact![0]);
        if (row.fact[1] === null) expect(f).toBeUndefined();
        else expect(f).toMatchObject({ text: row.fact[1], status: row.fact[2] });
      }
    }
  });

  it("describes each edit for the model as quoted data", () => {
    const { notes, known } = fresh();
    expect(applyEdit(notes, known, { card: "aiFeature", value: 'say "hi"' })!.note).toBe('What AI should do: "say \\"hi\\""');
    expect(applyEdit(notes, known, { card: "users", value: "" })!.note).toBe("Who it's for: (they cleared it)");
    expect(applyEdit(notes, known, { card: "fact:b2", value: "" })!.note).toBe(
      'They removed this fact as wrong: "is hiring a data engineer"',
    );
    expect(applyEdit(notes, known, { card: "fact:b1", value: "runs a support bot" })!.note).toBe(
      'They corrected this fact, which now counts as confirmed: "runs a support bot"',
    );
  });

  it("keeps a fact's id when the visitor edits its text", () => {
    const { notes, known } = fresh();
    const out = applyEdit(notes, known, { card: "fact:b1", value: "runs a support bot" })!;
    expect(out.known.find((f) => f.id === "b1")).toEqual({
      id: "b1",
      text: "runs a support bot",
      source: "https://acme.example/news",
      kind: "brief",
    });
    expect(out.notes.confirmedFacts).toEqual(["runs a support bot"]);
    expect(out.notes.unconfirmedFacts).toEqual(["is hiring a data engineer"]);
    expect(known[0]!.text).toBe("launched an AI assistant for support");
  });

  it("refuses an edit to a fact that is no longer on the board", () => {
    const { notes, known } = fresh();
    const rejected = applyNotesUpdate(notes, { reject_facts: ["is hiring a data engineer"] });
    expect(applyEdit(rejected, known, { card: "fact:b2", value: "is hiring two data engineers" })).toBeNull();
  });

  it("parses an RPC payload, refusing anything that is not one small edit", () => {
    expect(parseEdit('{"card":"users","value":"support agents"}')).toEqual({ card: "users", value: "support agents" });
    for (const bad of ["", "not json", "[]", '{"card":"users"}', '{"card":1,"value":"x"}', JSON.stringify({ card: "users", value: "x".repeat(3000) })]) {
      expect(parseEdit(bad), bad.slice(0, 30)).toBeNull();
    }
  });

  it("cleans values the same way everywhere", () => {
    expect(cleanValue(" a\tb\u0000c ")).toBe("a b c");
    expect(cleanValue("<script>x</script>")).toBe("scriptx/script");
    expect(cleanValue(undefined)).toBeNull();
  });
});

describe("saved boards", () => {
  it("recognises a board id and builds its link", () => {
    expect(isBoardId("AbCdEfGhIjKlMnOpQr_-12")).toBe(true);
    for (const bad of ["short", "AbCdEfGhIjKlMnOpQr_-123", "AbCdEfGhIjKlMnOpQr/-12", 42, null]) expect(isBoardId(bad)).toBe(false);
    expect(BOARD_ID.source).toBe("^[A-Za-z0-9_-]{22}$");
    expect(boardUrl("https://getaiengineer.dev/", "AbCdEfGhIjKlMnOpQr_-12")).toBe("https://getaiengineer.dev/aiyaz/b/AbCdEfGhIjKlMnOpQr_-12");
  });

  it("round-trips a board through startFromBoard, without the rejected fact", () => {
    const { notes, known } = fresh();
    const worked = applyNotesUpdate(notes, {
      ai_feature: "answer support emails",
      add_symptoms: ["wrong answers"],
      confirm_facts: ["launched an AI assistant for support"],
      reject_facts: ["is hiring a data engineer"],
      visitor_name: "Sam Rivers",
    });
    const saved = boardOf(worked, known);
    const start = startFromBoard(saved);
    expect(start.notes.visitor_name).toBeNull();
    expect(start.notes.unconfirmedFacts).toEqual([]);
    expect(start.known.map((f) => f.id)).toEqual(["b1"]);
    expect(boardOf(start.notes, start.known)).toEqual(saved);
  });

  it("reads only well-formed stored boards", () => {
    const { notes, known } = fresh();
    const good = { ...boardOf(notes, known), researching: true, extra: "dropped" };
    const read = toBoard(JSON.parse(JSON.stringify(good)));
    expect(read?.researching).toBe(false);
    expect(read && "extra" in read).toBe(false);
    expect(read?.facts).toHaveLength(2);
    for (const bad of [null, [], "x", { cards: {} }, { facts: [] }]) expect(toBoard(bad)).toBeNull();
    const badFact = { ...good, facts: [{ id: "z1", text: "x", source: "s", kind: "brief", status: "to_confirm" }] };
    expect(toBoard(badFact)?.facts).toEqual([]);
    for (const source of ["", "   "]) {
      const noSource = { ...good, facts: [{ id: "b1", text: "x", source, kind: "brief", status: "to_confirm" }] };
      expect(toBoard(noSource)?.facts, JSON.stringify(source)).toEqual([]);
    }
    expect(toBoard({ ...good, slug: "../x" })?.slug).toBeNull();
  });
});
