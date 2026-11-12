// The LiveKit library logs what the visitor and Aiyaz said (transcripts, replies) under
// "lk.pii.*" keys. It has no switch to keep them off stdout, so the worker swaps the
// library's logger for a child that drops those keys. Worker logs carry ids and numbers only.
import { log } from "@livekit/agents";

// Where @livekit/agents keeps its process-wide logger (log_core.js). log() reads it on every call.
const LOGGER_SLOT = Symbol.for("@livekit/agents:logger");
const PII_PREFIX = "lk.pii.";

type Fields = Record<string, unknown>;
type PinoLike = ReturnType<typeof log>;

function withoutSpokenText(fields: object): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) if (!key.startsWith(PII_PREFIX)) out[key] = value;
  return out;
}

// Call at the top of the job entry, before the session, STT and TTS are built: they capture
// log() when constructed. Both `dev` and `start` run jobs through the same entry.
export function hideSpokenTextInLibraryLogs(): void {
  const safe = log().child({}, { formatters: { log: withoutSpokenText } }) as PinoLike;
  // Fields bound on a child logger skip formatters.log, so strip them as children are made.
  // Pino children inherit from their parent, so every descendant uses this too.
  const pinoChild = safe.child;
  safe.child = function (this: PinoLike, bindings: Fields, options?: object) {
    return pinoChild.call(this, withoutSpokenText(bindings), options);
  } as PinoLike["child"];
  (globalThis as Record<symbol, unknown>)[LOGGER_SLOT] = safe;
}
