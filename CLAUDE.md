# Willet

A local-first task tracking MCP server for AI agents (Claude Code). Think Jira/Linear but operated entirely through MCP tools.

## Quick Reference

- **Language**: TypeScript, Node.js
- **Storage**: SQLite per project via `better-sqlite3` (~/.willet/projects/<id>/tasks.db)
- **Search**: FTS5 for text, local ONNX embeddings (`all-MiniLM-L6-v2`) for vector similarity
- **MCP transport**: stdio (local), designed to migrate to SSE/streamable HTTP + OAuth later

## Project Structure

```
src/
  index.ts              # MCP server entry point, tool registration
  tools/                # One file per tool group (tasks, links, queries, projects, viz)
  db/
    schema.ts           # Migrations & table definitions
    queries.ts          # Typed query helpers
  embeddings/
    local.ts            # ONNX-based local embedding generation + cosine similarity
  models/               # TypeScript types & Zod schemas
```

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP server
- `better-sqlite3` - SQLite
- `onnxruntime-node` - local embedding inference
- `zod` - input validation

## Commands

- `npm run build` - compile TypeScript
- `npm run dev` - run with ts-node in watch mode
- `npm test` - run tests
- `npm run lint` - ESLint

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
- `changed_by` fields store "local" for now; will hold user IDs when multi-user is added
- Keep the MCP tool count manageable — prefer tools with filter parameters over many narrow tools
