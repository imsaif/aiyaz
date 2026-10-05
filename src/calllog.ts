// What is kept after a call, the emails sent,  and the day's spend.
// Built only from notes and what was said, never from a new model call.
import type { Turn } from "./conversation.js";
import type { KV } from "./kv.js";
import type { Notes } from "./notes.js";
import type { CallMeta } from "./voice/meta.js";

export type CallLog = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  country: string | null;
  slug: string | null;
  company: string | null;
  email: string | null;
  endReason: string;
  claudeUsd: number;
  voiceUsd: number;
  costUsd: number;
  notes: Notes;
  transcript: Turn[];
  summary: string[];
  // What the token function reserved for this call, from the dispatch metadata (null if not given).
  reservedDay: string | null;
  reservedUsd: number | null;
};

export type CallLogInput = {
  id: string;
  startedAt: number;
  endedAt: number;
  meta: CallMeta;
  company: string | null;
  endReason: string;
  claudeUsd: number;
  notes: Notes;
  transcript: Turn[];
  voiceUsdPerMinute: number;
};

export const CALL_KEY = (id: string) => `aiyaz:call:${id}`;
export const SPEND_KEY = (day: string) => `aiyaz:spend:${day}`;
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const TWO_DAYS = 2 * 86_400;

// Corrected brief facts never appear: only notes fields, confirmed facts and Aiyaz's last words.
export function summaryLines(notes: Notes, transcript: Turn[]): string[] {
  const lines = [
    notes.product && `Product: ${notes.product}`,
    notes.users && `Used by: ${notes.users}`,
    notes.aiFeature && `AI feature: ${notes.aiFeature}`,
    notes.owner && `Owner: ${notes.owner}`,
    ...notes.symptoms.map((s) => `In the way: ${s}`),
    ...notes.tried.map((t) => `Already tried: ${t}`),
    ...notes.confirmedFacts.map((f) => `Confirmed: ${f}`),
  ].filter((x): x is string => Boolean(x));
  const last = [...transcript].reverse().find((t) => t.role === "aiyaz")?.text;
  if (last && lines.length) lines.push(`Aiyaz's last words: ${last}`);
  return lines;
}

export function buildCallLog(i: CallLogInput): CallLog {
  const durationSec = Math.max(0, Math.round((i.endedAt - i.startedAt) / 1000));
  const voiceUsd = (durationSec / 60) * i.voiceUsdPerMinute;
  return {
    id: i.id,
    startedAt: new Date(i.startedAt).toISOString(),
    endedAt: new Date(i.endedAt).toISOString(),
    durationSec,
    country: i.meta.country,
    slug: i.meta.slug,
    company: i.company,
    email: i.meta.email ?? i.notes.visitor_email ?? null,
    endReason: i.endReason,
    claudeUsd: i.claudeUsd,
    voiceUsd,
    costUsd: i.claudeUsd + voiceUsd,
    notes: i.notes,
    transcript: i.transcript,
    summary: summaryLines(i.notes, i.transcript),
    reservedDay: i.meta.day,
    reservedUsd: i.meta.reservedUsd,
  };
}

// Settle the token function's reservation to the real cost, on the day and by the amount it
// reserved (from the metadata). Without them: the call's start day and opts.reservedUsd.
export async function storeCall(kv: KV, log: CallLog, opts: { transcriptDays: number; reservedUsd: number }): Promise<void> {
  await kv.set(CALL_KEY(log.id), JSON.stringify(log), opts.transcriptDays * 86_400);
  const day = log.reservedDay ?? log.startedAt.slice(0, 10);
  await kv.incrByFloat(SPEND_KEY(day), log.costUsd - (log.reservedUsd ?? opts.reservedUsd), TWO_DAYS);
}

export function emailSubject(log: CallLog): string {
  const who = log.company ?? log.email ?? "a visitor";
  return `Aiyaz call with ${who} (${log.country ?? "country unknown"}, ${Math.round(log.durationSec / 60)} min)`;
}

export function emailText(log: CallLog): string {
  return [
    ...(log.notes.visitor_name ? [`Visitor name: ${log.notes.visitor_name}`] : []),
    ...(log.notes.visitor_role ? [`Visitor role: ${log.notes.visitor_role}`] : []),
    `Visitor email: ${log.email ?? "not given"}`,
    `Company: ${log.company ?? "not known"}${log.slug ? ` (lead link ${log.slug})` : ""}`,
    `Country: ${log.country ?? "unknown"}`,
    `Duration: ${log.durationSec} s. Ended: ${log.endReason}. Cost: USD ${log.costUsd.toFixed(3)}`,
    "",
    "Summary:",
    ...(log.summary.length ? log.summary.map((l) => `- ${l}`) : ["- Nothing learned in this call."]),
    "",
    `Call id: ${log.id}`,
  ].join("\n");
}

export async function sendSummaryEmail(
  log: CallLog,
  opts: { apiKey: string; to: string; from: string; fetchFn?: typeof fetch },
): Promise<boolean> {
  return postEmail(
    opts.apiKey,
    opts.fetchFn ?? fetch,
    {
      from: opts.from,
      to: [opts.to],
      subject: emailSubject(log),
      text: emailText(log),
      ...(log.email ? { reply_to: log.email } : {}),
    },
    "summary",
  );
}

const BOOKING_LINK = "https://cal.com/getaiengineer/30min";
const WHATSAPP_LINK = "https://wa.me/919150686857?text=Hi%2C%20I%27d%20like%20to%20talk%20about%20our%20AI%20initiative.";

// What the visitor heard at the end of the call, plus ways to carry on. No internal notes.
export function visitorEmailText(log: CallLog): string {
  return [
    "Thanks for talking with Aiyaz. Here is what we covered:",
    "",
    ...(log.summary.length ? log.summary.map((l) => `- ${l}`) : ["- We did not get far enough to note anything down."]),
    "",
    "If you want to go further, book 30 minutes with the team:",
    BOOKING_LINK,
    "",
    "Or message the team on WhatsApp:",
    WHATSAPP_LINK,
  ].join("\n");
}

async function postEmail(
  apiKey: string,
  fetchFn: typeof fetch,
  payload: Record<string, unknown>,
  label: string,
): Promise<boolean> {
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`[call] ${label} email failed: ${res.status}`);
    return res.ok;
  } catch {
    console.error(`[call] ${label} email failed: network error`);
    return false;
  }
}

export async function sendVisitorEmail(
  log: CallLog,
  opts: { apiKey: string; from: string; fetchFn?: typeof fetch },
): Promise<boolean> {
  if (!log.email) return false;
  return postEmail(
    opts.apiKey,
    opts.fetchFn ?? fetch,
    { from: opts.from, to: [log.email], subject: "Your call with Aiyaz", text: visitorEmailText(log) },
    "visitor",
  );
}

// Team email first (skipped when no team address is set), then the visitor's. Logs carry ids and numbers only.
export async function sendCallEmails(
  log: CallLog,
  opts: { apiKey?: string; to: string; from: string; fetchFn?: typeof fetch },
): Promise<void> {
  if (!opts.apiKey) {
    console.log(`[call] ${log.id} emails skipped: RESEND_API_KEY not set`);
    return;
  }
  if (opts.to.trim()) {
    await sendSummaryEmail(log, { apiKey: opts.apiKey, to: opts.to, from: opts.from, fetchFn: opts.fetchFn });
  } else {
    console.log(`[call] ${log.id} team email skipped: no summary address`);
  }
  await sendVisitorEmail(log, { apiKey: opts.apiKey, from: opts.from, fetchFn: opts.fetchFn });
}
