# Aiyaz brief board and first outreach: design

Date: 2026-10-05. Status: agreed with Imran in conversation, awaiting his review of this file.
Builds on: `2026-10-05-aiyaz-live-voice-design.md` (live voice, lead links, limits, privacy).

## What we are doing and why

Aiyaz becomes a page, not a card. A visitor talks to Aiyaz and watches a brief of their AI
initiative build itself on screen. They can correct any part of it, keep it at a private
link, share it with their team, and book 30 minutes with the team from it.

The first use is outreach: Imran sends 10 UAE founders and CEOs a personal LinkedIn message
with their Aiyaz link. Success is **2 booked calls with the team** from those 10.

The homepage keeps one job for Aiyaz: a "Talk to Aiyaz" card that sends visitors to the same
page, starting from a blank brief.

## Decisions (Imran, 2026-10-05)

| Question | Decision |
|---|---|
| First audience | UAE founders and CEOs (Series A to C, AI feature live or in pilot) |
| Channel | LinkedIn message from Imran's profile, sent by hand |
| The ask | "Talk to Aiyaz first"; Aiyaz then offers a booking with the team |
| Landing | A focused Aiyaz page, not the homepage |
| After the call | Aiyaz offers the booking; summary email repeats it |
| No call | One LinkedIn nudge after 3 days, worded for "opened" or "not opened" |
| First batch | 10 leads; success = 2 bookings |
| Homepage | Card CTA "Talk to Aiyaz" goes to the same page, blank brief; email before the call |
| Board | The AI initiative brief (fixed cards, below) |
| Visitor edits during a call | Aiyaz uses them silently; never mentions the edit |
| After the call | Board is saved; a private link lets them revisit, edit and share |
| Coming back | They can talk again from a saved board; Aiyaz continues from it |
| Live updates | Through the call connection (LiveKit), saved after every change |
| Layout | Wide call card on top, board below (Ethos-style, mockup "B") |

## The flow

1. **Imran sends the LinkedIn message** (templates below) with the lead's link
   `getaiengineer.dev/aiyaz?ref=<slug>`. Slugs work as they do today.
