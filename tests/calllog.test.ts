import { describe, expect, it, vi } from "vitest";
import {
  CALL_KEY,
  SPEND_KEY,
  boardLines,
  buildCallLog,
  emailSubject,
  emailText,
  sendCallEmails,
  sendSummaryEmail,
  sendVisitorEmail,
  storeCall,
  summaryLines,
  visitorEmailText,
} from "../src/calllog.js";
import { boardFromNotes, knownFromBrief } from "../src/board.js";
import { MemoryKV } from "../src/kv.js";
import { applyNotesUpdate, emptyNotes } from "../src/notes.js";
import { parseCallMeta } from "../src/voice/meta.js";

const brief = {
  company: "Acme",
  facts: [
    { text: "import customers from a CRM", source: "s" },
    { text: "send payment reminders", source: "s" },
  ],
};
const notes = applyNotesUpdate(emptyNotes(brief), {
  product: "an invoicing app",
  add_symptoms: ["the assistant gives wrong due dates"],
  confirm_facts: ["send payment reminders"],
  reject_facts: ["import customers from a CRM"],
});
const transcript = [
  { role: "aiyaz" as const, text: "I'm Aiyaz, an AI agent." },
  { role: "prospect" as const, text: "We make an invoicing app." },
  { role: "aiyaz" as const, text: "My guess is the assistant reads dates from the wrong field." },
];
const START = Date.parse("2026-10-05T10:00:00Z");
const NO_META = { country: null, slug: null, email: null, day: null, reservedUsd: null, board: null };
const log = buildCallLog({
  id: "call-1",
  startedAt: START,
  endedAt: START + 300_000,
  meta: { country: "AE", slug: "acme-test", email: "cto@acme.example", day: null, reservedUsd: null, board: null },
  company: "Acme",
  endReason: "agent_ended",
  claudeUsd: 0.12,
  notes,
  transcript,
  voiceUsdPerMinute: 0.05,
});

describe("summary", () => {
  it("keeps what the visitor said and confirmed, and drops what they corrected", () => {
    const lines = summaryLines(notes, transcript).join("\n");
    expect(lines).toContain("an invoicing app");
    expect(lines).toContain("the assistant gives wrong due dates");
    expect(lines).toContain("Confirmed: send payment reminders");
    expect(lines).toContain("My guess is the assistant reads dates from the wrong field.");
    expect(lines).not.toContain("CRM");
  });
  it("works for a call that ended before anything was learned", () => {
    expect(summaryLines(emptyNotes(null), [])).toEqual([]);
  });
});

describe("call log", () => {
  it("uses the form email first, else the one Aiyaz collected on a lead call", () => {
    const collected = applyNotesUpdate(notes, { visitor_email: "Lead@Acme.example" });
    const base = { id: "c2", startedAt: START, endedAt: START + 60_000, company: "Acme", endReason: "x", claudeUsd: 0, transcript, voiceUsdPerMinute: 0.05 };
    expect(buildCallLog({ ...base, meta: { ...NO_META, email: "form@acme.example" }, notes: collected }).email).toBe("form@acme.example");
    expect(buildCallLog({ ...base, meta: NO_META, notes: collected }).email).toBe("lead@acme.example");
    expect(buildCallLog({ ...base, meta: NO_META, notes }).email).toBeNull();
  });
  it("records who, where, how long and what it cost, voice included", () => {
    expect(log.durationSec).toBe(300);
    expect(log.voiceUsd).toBeCloseTo(0.25);
    expect(log.costUsd).toBeCloseTo(0.37);
    expect(log.email).toBe("cto@acme.example");
    expect(log.startedAt).toBe("2026-10-05T10:00:00.000Z");
  });
  it("stores the transcript for 30 days and settles the day's reserved spend", async () => {
    const kv = new MemoryKV();
    await kv.set(SPEND_KEY("2026-10-05"), "1"); // reserved by the token function
    await storeCall(kv, log, { transcriptDays: 30, reservedUsd: 1 });
    expect(JSON.parse((await kv.get(CALL_KEY("call-1")))!).transcript).toHaveLength(3);
    expect(kv.ttl.get(CALL_KEY("call-1"))).toBe(2_592_000);
    expect(Number(await kv.get(SPEND_KEY("2026-10-05")))).toBeCloseTo(0.37);
  });
  // Minted at 23:59 UTC, the worker joined after midnight and the call ended at 00:05.
  const lateLog = (meta: string) =>
    buildCallLog({
      id: "late", startedAt: Date.parse("2026-10-06T00:00:10Z"), endedAt: Date.parse("2026-10-06T00:05:10Z"),
      meta: parseCallMeta(meta), company: null, endReason: "agent_ended", claudeUsd: 0.1, notes, transcript, voiceUsdPerMinute: 0.05,
    });
  it("settles on the day the token function reserved, even after midnight", async () => {
    const kv = new MemoryKV();
    await kv.set(SPEND_KEY("2026-10-05"), "1");
    await storeCall(kv, lateLog('{"day":"2026-10-05","reservedUsd":1}'), { transcriptDays: 30, reservedUsd: 1 });
    expect(Number(await kv.get(SPEND_KEY("2026-10-05")))).toBeCloseTo(0.35);
    expect(await kv.get(SPEND_KEY("2026-10-06"))).toBeNull();
  });
  it("settles the amount the token function reserved, not the worker's own setting", async () => {
    const kv = new MemoryKV();
    await kv.set(SPEND_KEY("2026-10-05"), "0.75");
    await storeCall(kv, lateLog('{"day":"2026-10-05","reservedUsd":0.75}'), { transcriptDays: 30, reservedUsd: 1 });
    expect(Number(await kv.get(SPEND_KEY("2026-10-05")))).toBeCloseTo(0.35);
  });
  it("falls back to the start day and the worker's setting when the metadata is malformed", async () => {
    const kv = new MemoryKV();
    await storeCall(kv, lateLog('{"day":"05/10/2026","reservedUsd":"0.75"}'), { transcriptDays: 30, reservedUsd: 1 });
    expect(Number(await kv.get(SPEND_KEY("2026-10-06")))).toBeCloseTo(0.35 - 1);
    expect(await kv.get(SPEND_KEY("2026-10-05"))).toBeNull();
  });
});

