# Aiyaz

The voice agent for [getaiengineer.dev](https://getaiengineer.dev). A founder talks to it about their
product; it works out what their AI feature does, what is going wrong, and how a two-week sprint
would help. Design: `docs/superpowers/specs/2026-09-28-aiyaz-design.md`.

This is phase 1: the brain, in text.

## Run it

```sh
pnpm install
cp .env.example .env        # add your ANTHROPIC_API_KEY
pnpm talk                   # talk to Aiyaz in the terminal
pnpm talk brief.json        # prospect version, started from a research brief
pnpm test                   # unit tests, no network
pnpm evals                  # 8 simulated prospects, graded; results UI via `pnpm evals:watch`
```

## What is checked

| Check | How |
|---|---|
| Says it is an AI in its first sentence | Code. The opener is fixed text, never generated. |
| Never names the person behind it | Code scrub on every reply, plus an eval check. |
| Only ever quotes the $3,000 sprint | Prompt rule, plus an eval check on every money amount. |
| Never states an unconfirmed fact about the prospect's company | Model-graded eval (`evals/scorers.ts`). |

Every model call is traced to `traces.jsonl` with model, prompt version, latency, tokens and cost.
If the main model fails it retries once, then falls back to Claude Haiku 4.5.
