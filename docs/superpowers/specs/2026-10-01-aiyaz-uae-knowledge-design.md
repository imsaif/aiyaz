# Aiyaz: UAE knowledge, initiative framing and Gulf Arabic

Date: 2026-10-01. Status: draft for Imran's review.

## Why

getaiengineer.dev now speaks to UAE companies. The site
leads with "We take your AI initiative from plan to production", prices the two-week sprint
at AED 25,000, and invites visitors to "Talk to Aiyaz about your AI initiative".

Aiyaz today works against that page:

- it quotes $3,000 (`sprintPriceUsd` in `src/config.ts`, `{{sprintPrice}}` in the prompt);
- its job is diagnosing a broken AI feature, while a Gulf CEO is more likely to be at the
  initiative stage (McKinsey, Nov 2025: 84% of GCC companies use AI, 31% at scale);
- it answers Arabic in English and says it can only continue in English;
- it knows nothing about UAE industries, regulators or business norms.

Aiyaz stays the front door that books a call with the team. It is not a product. Unchanged rules: it never names a person (`forbiddenNames`), it never states an
unconfirmed fact about the caller's company, the AI disclosure is said by code.

## Goals

1. Aiyaz can hold an informed conversation with a UAE founder or CEO about their AI
   initiative: what they want AI to do, how far along it is, who sponsors it, what blocks it.
2. The only price it ever says is AED 25,000.
3. It answers in Gulf Arabic when the caller writes in Arabic, once the Arabic switch is on.
4. Automatic tests catch formal Arabic (MSA) or another dialect, and unnatural Arabic,
   before a human ever reads it.

Out of scope: Arabic voice (speech to text and text to speech need their own testing),
Saudi or Qatar specifics, a separate Gulf product or domain, translating the website.

## Design

### 1. UAE briefing pack

New file `prompts/knowledge/uae.v1.md`, about 1,500 words, injected into the system prompt
as its own section. Built from desk research on the UAE market (sources kept outside this repo). Every fact carries its source date. Imran reads and approves it before use.

Sections:

- **Industries and their typical AI challenges**: fintech (document AI, assistants with no
  evals), proptech and mortgages (regulated-advice chatbots, property search quality),
  healthcare documentation, legal, plus what larger buyers (banks, government, energy)
  usually do instead.
- **Regulators and national plans**: UAE AI Strategy 2031, Dubai's AI directives, CBUAE AI
  guidance (Feb 2026; guidance for licensed institutions, not a hard rule), data residency
  and working inside the client's cloud, Abu Dhabi health Responsible AI Standard.
- **How business conversations go**: greeting before business, formal and respectful tone,
  no hard sell, relationship first, WhatsApp after first contact, UAE week Mon to Fri.

Rule in the prompt: the pack is for context and for asking better questions. Aiyaz never
presents a pack fact as true about the caller's company, and labels any link it draws as a
guess. The existing `noUnconfirmedFact` scorer keeps applying.

The pack is versioned like the prompt, and its content hash goes into the prompt id so every
trace shows which pack version was used.

### 2. Prompt v2

New file `prompts/system.v2.md`; `system.v1.md` stays for comparison. `PROMPT_VERSION`
becomes configurable (`AIYAZ_PROMPT_VERSION`, default `v2`).

- **Job**: understand their AI initiative. Questions, one at a time, about five in total:
  what they want AI to do and for whom; how far along it is (idea, pilot, live); who sponsors
  it; what is in the way; when they want it working. If something is already live, the v1
  diagnosis questions still apply.
- **Offer** text matches the site: days 1 to 4 pick the use case and measure it, days 5 to 9
  build or fix it, day 10 hand over tests and monitoring; same guarantee wording as the site.
- **Opening line** (said by code) changes to: "I'm Aiyaz, an AI agent from getaiengineer.dev.
  What is your company trying to do with AI?" With a research brief, the existing
  brief-confirmation opener stays.
- **Ending**: summary of the initiative, guesses labelled as guesses, what the sprint would
  tackle first, then `end_conversation`. Unchanged mechanics.

