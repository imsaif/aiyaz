// The Aiyaz voice worker: LiveKit hears and speaks, the Conversation decides what to say.
// Local: pnpm voice:dev      Fly.io: pnpm voice:start
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, type llm, voice } from "@livekit/agents";
import * as cartesia from "@livekit/agents-plugin-cartesia";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { loadBrief } from "../briefs.js";
import { buildCallLog, sendCallEmails, storeCall } from "../calllog.js";
import { forCountry, loadSettings, type Settings } from "../config.js";
import { Conversation } from "../conversation.js";
import { kvFromEnv, kvMissingNotice } from "../kv.js";
import { AnthropicLLM } from "../llm.js";
import { JsonlTracer } from "../tracer.js";
import { BrainLLM } from "./brain-llm.js";
import { hideSpokenTextInLibraryLogs } from "./log-redact.js";
import { AGENT_NAME, parseCallMeta } from "./meta.js";
import { PlayoutTracker } from "./playout.js";
import { SESSION_TURN_HANDLING, sessionErrorLine } from "./session-setup.js";
import { makeHangUp, startCallTimer } from "./turns.js";

function makeTts(s: Settings) {
  return s.ttsProvider === "cartesia"
    ? new cartesia.TTS(s.ttsVoiceId ? { voice: s.ttsVoiceId } : {})
    : new elevenlabs.TTS({
        ...(s.ttsVoiceId ? { voiceId: s.ttsVoiceId } : {}),
        ...(s.ttsModel ? { model: s.ttsModel } : {}),
      });
}

// Notes each finished visitor turn, so its reply's playout can be linked back to it.
class AiyazAgent extends voice.Agent {
  constructor(private readonly playout: PlayoutTracker) {
    super({ instructions: "" });
  }
  override async onUserTurnCompleted(_chatCtx: llm.ChatContext, newMessage: llm.ChatMessage): Promise<void> {
    this.playout.userTurn(newMessage.id);
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    // First: the session, STT and TTS built below capture the library logger when constructed.
    hideSpokenTextInLibraryLogs();
    const meta = parseCallMeta(ctx.job.metadata);
    const kv = kvFromEnv();
    const brief = await loadBrief(kv, meta.slug);
    const settings = forCountry(loadSettings(), meta.country);
    const startedAt = Date.now();
    const brain = new Conversation({
      settings,
      llm: new AnthropicLLM(settings.requestTimeoutMs),
      tracer: new JsonlTracer(settings.traceFile),
      brief,
      // Ids and counts only, for example when the price guard replaces a wrong amount.
      log: (line) => console.log(line),
    });

    // A reply the visitor cut off is trimmed to what they heard, in the history and the transcript.
    // The next reply waits (bounded) for that report, because LiveKit starts it first.
    const playout = new PlayoutTracker((turnId, played) => brainLlm.turns.played(turnId, played));
    const brainLlm = new BrainLLM(brain, { playoutDone: (turnId) => playout.settled(turnId) });

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new deepgram.STT({ model: "nova-3" }),
      tts: makeTts(settings),
      llm: brainLlm,
      ttsTextTransforms: ["filter_markdown", "filter_emoji"],
      turnHandling: SESSION_TURN_HANDLING,
    });

    // Spike measurement: from the visitor's final words to Aiyaz starting to speak.
    let heardAt = 0;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal) heardAt = Date.now();
    });

    session.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => playout.speechCreated(ev));
    // The library logs these only when it gives up on the session; we want every one.
    session.on(voice.AgentSessionEventTypes.Error, (ev) => console.error(sessionErrorLine(brain.id, ev)));

    const hangUp = makeHangUp({
      // allowInterruptions false: the closing line is not cut off by the visitor.
      say: (line) => session.say(line, { allowInterruptions: false }).waitForPlayout().then(() => undefined),
      interrupt: () => void session.interrupt({ force: true }),
      shutdown: () => ctx.shutdown("call ended"),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === "speaking" && heardAt) {
        console.log(`[latency] ${Date.now() - heardAt} ms`);
        heardAt = 0;
      }
      // Aiyaz has given its summary and called end_conversation: leave once it stops talking.
      if (ev.newState === "listening" && brain.ended) void hangUp("");
    });
    // The 10-minute cap, even if the visitor never speaks.
    const stopTimer = startCallTimer(settings.maxSeconds, () => void hangUp(brain.end("time_limit"), { interrupt: true }));
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => ctx.shutdown("visitor left"));

    let logged = false;
    ctx.addShutdownCallback(async () => {
      stopTimer();
      if (logged) return;
      logged = true;
      const log = buildCallLog({
        id: brain.id,
        startedAt,
        endedAt: Date.now(),
        meta,
        company: brief?.company ?? null,
        endReason: brain.endReason ?? "visitor_left",
        claudeUsd: brain.costUsd,
        notes: brain.notes,
        transcript: brain.transcript,
        voiceUsdPerMinute: settings.voiceUsdPerMinute,
      });
      // Settles on the metadata's reserved day and amount; costCapUsd is only the fallback.
      if (kv) {
        await storeCall(kv, log, { transcriptDays: settings.transcriptDays, reservedUsd: settings.costCapUsd }).catch((err) =>
          console.error(`[call] store failed: ${err instanceof Error ? err.name : "unknown"}`),
        );
      }
      // Never throws into the worker; sendCallEmails skips quietly without a key.
      try {
        await sendCallEmails(log, { apiKey: process.env.RESEND_API_KEY, to: settings.summaryTo, from: settings.summaryFrom });
      } catch (err) {
        console.error(`[call] ${log.id} emails failed: ${err instanceof Error ? err.name : "error"}`);
      }
      // Ids and numbers only: transcripts never go to the logs.
      console.log(
        `[call] ${log.id} ${log.endReason} ${log.durationSec}s USD ${log.costUsd.toFixed(3)} country=${log.country ?? "?"} lead=${log.slug ? "yes" : "no"}`,
      );
    });

    // record: LiveKit Cloud session reports carry transcript and audio, so they stay off by default.
    await session.start({ agent: new AiyazAgent(playout), room: ctx.room, record: settings.livekitRecord });
    // Fixed text from code: the AI disclosure never depends on the model.
    session.say(brain.start(), { allowInterruptions: false });
  },
});

// Read the settings once at boot, so a bad value (for example an unknown AIYAZ_TTS) stops the
// worker before it registers with LiveKit, not at the start of a visitor's call.
loadSettings();
const kvNotice = kvMissingNotice();
if (kvNotice) console.log(kvNotice);

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
