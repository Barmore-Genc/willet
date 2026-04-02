# Architecture

## Storage

Each project gets its own SQLite database at `~/.willet/projects/<project-id>/tasks.db`. Project-to-directory mapping is stored in a root database at `~/.willet/registry.db`.

This approach:
- Naturally isolates projects (no `WHERE project_id = ?` everywhere)
- Makes backup/sync/deletion trivial (one directory per project)
- Avoids cross-project query accidents
- Scales fine for local use (opening a second SQLite DB is cheap)

### Registry Database

```sql
-- ~/.willet/registry.db
CREATE TABLE projects (
    id TEXT PRIMARY KEY,           -- ULID
    name TEXT NOT NULL,
    directory TEXT NOT NULL UNIQUE, -- absolute path to working directory
    created_at TEXT NOT NULL        -- ISO 8601 UTC
);
```

When a tool is called, the server resolves the current working directory to a project via the registry. If no project exists, `init_project` must be called first.

### Project Database Schema

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,              -- ULID
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',  -- open, in_progress, done, cancelled
    type TEXT NOT NULL DEFAULT 'task',    -- task, bug, feature, epic
    priority TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, urgent
    estimate TEXT,                     -- free-form: "2h", "3d", "1 sprint", etc.
    actual TEXT,                       -- same format, filled when completing
    tags TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,          -- ISO 8601 UTC
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}' -- JSON object for custom fields
);

CREATE TABLE task_links (
    id TEXT PRIMARY KEY,              -- ULID
    source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL,          -- blocks, relates_to, duplicates
    created_at TEXT NOT NULL,
    UNIQUE(source_task_id, target_task_id, link_type)
);

CREATE TABLE task_history (
    id TEXT PRIMARY KEY,              -- ULID
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    field_changed TEXT NOT NULL,       -- 'status', 'title', 'priority', etc.
    old_value TEXT,
    new_value TEXT,
    changed_at TEXT NOT NULL,
    changed_by TEXT NOT NULL DEFAULT 'local'  -- future: user ID
);

CREATE TABLE task_comments (
    id TEXT PRIMARY KEY,              -- ULID
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'local'  -- future: user ID
);

CREATE TABLE task_embeddings (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,          -- Float32Array as raw bytes
    content_hash TEXT NOT NULL         -- SHA-256 of embedded content to detect staleness
);

-- Full-text search
CREATE VIRTUAL TABLE tasks_fts USING fts5(
    title,
    description,
    content=tasks,
    content_rowid=rowid
);

-- FTS sync triggers
CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, description)
    VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER tasks_ad AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
    VALUES ('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER tasks_au AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
    VALUES ('delete', old.rowid, old.title, old.description);
    INSERT INTO tasks_fts(rowid, title, description)
    VALUES (new.rowid, new.title, new.description);
END;

-- Indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX idx_tasks_created ON tasks(created_at);
CREATE INDEX idx_tasks_completed ON tasks(completed_at);
CREATE INDEX idx_task_links_source ON task_links(source_task_id);
CREATE INDEX idx_task_links_target ON task_links(target_task_id);
CREATE INDEX idx_task_history_task ON task_history(task_id);
CREATE INDEX idx_task_comments_task ON task_comments(task_id);
```

### Automatic History Tracking

Every mutation to a task must record a `task_history` row. This is enforced at the query layer, not via SQLite triggers, because:
- We need `changed_by` which requires application context
- Some updates touch multiple fields and should produce multiple history rows
- Triggers can't easily capture JSON field diffs

The `recordChange(taskId, field, oldValue, newValue, changedBy)` helper must be called for every field change. Tool handlers should use `updateTask()` which handles this automatically.

## Embeddings

Local embeddings via ONNX Runtime running `all-MiniLM-L6-v2` (384 dimensions, ~80MB model). The model is downloaded on first use and cached at `~/.willet/models/`.

### How It Works

1. On `create_task` / `update_task`: compute SHA-256 of the embedded content. If the hash differs from `task_embeddings.content_hash`, re-embed and upsert.
2. On `search_tasks` with semantic mode: embed the query string, then compute cosine similarity against all `task_embeddings` rows for the project. Return top-K results.
3. Brute-force cosine similarity is fine for local use (1000 tasks with 384-dim vectors takes <1ms).

### Embedding Content

```
input = task.title + "\n" + task.description + "\n" + task.tags.join(", ")
embedding = onnx_model.encode(input)  // Float32Array[384]
stored as raw bytes in SQLite BLOB
```

If ONNX fails to initialize (missing native deps, model download failure, etc.), the server should error out at startup. No fallback — embeddings are a core feature.

## Future Multi-User Considerations

Things already designed for multi-user expansion:
- `changed_by` / `created_by` fields (currently "local")
- ULID IDs (no auto-increment conflicts)
- Per-project databases (can be served independently)
- No global mutable state in the server process

When adding multi-user:
- Add a `users` table to the registry
- Switch transport from stdio to SSE/streamable HTTP
- Add OAuth via MCP SDK's built-in auth support
- Replace "local" with authenticated user IDs
- Add per-project access control in the registry
