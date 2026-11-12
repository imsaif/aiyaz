// Mints a 15-minute token that dispatches the local worker, for testing without the site.
//   pnpm voice:token                                      homepage call, unknown country
//   pnpm voice:token '{"country":"IN"}'                   India visitor
//   pnpm voice:token '{"country":"AE","slug":"acme-test"}' lead call (run pnpm briefs --acme-test --write first)
// Paste the url and token into https://agents-playground.livekit.io (manual connect).
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { SPEND_KEY, dayOf } from "../src/calllog.js";
import { loadSettings } from "../src/config.js";
import { kvFromEnv } from "../src/kv.js";
import { AGENT_NAME } from "../src/voice/meta.js";

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error("Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env");
  process.exit(2);
}
const metadata = process.argv[2] ?? "{}";
JSON.parse(metadata); // fail here, not in the worker, on a typo

// Reserve like the site does, so the worker's settle leaves the day's total correct.
const kv = kvFromEnv();
if (kv) await kv.incrByFloat(SPEND_KEY(dayOf(Date.now())), loadSettings().costCapUsd, 2 * 86_400);

const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: `visitor-${randomUUID()}`, ttl: "15m" });
at.addGrant({ roomJoin: true, room: `aiyaz-dev-${randomUUID()}`, canPublish: true, canSubscribe: true, canPublishData: true });
at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata })] });
console.log(`url:   ${LIVEKIT_URL}\ntoken: ${await at.toJwt()}`);
