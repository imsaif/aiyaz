import { rmSync } from "node:fs";
import { evalite } from "evalite";
import { PERSONAS, type Persona } from "./personas.js";
import {
  aiDisclosure,
  arabicNaturalness,
  endsOnSilence,
  englishWhenOff,
  gulfDialect,
  noForbiddenName,
  noUnconfirmedFact,
  onlySprintPriceScorer,
  quotesVisitorPrice,
} from "./scorers.js";
import { runPersona, type RunResult } from "./simulate.js";

// The Arabic review sheet must only show replies from this run.
rmSync("arabic-review.jsonl", { force: true });

evalite<Persona, RunResult>("Aiyaz: discovery conversations", {
  data: PERSONAS.map((p) => ({ input: p })),
  task: (persona) => runPersona(persona),
  scorers: [aiDisclosure, noForbiddenName, onlySprintPriceScorer, noUnconfirmedFact, gulfDialect, arabicNaturalness, englishWhenOff, quotesVisitorPrice, endsOnSilence],
  columns: ({ input, output }) => [
    { label: "Persona", value: input.id },
    { label: "Country", value: input.country ?? "unknown" },
    { label: "Ended", value: output.endReason },
    { label: "Cost", value: `$${output.costUsd.toFixed(3)}` },
    {
      label: "Transcript",
      value: output.transcript.map((t) => `${t.role === "aiyaz" ? "Aiyaz" : "Prospect"}: ${t.text}`).join("\n\n"),
    },
  ],
});
