# Aiyaz: design

Date: 2026-09-28. Status: approved in conversation, awaiting review of this document.
Owner: Imran. Repo: public (`aiyaz`). Brand it serves: getaiengineer.dev.

## What it is and why

Aiyaz is a voice agent for getaiengineer.dev. A founder or CTO talks to it about their
product. It works out what their AI feature does, what is going wrong, and how a two-week
sprint would help, then leaves them with a written summary and a booking link.

It has two jobs at once:

1. **Outreach.** Prospects get a personal link to an Aiyaz that has already read about
   their company. The homepage has a generic Aiyaz that starts from nothing.
2. **Proof of engineering.** The build itself shows evals, pipelines, tracing, limits and
   fallbacks, in a public repo, with live numbers on a "how it's built" page. It must not
   read as a UX demo only.

### Decisions already made

- One agent. The prospect version is the same agent started with a research brief.
- Built brain-first: conversation, research, summary and evals in text, then voice on top.
- English first. Gulf Arabic later, and only after a Gulf-native speaker judges it.
- The name is Aiyaz. It is one config value and can change.
- Aiyaz says it is an AI in its first sentence. It never uses Imran's name; it says
  "the team" instead.
- Price quoted is the $3,000 two-week sprint only. No hourly or day rates.
- The repo is public. Secrets live only in environment variables, never in the code.

## The pieces

| # | Piece | Job |
|---|---|---|
| 1 | Brain | Runs the conversation with Claude, takes structured notes |
| 2 | Research pipeline | Reads a company's public site and builds a brief |
| 3 | Summary | Turns notes into a summary page and email |
| 4 | Voice layer | Speech in and out, interruptions, turn-taking |
| 5 | Engineering layer | Evals, CI gate, tracing, limits, fallbacks, public numbers |

Each piece is its own module with a small interface, testable on its own.

## 1. Brain

**Model.** Claude Sonnet 5 (`claude-sonnet-5`) for the conversation. Claude Haiku 4.5
(`claude-haiku-4-5-20251001`) as the fallback and for cheap side tasks.

**Conversation flow.**

1. Opening: "I'm Aiyaz, an AI agent from getaiengineer.dev."
   - With a brief: "I read that you [one fact from the brief]. Is that right?"
   - Without: "What does your product do, and where does AI show up in it?"
2. Discovery, about five questions: who uses the product; what the AI feature does; what
   is going wrong (drop-off, complaints, bad answers); what they have tried; who owns it.
3. Summary, built only from what they said and the brief.
4. Email asked for only at the end, to send the summary.

**Structured notes.** The brain writes notes through a tool call, not free text:
`product`, `users`, `ai_feature`, `symptoms[]`, `tried[]`, `owner`, `confirmed_facts[]`,
`unconfirmed_facts[]`. A fact from the brief moves to `confirmed_facts` only when the
prospect confirms it.

**Rules.**

- Never state a fact about their company that is not confirmed. Brief facts are asked,
  not asserted.
- Likely problems are labelled as guesses.
- Ten-minute cap. Off-topic talk is steered back once, then the conversation wraps up.
- If it cannot answer, it says so and offers a call with the team.

**Prompts** live in versioned files in the repo. Every trace records the prompt version.

## 2. Research pipeline

Input: a company URL. Output: a brief stored in the database under a slug, which becomes
the prospect link `getaiengineer.dev/p/<slug>`.

Steps:

1. Fetch the homepage, product pages, pricing, careers and blog index (limit ~10 pages,
   respect robots.txt).
2. Extract readable text.
3. Claude extracts a brief: what the product does, who it is for, where AI appears, recent
   launches, open roles that mention AI. Every field carries the source URL it came from.
4. Store the brief with a `created_at` and the source list.

A brief field with no source URL is dropped. Imran reviews each brief before the link is
sent; the pipeline does not send anything by itself.

## 3. Summary

Generated at the end of the conversation from the notes and the brief:

- What we understood about the product and the AI feature.
- Likely problems, each marked as a guess and tied to something they said.
- What a two-week, $3,000 sprint would fix first.
- The booking link.

Shown on screen at a private URL and emailed (Resend) if they give an address. A copy of
every conversation and summary goes to Imran.

## 4. Voice layer (phase 2)

LiveKit Agents (Python) for the realtime room and turn-taking. Speech-to-text: Deepgram.
Voice: two providers compared by ear before choosing. The name is given a pronunciation
hint ("Ayaz") and tested once. If voice fails at any point, the conversation continues in
text.

## 5. Engineering layer

**Evals.**

- About 25 synthetic prospects, each a persona played by a model: vague founder, detailed
  CTO, off-topic, hostile, non-English speaker, a prospect whose brief is wrong, and others.
- Code checks (exact): says it is an AI in the first turn; never contains "Imran"; quotes
  $3,000 and no other price; wraps up within the turn and time limits.
- Model-graded checks: no unconfirmed fact asserted; every summary claim traceable to the
  transcript or brief; guesses labelled as guesses.
- Research pipeline check: briefs for ~10 hand-checked companies compared field by field.
- Runs in GitHub Actions on every pull request. A change that drops the pass rate below
  the agreed threshold cannot merge.

**Checking the checker.** Imran grades a set of real or synthetic conversations by hand.
We report how often the model grader agrees with him, and fix the grader until it does.

**Tracing.** Every turn logged to Langfuse: model, prompt version, latency, tokens, cost,
tool calls.

**Limits.** Per-conversation cost cap, daily spend cap, per-visitor rate limit.

**Fallbacks.** Model timeout or error: retry once, then Haiku 4.5. Voice failure: text.

**"How it's built" page.** Live eval pass rate, median response time and cost per
conversation, plus a diagram of the pieces and links into the repo.

## Stack

- Agent, pipeline, evals: Python.
- Database: Postgres on Neon.
- Tracing: Langfuse.
- Email: Resend.
- Agent server: Fly.io. Website: stays on Vercel.
- CI: GitHub Actions.

Accounts Imran provides: Anthropic, Neon, Langfuse, Resend, Fly. Voice accounts
(Deepgram, a TTS provider, LiveKit) come in phase 2.

## Build order

1. Brain in text, with tracing from day one.
2. Evals, CI gate, and the grading round.
3. Research pipeline and prospect links.
4. Summary page and email.
5. Agent chip on getaiengineer.dev: a small "Talk to Aiyaz" chip directly under the hero's
   Book-a-call button opens the conversation (text first, voice once phase 2 lands). It is the
   only entry point on the homepage. It ships only when Aiyaz can answer; no dead chip.
6. Voice.
7. "How it's built" page.

## Out of scope

- Gulf Arabic (later, gated on a native speaker's judgement).
- Sending outreach automatically. Imran sends every link himself.
- Model training or fine-tuning.
- Payments or booking inside the agent; it links to the booking page.

## Open items

- Conversation model: this design says Claude Sonnet 5 for speed and cost in live voice.
  Claude Opus 5 is the more capable default. Imran to confirm; the model is one config value.

- Eval pass threshold: set after the first full run shows the baseline.
- Booking link and email address: still placeholders on the website.
