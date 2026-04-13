import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";
import { getCurrentUser } from "../context.js";
import {
  embed,
  embeddingToBuffer,
} from "../embeddings/local.js";
import { applySchema, applyRegistrySchema } from "./schema.js";
import type {
  Project,
  Task,
  TaskHistory,
  TaskLink,
  TaskComment,
  Status,
  TaskType,
  Priority,
  LinkType,
  SortField,
  SortDirection,
  SearchMode,
} from "../models/types.js";

// --- Paths ---

function getBaseDir(): string {
  return process.env.WILLET_DATA_DIR || join(homedir(), ".willet");
}

// --- DB connection cache ---

let registryDb: Database.Database | null = null;
const projectDbs = new Map<string, Database.Database>();

export function getRegistryDb(): Database.Database {
  if (!registryDb) {
    const baseDir = getBaseDir();
    mkdirSync(baseDir, { recursive: true });
    registryDb = new Database(join(baseDir, "registry.db"));
    applyRegistrySchema(registryDb);
  }
  return registryDb;
}

export function getProjectDb(projectId: string): Database.Database {
  let db = projectDbs.get(projectId);
  if (!db) {
    const dir = join(getBaseDir(), "projects", projectId);
    mkdirSync(dir, { recursive: true });
    db = new Database(join(dir, "tasks.db"));
    applySchema(db);
    projectDbs.set(projectId, db);
  }
  return db;
}

export function closeAll(): void {
  registryDb?.close();
  registryDb = null;
  for (const db of projectDbs.values()) db.close();
  projectDbs.clear();
}

// --- Project operations ---

export function resolveProject(directory: string): Project | null {
  const db = getRegistryDb();
  const row = db
    .prepare("SELECT id, name, directory, created_at FROM projects WHERE directory = ?")
    .get(directory) as Project | undefined;
  return row ?? null;
}

export function getProjectById(projectId: string): Project | null {
  const db = getRegistryDb();
  const row = db
    .prepare("SELECT id, name, directory, created_at FROM projects WHERE id = ?")
    .get(projectId) as Project | undefined;
  return row ?? null;
}

export function listProjects(nameFilter?: string): Project[] {
  const db = getRegistryDb();
  if (nameFilter) {
    return db
      .prepare("SELECT id, name, directory, created_at FROM projects WHERE name LIKE ? ORDER BY created_at DESC")
      .all(`%${nameFilter}%`) as Project[];
  }
  return db
    .prepare("SELECT id, name, directory, created_at FROM projects ORDER BY created_at DESC")
    .all() as Project[];
}

export function initProject(name: string, directory?: string): Project {
  const dir = directory || name;
  const existing = resolveProject(dir);
  if (existing) return existing;

  const db = getRegistryDb();
  const project: Project = {
    id: ulid(),
    name,
    directory: dir,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    "INSERT INTO projects (id, name, directory, created_at) VALUES (?, ?, ?, ?)"
  ).run(project.id, project.name, project.directory, project.created_at);

  // Initialize the project database
  getProjectDb(project.id);

  return project;
}

/**
 * Resolve a project by explicit ID, cwd, or single-project fallback.
 * Priority: projectId > cwd > only project in registry.
 */
export function getProject(directory: string, projectId?: string): Project {
  // Explicit project ID takes priority
  if (projectId) {
    const project = getProjectById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  }

  // Try cwd-based resolution
  const project = resolveProject(directory);
  if (project) return project;

  // Fallback: if exactly one project exists, use it
  const all = listProjects();
  if (all.length === 1) return all[0];

  if (all.length === 0) {
    throw new Error("No projects exist. Call init_project first.");
  }

  const names = all.map((p) => `  - ${p.name} (${p.id})`).join("\n");
  throw new Error(
    `Multiple projects exist and none match the current directory. Pass project_id or use list_projects to find the right one:\n${names}`
  );
}

// --- History helper ---