describe("summary email", () => {
  it("has the email, company, country, cost and summary, but no transcript", () => {
    expect(emailSubject(log)).toBe("Aiyaz call with Acme (AE, 5 min)");
    const body = emailText(log);
    for (const s of ["cto@acme.example", "Acme", "AE", "300 s", "USD 0.370", "an invoicing app", "agent_ended"]) {
      expect(body).toContain(s);
    }
    expect(body).not.toContain("Transcript");
    expect(body).not.toContain("We make an invoicing app.");
    expect(body).not.toContain("Visitor: ");
  });
  it("posts to Resend with the key, and reply-to set to the visitor", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await sendSummaryEmail(log, { apiKey: "re_test", to: "team@getaiengineer.dev", from: "Aiyaz <work@getaiengineer.dev>", fetchFn: fake });
    expect(ok).toBe(true);
    const sent = calls[0]!;
    expect(sent.url).toBe("https://api.resend.com/emails");
    expect((sent.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(sent.init.body));
    expect(body.to).toEqual(["team@getaiengineer.dev"]);
    expect(body.reply_to).toBe("cto@acme.example");
    expect(body.subject).toBe(emailSubject(log));
  });
  it("never throws when Resend fails", async () => {
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await sendSummaryEmail(log, { apiKey: "k", to: "t@x.co", from: "f@x.co", fetchFn: down })).toBe(false);
  });
});
const WA = "https://wa.me/919150686857?text=Hi%2C%20I%27d%20like%20to%20talk%20about%20our%20AI%20initiative.";
const okFetch = () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fn };
};

