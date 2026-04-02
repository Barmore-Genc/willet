# MCP Tools

## Project Management

### init_project
Initialize a project for the current working directory.
- **Params**: `name` (string)
- **Behavior**: Creates registry entry mapping cwd to a new project. Creates the project database with schema. Errors if cwd already has a project.
- **Returns**: Project id and name.

### get_project
Get the project associated with the current working directory.
- **Params**: none
- **Returns**: Project id, name, directory, created_at. Errors if no project exists for cwd.

## Task CRUD

### create_task
- **Params**: `title` (required), `description`, `type` (task|bug|feature|epic), `priority` (low|medium|high|urgent), `estimate`, `tags` (string[]), `parent_task_id`, `metadata` (object)
- **Behavior**: Creates task with status "open". Records history entry for creation. Generates and stores embedding.
- **Returns**: Full task object.

### update_task
- **Params**: `task_id` (required), plus any fields to update: `title`, `description`, `type`, `priority`, `estimate`, `tags`, `parent_task_id`, `metadata`
- **Behavior**: Updates only provided fields. Records a history entry per changed field. Re-embeds if title/description/tags changed.
- **Returns**: Full updated task object.

### get_task
- **Params**: `task_id` (required), `include_comments` (bool, default false), `include_history` (bool, default false), `include_links` (bool, default false)
- **Returns**: Task object, optionally with comments, history, and/or links.

### delete_task
- **Params**: `task_id` (required)
- **Behavior**: Cascading delete (links, history, comments, embeddings all removed via foreign keys).
- **Returns**: Confirmation.

## Task Workflow

### start_task
- **Params**: `task_id` (required)
- **Behavior**: Sets status to "in_progress". Records history. Errors if status is already done/cancelled.
- **Returns**: Updated task.

### complete_task
- **Params**: `task_id` (required), `actual` (optional, actual time spent)
- **Behavior**: Sets status to "done", sets `completed_at` to now. Records history. Optionally sets `actual`.
- **Returns**: Updated task.

### cancel_task
- **Params**: `task_id` (required)
- **Behavior**: Sets status to "cancelled". Records history.
- **Returns**: Updated task.

### reopen_task
- **Params**: `task_id` (required)
- **Behavior**: Sets status back to "open", clears `completed_at`. Records history.
- **Returns**: Updated task.

## Comments

### add_comment
- **Params**: `task_id` (required), `content` (required)
- **Returns**: The created comment.

## Task Links

### link_tasks
- **Params**: `source_task_id` (required), `target_task_id` (required), `link_type` (blocks|relates_to|duplicates)
- **Behavior**: Creates the link. Errors if it already exists or if source == target.
- **Returns**: The created link.

### unlink_tasks
- **Params**: `source_task_id` (required), `target_task_id` (required), `link_type` (required)
- **Returns**: Confirmation.

## Querying

### list_tasks
Structured filtering with AND semantics across all provided filters.
- **Params** (all optional):
  - `status` — single value or array (e.g. `["open", "in_progress"]`)
  - `type` — single value or array
  - `priority` — single value or array
  - `tags` — array; tasks must have ALL specified tags
  - `parent_task_id` — filter by parent (use `null` for root tasks only)
  - `created_after` / `created_before` — ISO 8601 date strings
  - `completed_after` / `completed_before` — ISO 8601 date strings
  - `sort` — field to sort by (default: `created_at`)
  - `sort_direction` — `asc` or `desc` (default: `desc`)
  - `limit` — max results (default: 50)
  - `offset` — for pagination
- **Returns**: Array of task objects + total count.

### search_tasks
Combined text and semantic search.
- **Params**:
  - `query` (required) — the search string
  - `mode` — `text` (FTS5), `semantic` (vector), or `hybrid` (both, default)
  - `status` — optional filter applied post-search
  - `limit` — max results (default: 20)
- **Behavior**:
  - `text` mode: FTS5 match, ranked by BM25.
  - `semantic` mode: embed query, cosine similarity against all task embeddings, return top-K.
  - `hybrid` mode: run both, combine scores with reciprocal rank fusion.
- **Returns**: Array of tasks with relevance scores.

### get_task_graph
- **Params**: `task_id` (required), `depth` (default: 1, max: 5)
- **Behavior**: Returns the task and all linked tasks up to N hops out. Useful for understanding dependency chains.
- **Returns**: Nodes (tasks) and edges (links) — a flat graph structure.

## Visualization

### render_task_board
- **Params**: `group_by` (status|priority|type, default: status), filters (same as list_tasks)
- **Returns**: Markdown-formatted kanban board grouped by the specified field.

