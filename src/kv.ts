// The small key-value store shared with the site (Upstash Redis over REST).
// The worker reads briefs and writes call logs and spend; tests use MemoryKV.

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exSeconds?: number): Promise<void>;
  incrByFloat(key: string, by: number, exSeconds?: number): Promise<number>;
}

export class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  readonly ttl = new Map<string, number>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string, exSeconds?: number): Promise<void> {
    this.data.set(key, value);
    if (exSeconds) this.ttl.set(key, exSeconds);
  }
  async incrByFloat(key: string, by: number, exSeconds?: number): Promise<number> {
    const next = Number(this.data.get(key) ?? 0) + by;
    this.data.set(key, String(next));
    if (exSeconds) this.ttl.set(key, exSeconds);
    return next;
  }
}

export class UpstashKV implements KV {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async pipeline(commands: string[][]): Promise<unknown[]> {
    const res = await this.fetchFn(`${this.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const failed = out.find((r) => r.error);
    if (failed) throw new Error(`Upstash: ${failed.error}`);
    return out.map((r) => r.result);
  }

  async get(key: string): Promise<string | null> {
    const [value] = await this.pipeline([["GET", key]]);
    return typeof value === "string" ? value : null;
  }

  async set(key: string, value: string, exSeconds?: number): Promise<void> {
    await this.pipeline([exSeconds ? ["SET", key, value, "EX", String(exSeconds)] : ["SET", key, value]]);
  }

  async incrByFloat(key: string, by: number, exSeconds?: number): Promise<number> {
    const commands = [["INCRBYFLOAT", key, String(by)]];
    if (exSeconds) commands.push(["EXPIRE", key, String(exSeconds)]);
    const [value] = await this.pipeline(commands);
    return Number(value);
  }
}

// Same variable names Vercel sets when Upstash is connected to the site project.
export function kvFromEnv(env: NodeJS.ProcessEnv = process.env): KV | null {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  return url && token ? new UpstashKV(url, token) : null;
}

// One boot line when the worker has no KV: names what is off, never a value from the env.
export function kvMissingNotice(env: NodeJS.ProcessEnv = process.env): string | null {
  return kvFromEnv(env) ? null : "[worker] KV not configured: lead briefs and spend settle disabled";
}