function recordChange(
  db: Database.Database,
  taskId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null
): void {
  db.prepare(
    "INSERT INTO task_history (id, task_id, field_changed, old_value, new_value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(ulid(), taskId, field, oldValue, newValue, new Date().toISOString(), getCurrentUser());
}

// --- Row to entity helpers ---

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  estimate: string | null;
  actual: string | null;
  tags: string;
  parent_task_id: string | null;
  assignee: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    status: row.status as Status,
    type: row.type as TaskType,
    priority: row.priority as Priority,
    tags: JSON.parse(row.tags) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

// --- Embedding helper ---

async function embedTask(db: Database.Database, task: Task): Promise<void> {
  const comments = getComments(db, task.id);
  const commentText = comments.map((c) => c.content).join("\n");
  const content = `${task.title}\n${task.description}\n${task.tags.join(", ")}${commentText ? `\n${commentText}` : ""}`;
  const contentHash = createHash("sha256").update(content).digest("hex");

  const existing = db
    .prepare("SELECT content_hash FROM task_embeddings WHERE task_id = ?")
    .get(task.id) as { content_hash: string } | undefined;

  if (existing && existing.content_hash === contentHash) return;

  const embedding = await embed(content);
  const buf = embeddingToBuffer(embedding);
  const rowid = BigInt(
    (db.prepare("SELECT rowid FROM tasks WHERE id = ?").get(task.id) as { rowid: number }).rowid
  );

  db.transaction(() => {
    db.prepare(
      "INSERT OR REPLACE INTO task_embeddings (task_id, embedding, content_hash) VALUES (?, ?, ?)"
    ).run(task.id, buf, contentHash);
    db.prepare("DELETE FROM task_vec WHERE rowid = ?").run(rowid);
    db.prepare("INSERT INTO task_vec(rowid, embedding) VALUES (?, ?)").run(
      rowid,
      buf
    );
  })();
}

// --- Task CRUD ---

export async function createTask(
  db: Database.Database,
  input: {
    title: string;
    description?: string;
    status?: Status;
    type?: TaskType;
    priority?: Priority;
    estimate?: string;
    tags?: string[];
    parent_task_id?: string;
    assignee?: string;
    metadata?: Record<string, unknown>;
    links?: Array<{ target_task_id: string; link_type: LinkType }>;
    initial_comment?: string;
  }
): Promise<Task & { links?: TaskLink[]; comment?: TaskComment }> {
  const now = new Date().toISOString();
  const id = ulid();
  const tags = input.tags ?? [];
  const metadata = input.metadata ?? {};
  const status = input.status ?? "open";

  db.prepare(`
    INSERT INTO tasks (id, title, description, status, type, priority, estimate, tags, parent_task_id, assignee, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title,
    input.description ?? "",
    status,
    input.type ?? "task",
    input.priority ?? "medium",
    input.estimate ?? null,
    JSON.stringify(tags),
    input.parent_task_id ?? null,
    input.assignee ?? null,
    now,
    now,
    JSON.stringify(metadata)
  );

  recordChange(db, id, "created", null, id);
  if (status !== "open") {
    recordChange(db, id, "status", "open", status);
  }

  const task = getTaskById(db, id)!;

  const result: Task & { links?: TaskLink[]; comment?: TaskComment } = { ...task };

  if (input.links && input.links.length > 0) {
    result.links = input.links.map((l) => linkTasks(db, id, l.target_task_id, l.link_type));
  }

  if (input.initial_comment) {
    result.comment = await addComment(db, id, input.initial_comment);
  } else {
    await embedTask(db, task);
  }

  return result;
}

export function getTaskById(db: Database.Database, taskId: string): Task | null {
  const row = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(taskId) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export async function updateTask(
  db: Database.Database,
  input: {
    task_id: string;
    title?: string;
    description?: string;
    type?: TaskType;
    priority?: Priority;
    estimate?: string | null;
    tags?: string[];
    parent_task_id?: string | null;
    assignee?: string | null;
    metadata?: Record<string, unknown>;
    status?: Status;
    completed_at?: string | null;
    actual?: string | null;
  }
): Promise<Task> {
  const current = getTaskById(db, input.task_id);
  if (!current) throw new Error(`Task not found: ${input.task_id}`);

  const updates: string[] = [];
  const params: unknown[] = [];
  let needsReembed = false;

  const diffField = (
    field: string,
    newValue: unknown,
    currentValue: unknown,
    serialize?: (v: unknown) => string
  ) => {
    if (newValue === undefined) return;
    const newStr = serialize ? serialize(newValue) : String(newValue ?? "");
    const oldStr = serialize ? serialize(currentValue) : String(currentValue ?? "");
    if (newStr === oldStr) return;

    updates.push(`${field} = ?`);
    params.push(serialize ? newStr : newValue);
    recordChange(db, input.task_id, field, oldStr, newStr);

    if (field === "title" || field === "description" || field === "tags") {
      needsReembed = true;
    }
  };

  diffField("title", input.title, current.title);
  diffField("description", input.description, current.description);
  diffField("type", input.type, current.type);
  diffField("priority", input.priority, current.priority);
  diffField("estimate", input.estimate, current.estimate);
  diffField("actual", input.actual, current.actual);
  diffField("status", input.status, current.status);
  diffField("completed_at", input.completed_at, current.completed_at);
  diffField("parent_task_id", input.parent_task_id, current.parent_task_id);
  diffField("assignee", input.assignee, current.assignee);
  diffField("tags", input.tags, current.tags, (v) => JSON.stringify(v));
  diffField("metadata", input.metadata, current.metadata, (v) => JSON.stringify(v));

  if (updates.length > 0) {
    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(input.task_id);

    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  const updated = getTaskById(db, input.task_id)!;
  if (needsReembed) await embedTask(db, updated);
  return updated;
}

export function deleteTask(db: Database.Database, taskId: string): void {
  const task = getTaskById(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
}

// --- Workflow ---

export async function startTask(db: Database.Database, taskId: string): Promise<Task> {
  const task = getTaskById(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status === "done" || task.status === "cancelled") {
    throw new Error(`Cannot start task with status: ${task.status}`);
  }
  return updateTask(db, { task_id: taskId, status: "in_progress" });
}

export async function completeTask(
  db: Database.Database,
  taskId: string,
  actual?: string
): Promise<Task> {
  const task = getTaskById(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status === "cancelled") {
    throw new Error("Cannot complete a cancelled task");
  }
  return updateTask(db, {
    task_id: taskId,
    status: "done",
    completed_at: new Date().toISOString(),
    actual: actual ?? undefined,
  });
}

export async function cancelTask(db: Database.Database, taskId: string): Promise<Task> {
  const task = getTaskById(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status === "cancelled") {
    throw new Error("Task is already cancelled");
  }
  return updateTask(db, { task_id: taskId, status: "cancelled" });
}

export async function reopenTask(db: Database.Database, taskId: string): Promise<Task> {
  const task = getTaskById(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return updateTask(db, { task_id: taskId, status: "open", completed_at: null });
}

// --- Comments ---

export async function addComment(
  db: Database.Database,
  taskId: string,
  content: string
): Promise<TaskComment> {
  const task = getTaskById(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const comment: TaskComment = {
    id: ulid(),
    task_id: taskId,
    content,
    created_at: new Date().toISOString(),
    created_by: getCurrentUser(),
  };

  db.prepare(
    "INSERT INTO task_comments (id, task_id, content, created_at, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(comment.id, comment.task_id, comment.content, comment.created_at, comment.created_by);

  await embedTask(db, task);

  return comment;
}

export function getComments(db: Database.Database, taskId: string): TaskComment[] {
  return db
    .prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at")
    .all(taskId) as TaskComment[];
}

// --- Links ---

export function linkTasks(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType: LinkType
): TaskLink {
  if (sourceId === targetId) {
    throw new Error("Cannot link a task to itself");
  }

  // Verify both tasks exist
  if (!getTaskById(db, sourceId)) throw new Error(`Task not found: ${sourceId}`);
  if (!getTaskById(db, targetId)) throw new Error(`Task not found: ${targetId}`);

  const link: TaskLink = {
    id: ulid(),
    source_task_id: sourceId,
    target_task_id: targetId,
    link_type: linkType,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    "INSERT INTO task_links (id, source_task_id, target_task_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(link.id, link.source_task_id, link.target_task_id, link.link_type, link.created_at);

  return link;
}

export function unlinkTasks(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType: LinkType
): void {
  const result = db
    .prepare(
      "DELETE FROM task_links WHERE source_task_id = ? AND target_task_id = ? AND link_type = ?"
    )
    .run(sourceId, targetId, linkType);

  if (result.changes === 0) {
    throw new Error("Link not found");
  }
}

export function getLinks(db: Database.Database, taskId: string): TaskLink[] {
  return db
    .prepare(
      "SELECT * FROM task_links WHERE source_task_id = ? OR target_task_id = ? ORDER BY created_at"
    )
    .all(taskId, taskId) as TaskLink[];
}

// --- History ---

export function getHistory(db: Database.Database, taskId: string): TaskHistory[] {
  return db
    .prepare("SELECT * FROM task_history WHERE task_id = ? ORDER BY changed_at")
    .all(taskId) as TaskHistory[];
}

// --- List tasks ---

function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export function listTasks(
  db: Database.Database,
  filters: {
    status?: Status | Status[];
    type?: TaskType | TaskType[];
    priority?: Priority | Priority[];
    tags?: string[];
    parent_task_id?: string | null;
    assignee?: string | null;
    created_after?: string;
    created_before?: string;
    completed_after?: string;
    completed_before?: string;
    sort?: SortField;
    sort_direction?: SortDirection;
    limit?: number;
    offset?: number;
  }
): { tasks: Task[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const statusArr = toArray(filters.status);
  if (statusArr) {
    conditions.push(`status IN (${statusArr.map(() => "?").join(", ")})`);
    params.push(...statusArr);
  }

  const typeArr = toArray(filters.type);
  if (typeArr) {
    conditions.push(`type IN (${typeArr.map(() => "?").join(", ")})`);
    params.push(...typeArr);
  }

  const priorityArr = toArray(filters.priority);
  if (priorityArr) {
    conditions.push(`priority IN (${priorityArr.map(() => "?").join(", ")})`);
    params.push(...priorityArr);
  }

  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      `(SELECT COUNT(*) FROM json_each(tasks.tags) WHERE json_each.value IN (${filters.tags.map(() => "?").join(", ")})) = ?`
    );
    params.push(...filters.tags, filters.tags.length);
  }

  if (filters.parent_task_id !== undefined) {
    if (filters.parent_task_id === null) {
      conditions.push("parent_task_id IS NULL");
    } else {
      conditions.push("parent_task_id = ?");
      params.push(filters.parent_task_id);
    }
  }

  if (filters.assignee !== undefined) {
    if (filters.assignee === null) {
      conditions.push("assignee IS NULL");
    } else {
      conditions.push("assignee = ?");
      params.push(filters.assignee);
    }
  }

  if (filters.created_after) {
    conditions.push("created_at > ?");
    params.push(filters.created_after);
  }
  if (filters.created_before) {
    conditions.push("created_at < ?");
    params.push(filters.created_before);
  }
  if (filters.completed_after) {
    conditions.push("completed_at > ?");
    params.push(filters.completed_after);
  }
  if (filters.completed_before) {
    conditions.push("completed_at < ?");
    params.push(filters.completed_before);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sort = filters.sort ?? "created_at";
  const dir = filters.sort_direction ?? "desc";
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM tasks ${where}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(
      `SELECT * FROM tasks ${where} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as TaskRow[];

  return {
    tasks: rows.map(rowToTask),
    total: countRow.total,
  };
}

// --- Search ---

export async function searchTasks(
  db: Database.Database,
  query: string,
  opts: {
    mode?: SearchMode;
    status?: Status | Status[];
    type?: TaskType | TaskType[];
    priority?: Priority | Priority[];
    limit?: number;
  } = {}
): Promise<Array<Task & { score: number }>> {
  const mode = opts.mode ?? "hybrid";
  const limit = opts.limit ?? 20;
  const statusArr = toArray(opts.status);
  const typeArr = toArray(opts.type);
  const priorityArr = toArray(opts.priority);

  function matchesFilters(task: Task): boolean {
    if (statusArr && !statusArr.includes(task.status)) return false;
    if (typeArr && !typeArr.includes(task.type)) return false;
    if (priorityArr && !priorityArr.includes(task.priority)) return false;
    return true;
  }

  // Build SQL WHERE clauses for filters
  function sqlFilters(): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (statusArr) {
      clauses.push(`status IN (${statusArr.map(() => "?").join(", ")})`);
      params.push(...statusArr);
    }
    if (typeArr) {
      clauses.push(`type IN (${typeArr.map(() => "?").join(", ")})`);
      params.push(...typeArr);
    }
    if (priorityArr) {
      clauses.push(`priority IN (${priorityArr.map(() => "?").join(", ")})`);
      params.push(...priorityArr);
    }
    const where = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
    return { where, params };
  }

  if (mode === "text") {
    const { where, params } = sqlFilters();
    const rows = db
      .prepare(
        `SELECT t.*, fts.rank as score
         FROM tasks_fts fts
         JOIN tasks t ON t.rowid = fts.rowid
         WHERE tasks_fts MATCH ?${where}
         ORDER BY fts.rank
         LIMIT ?`
      )
      .all(query, ...params, limit) as (TaskRow & { score: number })[];

    return rows.map((r) => ({ ...rowToTask(r), score: r.score }));
  }

  // --- KNN helper (uses sqlite-vec indexed search) ---

  async function knnSearch(
    kLimit: number
  ): Promise<Array<{ id: string; distance: number }>> {
    const queryEmbedding = await embed(query);
    const queryBuf = embeddingToBuffer(queryEmbedding);
    return db
      .prepare(
        `SELECT t.id, knn.distance
         FROM (SELECT rowid, distance FROM task_vec WHERE embedding MATCH ? AND k = ?) knn
         JOIN tasks t ON t.rowid = knn.rowid`
      )
      .all(queryBuf, kLimit) as Array<{ id: string; distance: number }>;
  }

  if (mode === "semantic") {
    const knnRows = await knnSearch(limit * 5);
    const results: Array<Task & { score: number }> = [];
    for (const row of knnRows) {
      if (results.length >= limit) break;
      const task = getTaskById(db, row.id);
      if (!task) continue;
      if (!matchesFilters(task)) continue;
      results.push({ ...task, score: 1 - row.distance });
    }
    return results;
  }

  // Hybrid: reciprocal rank fusion
  const k = 60;

  // FTS results
  const ftsRows = db
    .prepare(
      `SELECT t.id
       FROM tasks_fts fts
       JOIN tasks t ON t.rowid = fts.rowid
       WHERE tasks_fts MATCH ?
       ORDER BY fts.rank
       LIMIT ?`
    )
    .all(query.split(/\s+/).join(" OR "), limit * 2) as Array<{ id: string }>;

  // Semantic results (via sqlite-vec KNN)
  const knnRows = await knnSearch(limit * 5);

  // RRF fusion
  const rrfScores = new Map<string, number>();
  ftsRows.forEach((r, i) => {
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });
  knnRows.forEach((r, i) => {
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });

  const sorted = [...rrfScores.entries()].sort((a, b) => b[1] - a[1]);

  const results: Array<Task & { score: number }> = [];
  for (const [id, score] of sorted) {
    if (results.length >= limit) break;
    const task = getTaskById(db, id);
    if (!task) continue;
    if (!matchesFilters(task)) continue;
    results.push({ ...task, score });
  }
  return results;
}

// --- Task graph (BFS) ---

export function getTaskGraph(
  db: Database.Database,
  taskId: string,
  depth: number = 1
): { nodes: Task[]; edges: TaskLink[] } {
  const visited = new Set<string>();
  const allEdges: TaskLink[] = [];
  let frontier = [taskId];

  for (let d = 0; d <= depth && frontier.length > 0; d++) {
    const nextFrontier: string[] = [];

    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);

      if (d < depth) {
        const links = getLinks(db, id);
        for (const link of links) {
          if (!allEdges.some((e) => e.id === link.id)) {
            allEdges.push(link);
          }
          const neighbor =
            link.source_task_id === id ? link.target_task_id : link.source_task_id;
          if (!visited.has(neighbor)) {
            nextFrontier.push(neighbor);
          }
        }
      }
    }

    frontier = nextFrontier;
  }

  const nodes: Task[] = [];
  for (const id of visited) {
    const task = getTaskById(db, id);
    if (task) nodes.push(task);
  }

  return { nodes, edges: allEdges };
}

// --- Stats ---

export function getProjectStats(
  db: Database.Database
): {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
} {
  const rows = db
    .prepare(
      "SELECT status, type, priority, COUNT(*) as count FROM tasks GROUP BY status, type, priority"
    )
    .all() as Array<{ status: string; type: string; priority: string; count: number }>;

  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let total = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
    byType[row.type] = (byType[row.type] ?? 0) + row.count;
    byPriority[row.priority] = (byPriority[row.priority] ?? 0) + row.count;
    total += row.count;
  }

  return { total, byStatus, byType, byPriority };
}

// --- Tags ---

export function listTags(
  db: Database.Database
): Array<{ tag: string; count: number }> {
  return db
    .prepare(
      "SELECT value as tag, COUNT(*) as count FROM tasks, json_each(tasks.tags) GROUP BY value ORDER BY count DESC"
    )
    .all() as Array<{ tag: string; count: number }>;
}
