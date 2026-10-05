// The Aiyaz voice worker: LiveKit hears and speaks, the Conversation decides what to say.
// Local: pnpm voice:dev      Fly.io: pnpm voice:start
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, voice } from "@livekit/agents";
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
import { kvFromEnv } from "../kv.js";
import { AnthropicLLM } from "../llm.js";
import { JsonlTracer } from "../tracer.js";
import { BrainLLM } from "./brain-llm.js";
import { AGENT_NAME, parseCallMeta } from "./meta.js";
import { startCallTimer } from "./turns.js";

function makeTts(s: Settings) {
  return s.ttsProvider === "cartesia"
    ? new cartesia.TTS(s.ttsVoiceId ? { voice: s.ttsVoiceId } : {})
    : new elevenlabs.TTS(s.ttsVoiceId ? { voiceId: s.ttsVoiceId } : {});
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
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
    });

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new deepgram.STT({ model: "nova-3" }),
      tts: makeTts(settings),
      llm: new BrainLLM(brain),
      ttsTextTransforms: ["filter_markdown", "filter_emoji"],
      // Off: a speculative run would call the stateful brain before the visitor finished.
      turnHandling: { preemptiveGeneration: { enabled: false } },
    });

    // Spike measurement: from the visitor's final words to Aiyaz starting to speak.
    let heardAt = 0;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal) heardAt = Date.now();
    });

    let closing = false;
    const hangUp = async (line: string) => {
      if (closing) return;
      closing = true;
      if (line) await session.say(line).waitForPlayout();
      ctx.shutdown("call ended");
    };
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === "speaking" && heardAt) {
        console.log(`[latency] ${Date.now() - heardAt} ms`);
        heardAt = 0;
      }
      // Aiyaz has given its summary and called end_conversation: leave once it stops talking.
      if (ev.newState === "listening" && brain.ended) void hangUp("");
    });
    // The 10-minute cap, even if the visitor never speaks.
    const stopTimer = startCallTimer(settings.maxSeconds, () => void hangUp(brain.end("time_limit")));
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
      if (kv) {
        await storeCall(kv, log, { transcriptDays: settings.transcriptDays, reservedUsd: settings.costCapUsd }).catch((err) =>
          console.error(`[call] store failed: ${String(err)}`),
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

    await session.start({ agent: new voice.Agent({ instructions: "" }), room: ctx.room });
    // Fixed text from code: the AI disclosure never depends on the model.
    session.say(brain.start());
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
