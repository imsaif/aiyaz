// Carries the board to the visitor's page (LiveKit text stream) and to Upstash, in order.
// Boards pushed while one is being sent are coalesced: only the newest goes next, so a slow
// save can never overwrite a newer board. Failures are logged as a fixed phrase, never content.
import { RpcError, type RpcInvocationData } from "@livekit/rtc-node";
import { baselineOf, parseEdit, saveSince, type Baseline, type Board, type Edit } from "../board.js";
import type { KV } from "../kv.js";

export const BOARD_TOPIC = "aiyaz.board";
export const EDIT_METHOD = "aiyaz.edit";
// The page calls this once it listens for boards, so a late subscriber gets the current one.
export const HELLO_METHOD = "aiyaz.hello";
// RpcError codes 1001 to 1999 are reserved by LiveKit.
export const EDIT_REJECTED = 2400;

export type BoardLinkIO = {
  send: (json: string) => Promise<void>;
  save: (board: Board) => Promise<void>;
  log: (what: string) => void;
};

export class BoardLink {
  private latest: Board | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly io: BoardLinkIO) {}

  // Handed to the Conversation as onBoard, inside its tool-result handling: it only queues the
  // board and never throws, or a tool call could be left without its result.
  push(board: Board): void {
    try {
      this.latest = board;
      this.kick();
    } catch {
      this.say("push failed");
    }
  }

  // Resolves once every pushed board has been sent and saved (or has failed). Never rejects.
  async flush(): Promise<void> {
    while (this.running) await this.running;
  }

  private kick(): void {
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.latest) this.kick();
    });
  }

  private async drain(): Promise<void> {
    while (this.latest) {
      const board = this.latest;
      this.latest = null;
      try {
        await this.io.send(JSON.stringify(board));
      } catch {
        this.say("send failed");
      }
      try {
        await this.io.save(board);
      } catch {
        this.say("save failed");
      }
    }
  }

  // A log that throws must not reject the drain (an unhandled rejection ends the process).
  private say(what: string): void {
    try {
      this.io.log(what);
    } catch {
      // Nothing left to tell.
    }
  }
}

// The worker's save: never overwrites a board someone else changed since it last loaded or
// saved it (see saveSince). The baseline starts at the loaded board, or null for none.
export function boardSaver(kv: KV, id: string, baseline: Baseline | null): (board: Board) => Promise<void> {
  return async (board) => {
    baseline = baselineOf(await saveSince(kv, id, board, baseline));
  };
}

// The aiyaz.hello RPC handler: queues the current board again and always answers "ok".
export function helloHandler(push: () => void): (data: RpcInvocationData) => Promise<string> {
  return async () => {
    try {
      push();
    } catch {
      // The board still goes out with the next change.
    }
    return "ok";
  };
}

// The aiyaz.edit RPC handler. Anything not accepted, including an unexpected throw, is the same
// rejection: a code outside LiveKit's reserved range and a fixed message that echoes nothing.
export function editHandler(apply: (edit: Edit) => Board | null): (data: RpcInvocationData) => Promise<string> {
  return async (data) => {
    let ok = false;
    try {
      const edit = parseEdit(data.payload);
      ok = edit !== null && apply(edit) !== null;
    } catch {
      ok = false;
    }
    if (!ok) throw new RpcError(EDIT_REJECTED, "invalid edit");
    return "ok";
  };
}
