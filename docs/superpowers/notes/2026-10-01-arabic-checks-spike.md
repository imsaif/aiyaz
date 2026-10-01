# Arabic checks spike (Task 1)

Date: 2026-10-01. Samples: `evals/arabic/samples.json` (10 Gulf, 7 MSA, 3 Gulf mixed with English terms). The Gulf lines were written for this spike and still need Imran's check that they sound natural; results below may shift once he corrects any.

## Dialect ID: CAMeL Tools 1.6.0, model26 (MIT)

Setup: Python 3.12 venv (camel-tools does not target 3.14), `camel_data -i dialectid-model26` with `CAMELTOOLS_DATA` inside `evals/arabic/.venv/camel_data` (ignored). In camel-tools 1.6 `DialectIdentifier` is the 26-way model and `pretrained()` takes no model name.

| Set | Hits | Notes |
|---|---|---|
| Gulf (DOH/RIY/MUS) | 5 / 10 | misses labelled ALE, SAL, JED, KHA |
| MSA | 6 / 7 | one MSA line labelled RIY |
| Mixed Gulf + English | 0 / 3 | JED, JED, ALE, even with Latin words stripped |
| Overall | 11 / 20 (55%) | |

MADAR has no Dubai or Abu Dhabi label; Doha is the closest.

**Decision:** below the 80% bar, so `dialectGate` defaults to `report`. One narrower hard rule is kept: a reply labelled `MSA` fails, because MSA detection was reliable (6/7) and drifting into formal Arabic is the main risk the spec names.

## Naturalness judge

No Hugging Face token and no Ollama on this machine, so ALLaM and Jais could not be tried. Fallback per plan: `claude-sonnet-5` with the same Arabic rubric, labelled NOT open source.

| Sample | Score |
|---|---|
| Gulf x3 | 5, (truncated at 200 tokens), 5 |
| MSA x3 | 3, 3, 2 |

About 2.1-3.3 s and under 200 input / 200 output tokens per reply. `max_tokens` raised to 400 (one verdict was cut off at 200). `temperature` is rejected by this model and is not sent.

**Decision:** `AIYAZ_ARABIC_JUDGE` provider setting: `anthropic` (default now, model `claude-sonnet-5`) or `hf` (Hugging Face Inference Providers, `HF_TOKEN`, model `humain-ai/ALLaM-7B-Instruct-preview`). Switch to `hf` once a token exists and re-run this spike's six samples on it.
