FROM node:20-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Copy package.json for each package (for install)
COPY packages/shared/package.json packages/shared/
COPY packages/api-spec/package.json packages/api-spec/
COPY packages/server/package.json packages/server/

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/api-spec/ packages/api-spec/
COPY packages/server/src/ packages/server/src/
COPY packages/server/tsconfig.json packages/server/
COPY packages/server/tsconfig.build.json packages/server/
COPY packages/server/docker-entrypoint.sh packages/server/

# Build shared and api-spec first (server depends on both), then server
RUN pnpm --filter @willet/shared run build:server && pnpm --filter @willet/api-spec run build && pnpm --filter @willet/server run build

# Assemble a self-contained deployment of the server: pnpm copies the built
# workspace deps (@willet/shared, @willet/api-spec) as real packages into a
# flat node_modules, so the runtime image needs no workspace symlinks.
RUN pnpm deploy --filter @willet/server --prod /deploy

# Pre-download the embedding model into the deployed node_modules (cached for runtime)
RUN node -e "import('/deploy/node_modules/@willet/shared/dist/embeddings/local.js').then(m => m.initEmbeddings()).then(() => process.exit(0))"

# ---

FROM node:20-slim
WORKDIR /app

# Copy the self-contained deployment. The server package's files land at the
# image root (dist/, package.json, docker-entrypoint.sh) with a resolved
# node_modules alongside.
COPY --from=builder /deploy /app

ENV WILLET_DATA_DIR=/data
ENV WILLET_CONFIG=/config/willet.toml

EXPOSE 3000
VOLUME ["/data", "/config"]

RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["serve"]
