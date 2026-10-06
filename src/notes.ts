// What Aiyaz learns, kept as structured fields rather than free text.
import { EMAIL } from "./voice/meta.js";

export type BriefFact = { text: string; source: string };
export type Brief = { company: string; facts: BriefFact[] };

// How far along the initiative is. The model may only record one of these; a visitor's
// own edit on the page may say more ("pilot with two customers").
export const STAGES = ["idea", "pilot", "live"] as const;

export type Notes = {
  company: string | null;
  product: string | null;
  users: string | null;
  aiFeature: string | null;
  stage: string | null;
  owner: string | null;
  symptoms: string[];
  tried: string[];
  confirmedFacts: string[];
  unconfirmedFacts: string[];
  visitor_email: string | null;
  visitor_name: string | null;
  visitor_role: string | null;
};

export function emptyNotes(brief: Brief | null): Notes {
  return {
    company: brief ? brief.company : null,
    product: null,
    users: null,
    aiFeature: null,
    stage: null,
    owner: null,
    symptoms: [],
    tried: [],
    confirmedFacts: [],
    // Everything in a brief starts unconfirmed until the prospect says so.
    unconfirmedFacts: brief ? brief.facts.map((f) => f.text) : [],
    visitor_email: null,
    visitor_name: null,
    visitor_role: null,
  };
}

export type NotesUpdate = {
  company?: string;
  product?: string;
  users?: string;
  ai_feature?: string;
  stage?: string;
  owner?: string;
  add_symptoms?: string[];
  add_tried?: string[];
  confirm_facts?: string[];
  reject_facts?: string[];
  visitor_email?: string;
  visitor_name?: string;
  visitor_role?: string;
};

// Short, single-line text for fields a model fills from speech.
const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80).trim();

const addUnique = (list: string[], items: string[] | undefined) => {
  for (const item of items ?? []) {
    const clean = item.trim();
    if (clean && !list.includes(clean)) list.push(clean);
  }
};

export function applyNotesUpdate(notes: Notes, update: NotesUpdate): Notes {
  const next: Notes = structuredClone(notes);
  if (oneLine(update.company)) next.company = oneLine(update.company);
  if (update.product?.trim()) next.product = update.product.trim();
  if (update.users?.trim()) next.users = update.users.trim();
  if (update.ai_feature?.trim()) next.aiFeature = update.ai_feature.trim();
  if (typeof update.stage === "string" && (STAGES as readonly string[]).includes(update.stage)) next.stage = update.stage;
  if (update.owner?.trim()) next.owner = update.owner.trim();
  if (oneLine(update.visitor_name)) next.visitor_name = oneLine(update.visitor_name);
  if (oneLine(update.visitor_role)) next.visitor_role = oneLine(update.visitor_role);
  // Same check as the token function. An invalid value never replaces a stored one.
  const email = typeof update.visitor_email === "string" ? update.visitor_email.trim().toLowerCase() : "";
  if (EMAIL.test(email)) next.visitor_email = email;
  addUnique(next.symptoms, update.add_symptoms);
  addUnique(next.tried, update.add_tried);
  // Only facts already on the unconfirmed list can be confirmed. The model
  // cannot invent a "confirmed" fact that was never in the brief.
  for (const fact of update.confirm_facts ?? []) {
    const i = next.unconfirmedFacts.indexOf(fact.trim());
    if (i >= 0) {
      next.unconfirmedFacts.splice(i, 1);
      next.confirmedFacts.push(fact.trim());
    }
  }
  for (const fact of update.reject_facts ?? []) {
    const i = next.unconfirmedFacts.indexOf(fact.trim());
    if (i >= 0) next.unconfirmedFacts.splice(i, 1);
  }
  return next;
}
