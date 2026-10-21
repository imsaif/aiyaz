# Aiyaz voice worker, built and hosted by LiveKit Cloud (`lk agent deploy`).
# Debian slim, not Alpine: @livekit/rtc-node and onnxruntime-node ship glibc binaries.
FROM node:24-slim
WORKDIR /app
# Build tools: better-sqlite3 (pulled in by the evals tooling) compiles from source on Linux.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Full install: tsx (a dev dependency) runs the TypeScript worker directly.
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY prompts ./prompts
COPY tsconfig.json ./
ENV NODE_ENV=production
CMD ["pnpm", "exec", "tsx", "src/voice/agent.ts", "start"]