describe("visitor email", () => {
  it("has the summary and both links, and no cost, country or internal notes", () => {
    const body = visitorEmailText(log);
    expect(body).toContain("an invoicing app");
    expect(body).toContain("https://cal.com/getaiengineer/30min");
    expect(body).toContain(WA);
    for (const s of ["USD", "0.37", "Country", "Cost", "Imran", "\u2014", "agent_ended", "Call id"]) {
      expect(body).not.toContain(s);
    }
    expect(body).not.toMatch(/seamless|unlock|elevate|revolutionis/i);
  });
  it("sends to the visitor from the work address with the right subject", async () => {
    const f = okFetch();
    expect(await sendVisitorEmail(log, { apiKey: "k", from: "Aiyaz <work@getaiengineer.dev>", fetchFn: f.fn })).toBe(true);
    expect(f.calls[0]!.body.to).toEqual(["cto@acme.example"]);
    expect(f.calls[0]!.body.subject).toBe("Your call with Aiyaz");
    expect(f.calls[0]!.body.from).toBe("Aiyaz <work@getaiengineer.dev>");
  });
  it("does not fetch when no email is known", async () => {
    const f = okFetch();
    const noEmail = { ...log, email: null };
    expect(await sendVisitorEmail(noEmail, { apiKey: "k", from: "f@x.co", fetchFn: f.fn })).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});

describe("visitor name and role", () => {
  const named = buildCallLog({
    id: "c9", startedAt: START, endedAt: START + 60_000, meta: { ...NO_META, country: "AE", email: "cto@acme.example" }, company: "Acme",
    endReason: "x", claudeUsd: 0, transcript, voiceUsdPerMinute: 0.05,
    notes: applyNotesUpdate(notes, { visitor_name: "Sam Lee", visitor_role: "CTO" }),
  });
  it("shows in the team email only when given", () => {
    expect(emailText(named)).toContain("Visitor name: Sam Lee");
    expect(emailText(named)).toContain("Visitor role: CTO");
    expect(emailText(log)).not.toContain("Visitor name");
    expect(emailText(log)).not.toContain("Visitor role");
  });
  it("never shows in the visitor email", () => {
    expect(visitorEmailText(named)).not.toContain("Sam Lee");
    expect(visitorEmailText(named)).not.toContain("CTO");
  });
});

describe("sendCallEmails", () => {
  it("sends the team email, then the visitor email", async () => {
    const f = okFetch();
    await sendCallEmails(log, { apiKey: "k", to: "team@getaiengineer.dev", from: "Aiyaz <work@getaiengineer.dev>", fetchFn: f.fn });
    expect(f.calls.map((c) => c.body.to)).toEqual([["team@getaiengineer.dev"], ["cto@acme.example"]]);
  });
  it("skips both with one quiet log line when the key is missing", async () => {
    const f = okFetch();
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(String(m)));
    await sendCallEmails(log, { to: "t@x.co", from: "f@x.co", fetchFn: f.fn });
    spy.mockRestore();
    expect(f.calls).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("acme.example");
    expect(lines[0]).not.toContain("invoicing");
  });
  it("skips only the team email when the team address is blank", async () => {
    const f = okFetch();
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(String(m)));
    await sendCallEmails(log, { apiKey: "k", to: "  ", from: "Aiyaz <work@getaiengineer.dev>", fetchFn: f.fn });
    spy.mockRestore();
    expect(f.calls.map((c) => c.body.to)).toEqual([["cto@acme.example"]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(log.id);
    expect(lines[0]).not.toContain("acme.example");
  });
});

describe("board links", () => {
  const BOARD_URL = "https://getaiengineer.dev/aiyaz/b/AbCdEfGhIjKlMnOpQr_-12";
  const board = boardFromNotes(notes, knownFromBrief(brief), START, { slug: "acme-test" });
  const mk = (b: typeof board) =>
    buildCallLog({
      id: "call-2", startedAt: START, endedAt: START + 60_000, meta: { ...NO_META, email: "cto@acme.example" }, company: "Acme",
      endReason: "agent_ended", claudeUsd: 0.1, notes, transcript, voiceUsdPerMinute: 0.05, board: b, boardUrl: BOARD_URL,
    });
  const withBoard = mk(board);
  // A board that still holds a fact to confirm and a found fact with a source.
  const open = boardFromNotes(emptyNotes(brief), knownFromBrief(brief), START, { slug: "acme-test" });
  const mixed = mk({
    ...board,
    facts: [
      ...board.facts,
      { id: "f1", text: "is hiring a data engineer", source: "https://acme.example/jobs", kind: "found", status: "to_confirm" },
    ],
  });
  it("keeps the board and its link in the call log", () => {
    expect(withBoard.board).toEqual(board);
    expect(withBoard.boardUrl).toBe(BOARD_URL);
    expect(log.board).toBeNull();
    expect(log.boardUrl).toBeNull();
  });
  it("links the board in the team email", () => {
    expect(emailText(withBoard)).toContain(`Their brief: ${BOARD_URL}`);
    expect(emailText(log)).not.toContain("Their brief");
  });
  it("gives the visitor the brief cards, the board link and the booking link", () => {
    const body = visitorEmailText(withBoard);
    expect(body).toContain("Company: Acme");
    expect(body).toContain("From the brief (confirmed): send payment reminders");
    expect(body).not.toContain("import customers from a CRM");
    expect(body).toContain(BOARD_URL);
    expect(body).toContain("https://cal.com/getaiengineer/30min");
    expect(body).not.toContain("\u2014");
  });
  it("lists every filled card in board order, then the facts with kind and status", () => {
    expect(boardLines(board)).toEqual([
      "Company: Acme",
      "What's blocking it: the assistant gives wrong due dates",
      "From the brief (confirmed): send payment reminders",
    ]);
  });
  it("leaves facts still to confirm out of the visitor email", () => {
    const body = visitorEmailText(mixed);
    expect(body).toContain("send payment reminders");
    expect(body).not.toContain("is hiring a data engineer");
    expect(visitorEmailText(mk(open))).not.toContain("launched an AI assistant");
  });
  it("shows the team every fact with its status, and found facts with their source", () => {
    const body = emailText(mixed);
    expect(body).toContain("From the brief (confirmed): send payment reminders");
    expect(body).toContain("Found online (to confirm): is hiring a data engineer (https://acme.example/jobs)");
    expect(emailText(mk(open))).toContain("From the brief (to confirm): import customers from a CRM");
  });
});
