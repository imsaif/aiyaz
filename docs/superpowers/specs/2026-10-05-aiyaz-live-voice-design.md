# Aiyaz live voice on getaiengineer.dev

Date: 2026-10-05. Status: draft for Imran's review.
Builds on: `2026-09-28-aiyaz-design.md` (the agent), `2026-10-01-aiyaz-uae-knowledge-design.md`
(prompt v2, market packs, AED price, Arabic switch) and the 2026-09-30 per-company voice plan
on branch `voice-company-page`, which this spec replaces.

## What it is

Visitors to getaiengineer.dev talk out loud with Aiyaz. Two ways in:

1. **Homepage call.** Anyone on the site presses the Aiyaz card, gives an email, and talks.
   Aiyaz starts from nothing about their company and adapts to the visitor's country.
2. **Lead call.** Each outreach lead gets a private link. Aiyaz loads that company's research
   brief and opens by confirming one fact ("I read that you ... Is that right?").

Both end the same way: a short spoken summary, then the booking link and WhatsApp shown on
screen, and an email to the team with the visitor's email, company and Aiyaz's summary.

## Decisions made (Imran, 2026-09-30 and 2026-10-05)

- Voice first, not text.
- Own stack: LiveKit for the call, Deepgram to hear, ElevenLabs or Cartesia to speak, the
  existing Aiyaz brain (`Conversation`) to think. Hosted voice platforms were rejected.
- Homepage visitors give an email before the call starts, with a one-line privacy note.
- After each call the team gets an email via Resend.
- Daily spend cap: USD 5 across all calls.
- At any limit or failure, Aiyaz offers the booking link and WhatsApp.
- One Aiyaz that adapts to the visitor's country (below). Arabic stays off until the native
  Emirati review passes.

## Country

The site already reads the visitor's country (`x-vercel-ip-country`). The call token carries
it to the worker, which sets:

| Country | Price Aiyaz may say | Market pack |
|---|---|---|
| AE (and other GCC) | AED 25,000 | `uae.v1` |
| IN | USD 6,000 | general (India pack comes with the November India test) |
| anything else or unknown | AED 25,000 | general |

The price must always match what the site shows that visitor. `prices` in settings becomes a
map by country; the price guard checks against the visitor's own price. A short `general.v1`
pack (how AI initiatives usually stall, no country specifics, no money amounts) is added.

## Lead calls and private briefs

- A lead link is `getaiengineer.dev/?ref=<slug>`, where the slug is the company name plus a
  random suffix (e.g. `acme-7k2q`), so a leaked link does not name a client by guessing.
- Briefs are private and never enter this public repo, its tests, fixtures or traces. They
  live in the site's Upstash store under `aiyaz:brief:<slug>`, written by a local script from
  the lead tracker's "Aiyaz brief facts" column. Tests use the made-up company "Acme".
- A lead call needs no email gate: the link already identifies the company. Aiyaz still asks
  for an email at the end to send the summary.
- Unknown or missing slug: the call runs as a homepage call.
- The site shows the company display name on the card ("Talk to Aiyaz about Acme") only for a
  valid slug.

## The pieces

1. **Token function** (site repo, `api/aiyaz-token.js`, Vercel edge): checks the email or slug,
   the per-visitor limit and the daily cap, then mints a short-lived LiveKit token whose
   metadata holds `{ country, slug?, email? }`.
2. **Voice worker** (this repo, LiveKit Agents for Node, hosted on Fly.io): joins the room,
   wraps `Conversation`, Deepgram in, TTS out, turn-taking and interruptions by LiveKit. A
   custom `llm.LLM` hands each finished visitor turn to `Conversation.reply()` exactly once.
3. **Call page** (site repo): the existing Aiyaz card becomes the call button, with the email
   step, microphone prompt, live captions, and the end screen with booking and WhatsApp.
4. **Summary and notify** (this repo): on session close, build the summary from notes, store
   the transcript, and send the email to `AIYAZ_SUMMARY_TO` via Resend.
5. **Limits** (both): per call 10 minutes and USD 1; per visitor (email or IP) 3 calls a day;
   USD 5 a day across all calls, counted in Upstash. At a limit the card shows booking and
   WhatsApp instead of starting a call.

## Rules carried over

- Aiyaz says it is an AI in its first sentence; the opener is fixed text from code.
- It never says a person's name for the team ("the team").
- A company fact is asked, never asserted, until the visitor confirms it.
- No stage directions, tool acknowledgements or bracketed notes are ever spoken.
- Secrets only in environment variables.
- Copy: plain English, no em-dashes, no hype words.

## Data

- Kept: visitor email, country, slug, transcript, notes, summary, cost, duration.
- Transcripts are deleted after 30 days (assumption, Imran to confirm).
- Privacy note at the email step: "We use your email to send you a summary of this call and to
  follow up. Calls are recorded as text to improve Aiyaz and deleted after 30 days."

## Failure handling

| Situation | What the visitor sees |
|---|---|
| Microphone denied | "Aiyaz needs your microphone to talk. You can book a call or message us instead." + links |
| Voice service down, token fails, cap reached | Booking and WhatsApp, no call |
| Visitor silent after the opener | Aiyaz waits; the 10-minute cap ends the call |
| Visitor interrupts | Aiyaz stops; the next finished turn goes to `reply()` once |
| Tab closed early | The worker still builds the summary and sends the email on session close |

## Testing

- Unit: country to price and pack; price guard per country; token function rejects bad email,
  over-limit visitor and over-cap day; brief loading never reads repo files; `reply()` once
  per turn under interruption.
- Evals: existing personas, plus an India visitor (must say USD 6,000), a lead call with an
  Acme brief, and a silent visitor.
- Voice spike gates before building the page: round-trip latency under about 1.5 s, clean
  interruption, no model call on silence.
- Live check on a preview deploy, then on the site, by Imran from India and someone in the UAE
  if possible.

## Accounts Imran provides

LiveKit Cloud (free plan), Deepgram, ElevenLabs and/or Cartesia (voice audition), Resend
(sends from the getaiengineer.dev domain), Fly.io (worker hosting). Anthropic key exists.
The Upstash store must be connected to the getaiengineer Vercel project.

## Build order

1. Bring the useful parts of `voice-company-page` onto current main (per-turn serializer,
   brief loading), dropping its old prompt v2, which current main already replaced.
2. Country settings: price map, general pack, guard per country.
3. Voice spike: LiveKit worker with Deepgram and a TTS, local, against the gates above.
4. Voice audition: two or three voices; Imran picks.
5. Summary, transcript store, Resend email.
6. Token function with email gate, limits and daily cap.
7. Call page on the site, replacing the example card.
8. Deploy worker to Fly.io, preview test, go live, card label back to "Talk to Aiyaz".

## Out of scope

Arabic voice, the India market pack, text chat, the public "how it's built" numbers page.
