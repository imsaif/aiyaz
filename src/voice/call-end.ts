// The end of a call: wait for the board's last save, then store the call log and send the
// emails. No step stops a later one, and failures are logged by call id and error name only.
import type { CallLog } from "../calllog.js";

// How long the end of a call waits for the board's last save (a stalled store, or a send on a
// closing room) before it stores the call and sends the emails anyway.
export const FLUSH_CAP_MS = 5000;

export type CallEnd = {
  // The call id, for log lines.
  id: string;
  // Waits for every pushed board to be sent and saved.
  flush: () => Promise<void>;
  build: () => CallLog;
  // null when there is no store (no KV configured).
  store: ((log: CallLog) => Promise<void>) | null;
  email: (log: CallLog) => Promise<void>;
  error: (line: string) => void;
};

const nameOf = (err: unknown) => (err instanceof Error ? err.name : "error");

export async function finishCall(end: CallEnd): Promise<CallLog> {
  // A board store that is down has already been logged by the link; the call goes on.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), FLUSH_CAP_MS);
  });
  const flushed = end.flush().then(
    () => "done" as const,
    () => "done" as const,
  );
  if ((await Promise.race([flushed, capped])) === "timeout") {
    end.error(`[call] ${end.id} board flush timed out after ${FLUSH_CAP_MS} ms`);
  }
  clearTimeout(timer);
  const log = end.build();
  if (end.store) {
    try {
      await end.store(log);
    } catch (err) {
      end.error(`[call] ${log.id} store failed: ${nameOf(err)}`);
    }
  }
  try {
    await end.email(log);
  } catch (err) {
    end.error(`[call] ${log.id} emails failed: ${nameOf(err)}`);
  }
  return log;
}
