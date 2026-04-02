# Willet

A local-first task tracking MCP server for AI agents (Claude Code). Think Jira/Linear but operated entirely through MCP tools.

## Quick Reference

- **Language**: TypeScript, Node.js
- **Storage**: SQLite per project via `better-sqlite3` (~/.willet/projects/<id>/tasks.db)
- **Search**: FTS5 for text, local ONNX embeddings (`all-MiniLM-L6-v2`) for vector similarity
- **MCP transport**: stdio (local via `@willet/mcp`), streamable HTTP + OAuth (deployed via `@willet/server`)

## Monorepo Structure

```
packages/
  shared/               # @willet/shared — core logic, tools, db, embeddings, views
    src/
      context.ts        # AsyncLocalStorage user context (getCurrentUser/runAsUser)
      tools/            # One file per tool group (tasks, links, queries, projects, viz)
      db/               # schema.ts (migrations), queries.ts (typed helpers)
      embeddings/       # ONNX-based local embedding generation + cosine similarity
      models/           # TypeScript types & Zod schemas
    views/              # Vite-built MCP Apps HTML (task board, dependency graph, stats)

  mcp/                  # @willet/mcp — local stdio server (published to npm)
    src/index.ts        # Thin stdio entrypoint
    build.js            # esbuild config — bundles shared + all pure JS deps into single file

  server/               # @willet/server — deployed HTTP server (Docker)
    src/
      index.ts          # HTTP entrypoint
      http.ts           # Express server, transport management, runAsUser per-request
      config.ts         # TOML parsing, hot-reload via fs.watch
      auth/provider.ts  # OAuth provider (secret-based auth)
    Dockerfile
    config.example.toml
    docker-compose.example.yml

```

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP server
- `better-sqlite3` - SQLite
- `onnxruntime-node` - local embedding inference
- `zod` - input validation
- `express` - HTTP server (server package only)
- `smol-toml` - TOML config parsing (server package only)

## Commands

- `pnpm run build` - build all packages (topological order)
- `pnpm run check` - type-check all packages
- `pnpm --filter @willet/mcp run dev` - run mcp server in dev mode
- `pnpm --filter @willet/server run dev` - run HTTP server in dev mode

## Packaging

- **npm**: `cd packages/mcp && npm pack` — esbuild bundle + bin (no separate @willet/shared publish needed)
- **Docker**: `docker build -f packages/server/Dockerfile -t willet .`

## Design Docs

- [docs/architecture.md](docs/architecture.md) - data model, storage, embedding strategy
- [docs/mcp-tools.md](docs/mcp-tools.md) - full tool catalog with parameters
- [docs/design-decisions.md](docs/design-decisions.md) - key decisions and rationale

## Conventions

- Use Zod schemas for all MCP tool input validation; derive TypeScript types from them
- Every state change to a task must write a `task_history` row (use a helper, don't do it manually)
- Tool handlers should be thin: validate input, call a query function, return result
- SQLite migrations are sequential numbered files applied on DB open
- Dates are stored as ISO 8601 strings in UTC
- IDs are ULIDs (sortable, unique, no coordination needed — good for future multi-user)
- `changed_by` is set via AsyncLocalStorage context (`getCurrentUser()`); "local" for stdio, username for HTTP
- Keep the MCP tool count manageable — prefer tools with filter parameters over many narrow tools
