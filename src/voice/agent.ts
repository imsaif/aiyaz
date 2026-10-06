// The Aiyaz voice worker: LiveKit hears and speaks, the Conversation decides what to say.
// Local: pnpm voice:dev      Fly.io: pnpm voice:start
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, type llm, voice } from "@livekit/agents";
import * as cartesia from "@livekit/agents-plugin-cartesia";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { boardUrl } from "../board.js";
import { buildCallLog, sendCallEmails, storeCall } from "../calllog.js";
import { forCountry, loadSettings, type Settings } from "../config.js";
import { Conversation } from "../conversation.js";
import { kvFromEnv, kvMissingNotice } from "../kv.js";
import { AnthropicLLM } from "../llm.js";
import { JsonlTracer } from "../tracer.js";
import { BOARD_TOPIC, BoardLink, boardSaver, EDIT_METHOD, editHandler, HELLO_METHOD, helloHandler } from "./board-link.js";
import { BrainLLM } from "./brain-llm.js";
import { finishCall } from "./call-end.js";
import { callStart } from "./call-start.js";
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
    // A saved board ("Talk again") wins over the lead brief.
    const begin = await callStart(kv, meta);
    const settings = forCountry(loadSettings(), meta.country);
    const startedAt = Date.now();

    // The board goes to the visitor's page on every change and is saved under the id from the
    // token. Logs name the call id only: never the board id, link or content.
    const saveToStore = kv && meta.board ? boardSaver(kv, meta.board, begin.baseline ?? null) : null;
    const link = new BoardLink({
      send: async (json) => {
        const me = ctx.room.localParticipant;
        // Nobody left to show it to (the visitor hung up): saving is enough.
        if (!me || ctx.room.remoteParticipants.size === 0) return;
        await me.sendText(json, { topic: BOARD_TOPIC });
      },
      // Compare-and-set: a visitor's PUT edit newer than the worker's last load or save is
      // merged in, never overwritten.
      save: async (board) => {
        if (saveToStore) await saveToStore(board);
      },
      log: (what) => console.error(`[board] ${brain.id} ${what}`),
    });

    const brain = new Conversation({
      settings,
      llm: new AnthropicLLM(settings.requestTimeoutMs),
      tracer: new JsonlTracer(settings.traceFile),
      brief: begin.brief,
      start: begin.saved,
      slug: begin.slug,
      emailKnown: meta.email !== null,
      // Called inside the Conversation's tool-result handling: it only queues, and never throws.
      onBoard: (board) => {
        try {
          link.push(board);
        } catch {
          // push already never throws; this guard keeps a tool call from losing its result.
        }
      },
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
      // Aiyaz has given its goodbye and called end_conversation: leave once it stops talking.
      if (ev.newState === "listening" && brain.ended) void hangUp("");
    });
    // The 10-minute cap, even if the visitor never speaks.
    const stopTimer = startCallTimer(settings.maxSeconds, () => void hangUp(brain.end("time_limit"), { interrupt: true }));
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => ctx.shutdown("visitor left"));

    let logged = false;
    ctx.addShutdownCallback(async () => {
      // No more edits or board requests from the page once the call is closing.
      try {
        ctx.room.localParticipant?.unregisterRpcMethod(EDIT_METHOD);
        ctx.room.localParticipant?.unregisterRpcMethod(HELLO_METHOD);
      } catch {
        // Already gone with the room.
      }
      stopTimer();
      if (logged) return;
      logged = true;
      // Every change was already pushed; wait for those saves before the emails link to the board.
      // No extra push here: it could land after a visitor's post-call edit.
      const log = await finishCall({
        id: brain.id,
        flush: () => link.flush(),
        build: () => {
          const board = brain.board();
          return buildCallLog({
            id: brain.id,
            startedAt,
            endedAt: Date.now(),
            meta,
            company: board.company ?? begin.company,
            endReason: brain.endReason ?? "visitor_left",
            claudeUsd: brain.costUsd,
            notes: brain.notes,
            transcript: brain.transcript,
            voiceUsdPerMinute: settings.voiceUsdPerMinute,
            board,
            boardUrl: kv && meta.board ? boardUrl(settings.siteUrl, meta.board) : null,
          });
        },
        // Settles on the metadata's reserved day and amount; costCapUsd is only the fallback.
        store: kv ? (l) => storeCall(kv, l, { transcriptDays: settings.transcriptDays, reservedUsd: settings.costCapUsd }) : null,
        // sendCallEmails skips quietly without a key.
        email: (l) => sendCallEmails(l, { apiKey: process.env.RESEND_API_KEY, to: settings.summaryTo, from: settings.summaryFrom }),
        error: (line) => console.error(line),
      });
      // Ids and numbers only: transcripts and boards never go to the logs.
      console.log(
        `[call] ${log.id} ${log.endReason} ${log.durationSec}s USD ${log.costUsd.toFixed(3)} country=${log.country ?? "?"} lead=${log.slug ? "yes" : "no"} revisit=${begin.saved ? "yes" : "no"}`,
      );
    });

    // record: LiveKit Cloud session reports carry transcript and audio, so they stay off by default.
    // start() connects the room, so the local participant exists after it.
    await session.start({ agent: new AiyazAgent(playout), room: ctx.room, record: settings.livekitRecord });
    // Card edits from the visitor's page. Applied silently; nothing about an edit is logged.
    ctx.room.localParticipant?.registerRpcMethod(EDIT_METHOD, editHandler((edit) => brain.edit(edit)));
    // The page asks for the current board once it listens, so a late subscriber never sits empty.
    ctx.room.localParticipant?.registerRpcMethod(HELLO_METHOD, helloHandler(() => link.push(brain.board())));
    // Fixed text from code: the AI disclosure never depends on the model.
    session.say(brain.start(), { allowInterruptions: false });
    // The starting board (lead facts, or the saved board), shown and saved at once.
    link.push(brain.board());
  },
});

// Read the settings once at boot, so a bad value (for example an unknown AIYAZ_TTS) stops the
// worker before it registers with LiveKit, not at the start of a visitor's call.
loadSettings();
const kvNotice = kvMissingNotice();
if (kvNotice) console.log(kvNotice);

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
