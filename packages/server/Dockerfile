FROM node:20-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Copy package.json for each package (for install)
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/server/src/ packages/server/src/
COPY packages/server/tsconfig.json packages/server/
COPY packages/server/tsconfig.build.json packages/server/
COPY packages/server/docker-entrypoint.sh packages/server/

# Build shared first, then server
RUN pnpm --filter @willet/shared run build:server && pnpm --filter @willet/server run build

# Pre-download the embedding model (cached inside node_modules)
RUN node -e "import('./packages/shared/dist/embeddings/local.js').then(m => m.initEmbeddings()).then(() => process.exit(0))"

# Prune to production dependencies only
RUN CI=true pnpm prune --prod

# ---

FROM node:20-slim
WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=builder /app/packages/server/node_modules packages/server/node_modules
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/package.json ./

ENV WILLET_DATA_DIR=/data
ENV WILLET_CONFIG=/config/willet.toml

EXPOSE 3000
VOLUME ["/data", "/config"]

COPY --from=builder /app/packages/server/docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["serve"]
