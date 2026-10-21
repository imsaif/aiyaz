# Aiyaz voice worker, built and hosted by LiveKit Cloud (`lk agent deploy`).
# Debian slim, not Alpine: @livekit/rtc-node and onnxruntime-node ship glibc binaries.
FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Full install: tsx (a dev dependency) runs the TypeScript worker directly.
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY prompts ./prompts
COPY tsconfig.json ./
ENV NODE_ENV=production
CMD ["pnpm", "exec", "tsx", "src/voice/agent.ts", "start"]