### 3. Price in AED

- `sprintPriceUsd` is replaced by `sprintPrice: { amount: 25000, currency: "AED" }`.
- `onlySprintPrice` in `src/guards.ts` learns AED: "AED 25,000", "25,000 AED", "25,000
  dirhams", Arabic "٢٥٬٠٠٠ درهم" and "25 ألف درهم". Any other amount or currency, including
  a dollar conversion, fails.
- The `only_sprint_price` scorer description and tests update with it.

### 4. Gulf Arabic and the Arabic switch

- New setting `arabicEnabled` (`AIYAZ_ARABIC`, default `false`).
- Off: unchanged v1 behaviour, a short polite reply in English saying it can continue in
  English for now.
- On: Aiyaz mirrors the caller's language. Arabic replies are in Gulf (Khaleeji) Arabic, not
  Modern Standard Arabic, with the same short-sentence rule because replies may be spoken.
  Product and technical terms may stay in English, as Gulf speakers commonly do.
- The switch is turned on only after the human review in section 6 passes.

### 5. Automatic Arabic checks (open source)

Two new scorers, run only on Arabic Aiyaz turns:

- **Dialect check (CAMeL Tools, NYU Abu Dhabi, MIT licence).** Its dialect identification
  model labels each reply. Pass if the label is a Gulf city or region; fail on MSA or another
  dialect. CAMeL Tools is Python, so it runs through a small script the TypeScript scorer
  calls (`evals/arabic/dialect.py`, JSON in and out). Accuracy on short replies is unverified:
  the plan starts with a spike that runs it on 20 known Gulf and MSA sentences and records the
  hit rate. If it is below about 80%, the check is reported but does not fail the run.
- **Naturalness judge (Jais or ALLaM, open Arabic models).** Scores each Arabic reply 1 to 5
  for natural Gulf phrasing and respectful business tone, with a one-line reason. Which model
  and how it runs (local on the MacBook or a hosted endpoint) is decided in the same spike,
  on cost and speed. Pass at 4 or above.

Both scorers write their verdicts into the eval output so the human reviewer sees them.

### 6. Test callers and human review

New personas in `evals/personas.ts`:

- `dubai-fintech-ceo`: Series A fintech, wants an AI assistant for SME customers, at pilot
  stage, worried about CBUAE expectations.
- `proptech-founder`: mortgage chatbot already live, wrong eligibility answers.
- `arabic-family-business-coo`: writes only in Gulf Arabic, at idea stage, wants AI in
  customer service.
- `asks-in-dollars`: asks for the price in USD; Aiyaz must keep to AED 25,000.

The existing `non-english` persona keeps testing the switch-off behaviour.

Human review: one native Gulf Arabic speaker on contract reads
about 20 Arabic replies exported from the evals, with the automatic verdicts beside them,
using a short sheet: natural Gulf phrasing, respectful tone, would a Dubai CEO keep talking.
Claude drafts the job post and sheet; Imran posts it.

## Testing

- Unit tests: AED price guard cases (English and Arabic forms, refusals of other amounts);
  prompt builder includes the pack and its hash; switch off keeps v1 language behaviour.
- Evals: all existing checks plus the two Arabic scorers, across old and new personas.
- Pass bar to turn Arabic on: dialect check passing on all Arabic turns (or reported only, if
  the spike shows it is unreliable), judge 4+ on all, and the human reviewer signs off.

## Order of work

1. Spike: CAMeL dialect ID and the judge model on 20 sample sentences.
2. AED price setting and guard, with tests.
3. Briefing pack draft, then Imran's review.
4. Prompt v2 and opening line.
5. Arabic switch, Arabic scorers, new personas.
6. Run evals, export Arabic replies, human review.
7. Turn Arabic on.

## Risks

- Dialect ID may be unreliable on short replies; handled by the spike and the report-only
  fallback.
- The pack can go stale; facts carry dates and are re-checked periodically.
- Gulf Arabic that is grammatical but culturally off still needs the human pass; the
  automatic checks only narrow it.