2. **The lead lands on the Aiyaz page**: "Your AI initiative, Acme", a wide call card
   ("Hi Acme team. I've read a little about you. Ten minutes and I'll turn it into a brief
   you can share."), a **Talk to Aiyaz** button, and "Rather not talk to an AI? Book a call ·
   WhatsApp". The board below shows the company and brief facts marked **to confirm**.
3. **The call.** Opener (fixed, from code): "Hi Acme, I'm Aiyaz, an AI agent. Who am I
   speaking with?" Cards fill in as Aiyaz learns things; the newest card is highlighted;
   a confirmed brief fact gets a tick, a rejected one disappears.
4. **The close.** Aiyaz gives a short summary, asks for their email to send it, and offers a
   30-minute call with the team: "Would a 30-minute call with the team be useful? The
   button is on your screen."
5. **After.** The page says "Your brief is saved at a private link. Share it with your
   team." with **Book 30 min with the team** and **Talk again**. The visitor gets the summary
   email (brief cards, booking link, link to their board). Imran gets the team email.
6. **No call in 3 days:** Imran sends one nudge. The site's tracking (visits by lead tag)
   tells him whether the link was opened.

**Homepage visitor:** the card says **Talk to Aiyaz** and links to `getaiengineer.dev/aiyaz`.
The page shows "Your AI initiative", a general welcome, the email field with the privacy
note, and an empty board ("your notes build here"). Opener: "I'm Aiyaz, an AI agent. What is
your company trying to do with AI?" Everything else as above.

## The page

One page, `/aiyaz`, three states: **before**, **during**, **after** (mockups in
`.superpowers/brainstorm/`, screens `layout.html`, `states.html`). Layout B:

- Title line: "Your AI initiative" (+ ", <Company>" for a lead).
- Wide call card: orb, one or two lines of copy, primary button. During a call: "● LIVE
  mm:ss", Aiyaz's latest question as a caption, **End call**. After: confirmation line,
  **Book 30 min with the team**, **Talk again**.
- Board: a grid of cards (2 columns on phones, 4 on wide screens). Empty cards are dashed
  with a hint; "to confirm" cards are dashed with an amber tag.
- A compact **Talk to Aiyaz** button pins top right once the visitor scrolls past the card.
- Microphone denied, limits, errors: the existing messages and the booking / WhatsApp
  fallback.

## The board

Cards, in order (each a short text, at most 200 characters):

| Card | Filled from |
|---|---|
| Company | lead brief company name; then what the visitor says (new note `company`) |
| What AI should do | `ai_feature` |
| Who it's for | `users` |
| Stage (idea / pilot / live) | new note `stage` |
| Who owns it | `owner` |
| What's blocking it | `add_symptoms` (joined) |
| What they've tried | `add_tried` (joined) |
| From the brief | each unconfirmed brief fact, "to confirm"; ticked on `confirm_facts`, removed on `reject_facts` |

`record_notes` gains two optional fields, `company` and `stage` (`idea`, `pilot`, `live`).
Name, role and email stay off the board (they are contact details, not the brief).

**Editing.** Every card is editable before, during and after a call. An edit during a call
goes to Aiyaz, which updates its notes **silently**: the next model call sees the corrected
value; Aiyaz never says it noticed. Edits are plain text, trimmed, capped at 200 characters,
and given to the model as visitor-provided data inside a clearly marked block, never as
instructions. Editing a "to confirm" fact counts as confirming the edited version.

## How it works

**Live (during a call), through the LiveKit room the call already uses:**
- Worker to page: after every notes change, the worker sends the whole board as JSON on a
  text stream, topic `aiyaz.board`. The page renders whatever it last received.
- Page to worker: an edit is sent as an RPC `aiyaz.edit` `{ card, value }`. The worker
  validates it, applies it to the notes, sends the updated board back, and saves.

**Saved boards:**
- Each call gets a board id: 22 random URL-safe characters, never derived from the company.
  Stored in Upstash at `aiyaz:board:<id>`, JSON `{ company, cards, facts, updatedAt }`,
  30-day expiry, refreshed on each edit.
- Board link: `getaiengineer.dev/aiyaz/b/<id>`. The link is the key; anyone with it can view
  and edit. It is sent only in the visitor's summary email and shown on their screen.
- Site API: `GET /api/aiyaz-board?id=` returns the board; `PUT` with `{ card, value }` saves
  an edit made outside a call. Same validation as live edits. Per-IP limit on writes.
- **Talk again** from a saved board: the token request carries the board id; the dispatch
  metadata gains `board`; the worker loads the board as the starting notes. Opener: "Welcome
  back, I'm Aiyaz, an AI agent. Shall we pick up where we left off?" Same daily limits.

**Homepage calls** need the server switch `AIYAZ_HOMEPAGE_CALLS=true` (built, off today) and
the email step (built, behind `HOMEPAGE_CALLS` in `call-core.js`). Both turn on with this page.

**Aiyaz's ending** changes from "the team will send you a summary" to the summary, the
email question, and the booking offer above. The `end_conversation` rule stays.

## Privacy

- The board holds what the visitor said about their company. It lives only in Upstash, 30
  days, behind an unguessable link; never in logs, the repo, or LiveKit Cloud recordings
  (recording stays off).
- **Privacy note (needs Imran's sign-off on wording):** "We use your email to send you a
  summary of this call and to follow up. Calls are recorded as text to improve Aiyaz and
  deleted after 30 days. Your brief is saved at a private link for 30 days."
- The team email links to the board; the visitor email links to the board and the booking.

## Measuring the first batch

Using the existing site tracking (Upstash, by day, lead tag and country), add events:
`aiyaz_page`, `email_given` (homepage only), `call_started`, `call_completed`,
`board_edited`, `booking_click`, `board_revisit`. `npm run stats` prints them per lead tag,
so Imran can see for each of the 10 leads: opened, talked, booked.

## Outreach copy (drafts for Imran; plain English, no em-dashes)

**First message:**
> Hi {first name}, I saw {one specific thing about their AI work}. I built a 10-minute AI
> call that has already read about {company}. It asks a few questions and turns your
> answers into a short brief of your AI initiative that you can keep and share. No sign-up:
> {link}. If it's useful, there's a button to talk to my team at the end.

**Nudge, opened but no call (day 3):**
> Hi {first name}, looks like you had a look at the Aiyaz page. If talking to an AI isn't
> your thing, you can book 30 minutes with us directly: {booking link}.

**Nudge, not opened (day 3):**
> Hi {first name}, quick nudge on this. It takes 10 minutes and you keep the brief: {link}.

## Phase 2: live company research (Imran, 2026-10-05)

Ships after the board. While the visitor talks, a research helper looks up the company on the
public web and adds what it finds to the board.

- **When it runs:** once the company is known (from the lead brief, or the first time the
  visitor names it on a homepage call). One research run per call; a "Talk again" call
  reuses the saved findings and does not search again.
- **How:** a separate Claude call with the Anthropic web search tool, running beside the
  conversation, never blocking a reply. Limited to about 5 searches and 20 seconds.
- **What it looks for, company only:** what the company does, stage (founded year, funding
  round named without amounts), approximate headcount band, location, recent news, AI or
  data hiring, a public company-register or free-zone listing if one turns up.
- **Never about the person** on the call: no searching their name, profile or history.
- **LinkedIn:** only what appears in public search results. No logging in, no scraping.
- **What appears on the board:** up to 5 "Found online" cards, each one short sentence with
  its source link and the tag **to confirm**. Same rules as brief facts: asked, never
  asserted; a fact with no source or with a money amount is dropped before it reaches the
  board or Aiyaz. Visitors can edit or delete them like any card.
- **How Aiyaz uses them:** they join the model's context as unconfirmed facts. Aiyaz may ask
  about at most one or two ("I saw you're hiring ML engineers. Is that for this project?").
  `confirm_facts` / `reject_facts` work on them as on brief facts.
- **Cost:** counted in the call's cost and the USD 1 per-call cap (expected a few cents).
  If the cap is near, research is skipped.
- **Failure:** no results or an error simply means no "Found online" cards. Logs carry the
  call id and a count only.
- **Privacy:** findings are stored with the board (30 days) and in the call log; never in
  logs or the repo. The team email lists them with their sources.

## Out of scope

- Sending messages automatically (Imran sends every message himself).
- A recorded example call on the homepage (replaced by the "Talk to Aiyaz" card).
- Arabic, accounts or logins, team workspaces, PDF export of the board.
- Further latency work (Imran, 2026-10-05: current speed is the right balance).

## Testing

- Unit: board built from notes (each card, facts to confirm / ticked / removed); edit
  validation (length, trimming, plain text, unknown card rejected); edits reach the next
  model call as data; board id format; board API get / put / limits; dispatch metadata with
  `board`; "welcome back" opener keeps the AI disclosure in its first sentence and the name
  scrub.
- Browser check (local and on preview): the three states for homepage and lead, live card
  updates during a call, an edit during a call, a revisit from the saved link, 390 px width,
  keyboard and screen reader labels on cards.
- One live call per path (homepage, lead, revisit) before the first LinkedIn message goes
  out.
- Phase 2: research output parsing (sourceless and money facts dropped, at most 5 cards);
  research never searches the visitor's name; runs once per call and is skipped near the
  cost cap; a failed search leaves the call unaffected; evals with made-up companies only.

## Open for Imran

1. Privacy note wording above.
2. The page address: `getaiengineer.dev/aiyaz` (proposed).
3. The outreach copy drafts.
4. Phase 2: whether the visitor sees a small "Aiyaz is looking you up online" note when
   research starts (proposed: yes, one line on the board).
