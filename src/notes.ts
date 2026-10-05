// What Aiyaz learns, kept as structured fields rather than free text.
import { EMAIL } from "./voice/meta.js";

export type BriefFact = { text: string; source: string };
export type Brief = { company: string; facts: BriefFact[] };

export type Notes = {
  product: string | null;
  users: string | null;
  aiFeature: string | null;
  owner: string | null;
  symptoms: string[];
  tried: string[];
  confirmedFacts: string[];
  unconfirmedFacts: string[];
  visitor_email: string | null;
};

export function emptyNotes(brief: Brief | null): Notes {
  return {
    product: null,
    users: null,
    aiFeature: null,
    owner: null,
    symptoms: [],
    tried: [],
    confirmedFacts: [],
    // Everything in a brief starts unconfirmed until the prospect says so.
    unconfirmedFacts: brief ? brief.facts.map((f) => f.text) : [],
    visitor_email: null,
  };
}

export type NotesUpdate = {
  product?: string;
  users?: string;
  ai_feature?: string;
  owner?: string;
  add_symptoms?: string[];
  add_tried?: string[];
  confirm_facts?: string[];
  reject_facts?: string[];
  visitor_email?: string;
};

const addUnique = (list: string[], items: string[] | undefined) => {
  for (const item of items ?? []) {
    const clean = item.trim();
    if (clean && !list.includes(clean)) list.push(clean);
  }
};

export function applyNotesUpdate(notes: Notes, update: NotesUpdate): Notes {
  const next: Notes = structuredClone(notes);
  if (update.product?.trim()) next.product = update.product.trim();
  if (update.users?.trim()) next.users = update.users.trim();
  if (update.ai_feature?.trim()) next.aiFeature = update.ai_feature.trim();
  if (update.owner?.trim()) next.owner = update.owner.trim();
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
