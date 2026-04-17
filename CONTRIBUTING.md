# Contributing to Willet

Thanks for your interest in contributing to Willet! This guide will help you get started.

## Prerequisites

- **Node.js** 20 or later
- **pnpm** (package manager)

## Setup

```bash
git clone --recurse-submodules https://github.com/SeriousBug/willet.git
cd willet
pnpm install
pnpm run build
```

## Development Workflow

### Running Tests

```bash
pnpm run test
```

### Type-Checking

```bash
pnpm run check
```

## Making Changes

1. **Create a feature branch** off `main`. Direct commits to `main` are blocked by hooks.
2. Make your changes and verify they pass tests and type-checking.
3. **Open a pull request** against `main`.

## Contributor License Agreement (CLA)

All contributors must sign the CLA before their pull request can be merged. When you open a PR, the CLA bot will prompt you to sign by posting a comment. See [CLA.md](CLA.md) for the full text.

## Code Conventions

See [CLAUDE.md](CLAUDE.md) for detailed conventions. The short version:

- **Zod** for all MCP tool input validation; derive TypeScript types from Zod schemas.
- **Thin tool handlers** -- validate input, call a query function, return the result.
- **History tracking** -- every state change to a task must write a `task_history` row using the provided helpers.
- **ULIDs** for all IDs (sortable, unique, no coordination needed).

## Project Structure

The monorepo has three packages:

- `packages/shared/` -- core logic, tools, database, embeddings, and views
- `packages/mcp/` -- local stdio MCP server (published to npm)
- `packages/server/` -- deployed HTTP server (Docker)

## Questions?

If something is unclear, feel free to open an issue and ask. We are happy to help.
