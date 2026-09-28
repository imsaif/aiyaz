import { appendFileSync } from "node:fs";

export type CallRecord = {
  ts: string;
  conversationId: string;
  role: "conversation" | "simulator" | "judge";
  model: string;
  promptId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stopReason: string | null;
  toolCalls: string[];
  fallbackUsed: boolean;
  error?: string;
};

export interface Tracer {
  record(call: CallRecord): void;
}

export class JsonlTracer implements Tracer {
  constructor(private readonly path: string) {}
  record(call: CallRecord): void {
    appendFileSync(this.path, JSON.stringify(call) + "\n");
  }
}

export class MemoryTracer implements Tracer {
  readonly calls: CallRecord[] = [];
  record(call: CallRecord): void {
    this.calls.push(call);
  }
}
