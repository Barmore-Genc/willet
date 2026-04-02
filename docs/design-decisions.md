# Design Decisions

## SQLite per project, not one shared database
**Decision**: Each project gets its own SQLite file. A separate registry DB maps working directories to projects.

**Why**: Natural isolation without needing `project_id` on every table and query. Makes it trivial to delete, back up, or eventually sync a single project. Avoids any chance of cross-project data leaks. Opening multiple SQLite databases is cheap.

**Tradeoff**: Cross-project queries (e.g. "all my open tasks across every project") require iterating over databases. Acceptable for now — a cross-project query tool can open each DB in turn.

## ULIDs for all IDs
**Decision**: Use ULIDs instead of auto-increment integers or UUIDs.

**Why**: Sortable by creation time (useful for default ordering), globally unique without coordination (needed for future multi-user), and shorter than UUIDs. No ID conflicts when merging databases.

## Free-form estimate/actual fields
**Decision**: `estimate` and `actual` are free-form text, not structured durations.

**Why**: Developers express estimates in wildly different units ("2h", "3 days", "1 sprint", "S", "XL"). Forcing a format adds friction for agents and users. An agent can interpret these contextually. If structured durations are needed later, a parser can be added without schema changes.

## History at the application layer, not SQL triggers
**Decision**: Task history is written by the query helpers, not by SQLite triggers.

**Why**: Triggers can't access application context like `changed_by`. Multi-field updates need multiple history rows. JSON field diffs are complex in SQL. The `updateTask()` helper handles diffing and history recording atomically.

## Local ONNX embeddings, no API dependency
**Decision**: Run `all-MiniLM-L6-v2` locally via `onnxruntime-node` for vector search.

**Why**: No API keys, no network dependency, no per-query cost, works offline. The model is ~80MB — acceptable for a developer tool. At local task volumes (hundreds to low thousands), brute-force cosine similarity is fast enough without an ANN index.

**Tradeoff**: ~80MB model download on first use. ONNX native bindings can be finicky on some platforms. If ONNX fails to load, the server errors out — embeddings are a core feature, not optional.

## Hybrid search with reciprocal rank fusion
**Decision**: Default search mode combines FTS5 and vector results using reciprocal rank fusion.

**Why**: Text search catches exact matches (task IDs mentioned in descriptions, specific error codes). Semantic search catches conceptual matches ("authentication issues" finding a task about "login failures"). RRF is a simple, effective way to merge two ranked lists without tuning weights.

## MCP tool design: fewer tools with parameters over many narrow tools
**Decision**: Prefer tools like `list_tasks` with filter parameters over `list_open_tasks`, `list_done_tasks`, `list_urgent_tasks`, etc.

**Why**: Fewer tools means smaller tool descriptions for the AI agent to process. Filter parameters are composable. Agents handle structured parameters well. This also reduces maintenance surface area.

## `changed_by` defaults to "local"
**Decision**: All history and comment entries have a `changed_by`/`created_by` field defaulting to "local".

**Why**: The schema is ready for multi-user without any migrations when that time comes. Just start passing user IDs instead of "local". No code paths assume single-user — they just happen to always receive "local" for now.
