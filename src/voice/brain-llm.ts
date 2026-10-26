// Plugs the Aiyaz brain into LiveKit in place of an LLM plugin. LiveKit hears, decides when
// the visitor has finished and speaks; the brain decides what to say, once per turn.
import { DEFAULT_API_CONNECT_OPTIONS, llm } from "@livekit/agents";
import { TurnRunner, type Brain, type TurnRunnerOptions } from "./turns.js";

type StreamOpts = ConstructorParameters<typeof llm.LLMStream>[1];

class BrainStream extends llm.LLMStream {
  constructor(
    private readonly turns: TurnRunner,
    owner: llm.LLM,
    opts: StreamOpts,
  ) {
    super(owner, opts);
  }

  protected async run(): Promise<void> {
    const last = [...this.chatCtx.items]
      .reverse()
      .find((i): i is llm.ChatMessage => i.type === "message" && i.role === "user");
    if (!last) return;
    const said = await this.turns.handle(last.id, last.textContent ?? "", this.abortController.signal);
    if (said) this.queue.put({ id: last.id, delta: { role: "assistant", content: said } });
  }
}

export class BrainLLM extends llm.LLM {
  // Public so the worker can report replies the visitor cut off.
  readonly turns: TurnRunner;

  constructor(brain: Brain, options: TurnRunnerOptions = {}) {
    super();
    this.turns = new TurnRunner(brain, options);
  }

  label(): string {
    return "aiyaz-brain";
  }

  chat({ chatCtx, toolCtx, connOptions = DEFAULT_API_CONNECT_OPTIONS }: Parameters<llm.LLM["chat"]>[0]): llm.LLMStream {
    // maxRetry 0: a LiveKit retry must never become a second reply() for one turn.
    return new BrainStream(this.turns, this, { chatCtx, toolCtx, connOptions: { ...connOptions, maxRetry: 0 } });
  }
}
