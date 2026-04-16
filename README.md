# Willet

A task tracker built for AI agents, operated entirely through [MCP](https://modelcontextprotocol.io/) tools — no browser, no GUI, just your AI assistant managing tasks alongside your code.

Willet gives AI coding agents (like Claude Code) full project-management capabilities: creating and tracking tasks, managing workflows, linking dependencies, and searching across everything — all without leaving the terminal.

## Features

- **Full task lifecycle** — Create, update, and organize tasks with types (task, bug, feature, epic), priorities (low through critical), time estimates, tags, and custom metadata. Move tasks through statuses — every change is recorded with what changed, the old and new values, when, and by whom.
- **Subtasks and linking** — Break work into subtasks, link related tasks with dependency (blocks), relationship, or duplicate links, and explore connections across multiple hops with the dependency graph.
- **Semantic search** — Willet runs a local embedding model ([all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)) to generate vector embeddings of your tasks. This means search isn't limited to exact keyword matches — it understands meaning. Search for "authentication problems" and find a task titled "login timeout bug." Combine semantic and keyword search in hybrid mode for the best of both worlds.
- **Visualizations** — Kanban boards, force-directed dependency graphs, and project dashboards rendered as interactive UIs in supported MCP clients, with text fallbacks everywhere else.
- **Per-project isolation** — Each project gets its own SQLite database. No cross-project interference, easy to back up or move.
- **Export and import** — Full data portability. Export a project to a ZIP archive and import it elsewhere, including between local and self-hosted instances.

## Two Ways to Run

| | **Local** | **Self-hosted** |
|---|---|---|
| **Users** | Single user | Multi-user with per-user auth |
| **Install** | `npm install` | Docker |
| **Best for** | Personal use with Claude Code | Teams sharing a task server |

## Local Installation

Requires **Node.js 20+**.

### Install

```bash
npm install -g @willet/mcp
```

### Configure Your MCP Client

Add Willet to your MCP client's configuration. For Claude Code, add this to your `.mcp.json`:

```json
{
  "mcpServers": {
    "willet": {
      "command": "willet-mcp"
    }
  }
}
```

For Claude Desktop, add this to your Claude Desktop config:

```json
{
  "mcpServers": {
    "willet": {
      "command": "willet-mcp"
    }
  }
}
```

### First Run

On first run, Willet downloads the embedding model (~80 MB) to `~/.willet/models/`. This is a one-time download.

Then just start using it through your AI agent:

> "Initialize a Willet project called My App"

> "Create a bug for the login timeout issue, high priority"

> "Show me all open tasks tagged 'backend'"

> "What tasks are blocking the auth epic?"

> "Search for anything related to authentication problems"

### Data Storage

All data stays on your machine:

- **Registry**: `~/.willet/registry.db` — maps working directories to projects
- **Project data**: `~/.willet/projects/<id>/tasks.db` — one SQLite database per project
- **Embedding model**: `~/.willet/models/` — cached ONNX model

## Self-Hosted Installation

The self-hosted server runs via Docker and supports multiple users with secret-based authentication over HTTP.

### 1. Create a Config File

Create a `willet.toml` file:

```toml
[server]
port = 3000
base_url = "https://willet.example.com"

[users.alice]
secret = "change-me-to-a-random-string"

[users.bob]
secret = "change-me-to-another-random-string"
```

Each user gets a `[users.<name>]` section with a unique `secret` used for authentication. The config file is watched for changes and reloaded automatically — no restart needed to add or remove users.

### 2. Run with Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  willet:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - willet-data:/data
      - ./willet.toml:/config/willet.toml:ro

volumes:
  willet-data:
```

```bash
docker compose up -d
```

The Docker image pre-downloads the embedding model during build, so there's no first-run delay.

### 3. Configure Your MCP Client

For Claude Code, add this to your `.mcp.json`:

```json
{
  "mcpServers": {
    "willet": {
      "type": "streamable-http",
      "url": "https://willet.example.com/mcp"
    }
  }
}
```

Users authenticate via the MCP OAuth flow using their secret from the config file.

## Export and Import

Willet supports exporting and importing projects as ZIP archives. This is useful for backups, migrating between machines, or moving data between local and self-hosted instances.

Exports include all task data: tasks, comments, links, full change history, and metadata.

### Local (CLI)

**Export a project:**

```bash
willet-export --project <project-id> --output my-project.zip
```

If you only have one project, the `--project` flag can be omitted.

**Import a project:**

```bash
# Import as a new project
willet-import my-project.zip

# Import into an existing project
willet-import my-project.zip --project <project-id>
```

### Self-Hosted

**Export a project:**

```bash
docker compose exec willet /app/docker-entrypoint.sh export --project <project-id> --output /data/export.zip
docker compose cp willet:/data/export.zip ./export.zip
```

**Import a project:**

```bash
docker compose cp my-project.zip willet:/data/my-project.zip
docker compose exec willet /app/docker-entrypoint.sh import /data/my-project.zip
```

### Moving Between Local and Self-Hosted

The export format is the same for both versions. To move a project from local to self-hosted (or vice versa), export from one and import into the other:

```bash
# Local -> Self-hosted
willet-export --output my-project.zip
docker compose cp my-project.zip willet:/data/my-project.zip
docker compose exec willet /app/docker-entrypoint.sh import /data/my-project.zip

# Self-hosted -> Local
docker compose exec willet /app/docker-entrypoint.sh export --project <id> --output /data/export.zip
docker compose cp willet:/data/export.zip ./export.zip
willet-import export.zip
```

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
