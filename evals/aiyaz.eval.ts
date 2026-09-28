import { evalite } from "evalite";
import { PERSONAS, type Persona } from "./personas.js";
import { aiDisclosure, noForbiddenName, noUnconfirmedFact, onlySprintPriceScorer } from "./scorers.js";
import { runPersona, type RunResult } from "./simulate.js";

evalite<Persona, RunResult>("Aiyaz: discovery conversations", {
  data: PERSONAS.map((p) => ({ input: p })),
  task: (persona) => runPersona(persona),
  scorers: [aiDisclosure, noForbiddenName, onlySprintPriceScorer, noUnconfirmedFact],
  columns: ({ input, output }) => [
    { label: "Persona", value: input.id },
    { label: "Ended", value: output.endReason },
    { label: "Cost", value: `$${output.costUsd.toFixed(3)}` },
    {
      label: "Transcript",
      value: output.transcript.map((t) => `${t.role === "aiyaz" ? "Aiyaz" : "Prospect"}: ${t.text}`).join("\n\n"),
    },
  ],
});
