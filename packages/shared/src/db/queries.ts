import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";
import { getCurrentUser } from "../context.js";
import {
  embed,
  embeddingToBuffer,
  type EmbeddingTransform,
} from "../embeddings/local.js";
import { applySchema, applyRegistrySchema } from "./schema.js";
import { hybridSearch } from "./search.js";
import { compileFilter } from "../query/compile.js";
import type { FilterExpr } from "../query/ast.js";
import type {
  Article,
  ArticleSortField,
  ArticleStatus,
  Project,
  Ticket,
  TicketHistory,
  TicketLink,
  TicketComment,
  Status,
  TicketType,
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

    // Migrate legacy tasks.db → tickets.db (no-op if already done).
    const legacyPath = join(dir, "tasks.db");
    const newPath = join(dir, "tickets.db");
    if (!existsSync(newPath) && existsSync(legacyPath)) {
      renameSync(legacyPath, newPath);
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(legacyPath + suffix)) {
          renameSync(legacyPath + suffix, newPath + suffix);
        }
      }
    }

    db = new Database(newPath);
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
  ticketId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null
): void {
  db.prepare(
    "INSERT INTO ticket_history (id, ticket_id, field_changed, old_value, new_value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(ulid(), ticketId, field, oldValue, newValue, new Date().toISOString(), getCurrentUser());
}

// --- Row to entity helpers ---

interface TicketRow {
  id: string;
  title: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  estimate: string | null;
  actual: string | null;
  tags: string;
  parent_ticket_id: string | null;
  assignee: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: string;
}

function rowToTicket(row: TicketRow): Ticket {
  return {
    ...row,
    status: row.status as Status,
    type: row.type as TicketType,
    priority: row.priority as Priority,
    tags: JSON.parse(row.tags) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

interface ArticleRow {
  id: string;
  title: string;
  content: string;
  tags: string;
  status: string;
  created_at: string;
  updated_at: string;
  metadata: string;
}

function rowToArticle(row: ArticleRow): Article {
  return {
    ...row,
    status: row.status as ArticleStatus,
    tags: JSON.parse(row.tags) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

// --- Embedding helper ---

/** Build the text that gets embedded: title, body, tags, then each extra line
 * (ticket comments) on its own line. Kept in one place so every path that
 * embeds an entity (create, update, import) produces an identical vector. */
function buildEmbeddingContent(
  title: string,
  body: string,
  tags: string[],
  extra: string[] = []
): string {
  const extraText = extra.join("\n");
  return `${title}\n${body}\n${tags.join(", ")}${extraText ? `\n${extraText}` : ""}`;
}

/** The set of tables an entity's embeddings live in. */
interface EmbeddingTarget {
  /** Source table, used to resolve the row's rowid for the vector index. */
  table: string;
  /** Table storing the persisted embedding and its content hash. */
  embeddings: string;
  /** sqlite-vec index table. */
  vec: string;
  /** Foreign-key column naming the source row in `embeddings`. */
  idColumn: string;
}

const TICKET_EMBEDDINGS: EmbeddingTarget = {
  table: "tickets",
  embeddings: "ticket_embeddings",
  vec: "ticket_vec",
  idColumn: "ticket_id",
};

const ARTICLE_EMBEDDINGS: EmbeddingTarget = {
  table: "articles",
  embeddings: "article_embeddings",
  vec: "article_vec",
  idColumn: "article_id",
};

/**
 * Embed `content` for row `id` and persist it to the target's embeddings and
 * vector tables. The row must already exist (we look up its rowid). No-op if an
 * embedding for identical content already exists.
 */
async function embedEntityContent(
  db: Database.Database,
  target: EmbeddingTarget,
  id: string,
  content: string,
  transform?: EmbeddingTransform
): Promise<void> {
  // Hash the post-transform text, not the raw fields: the embedding is produced
  // from the transformed text, so the change-detection key must change when the
  // transform does. Otherwise switching/removing a transform (e.g. an e5
  // `passage:` prefix) would leave the early-return below skipping a needed
  // re-embed and the stored vector stale.
  const embedInput = transform ? transform(content) : content;
  const contentHash = createHash("sha256").update(embedInput).digest("hex");

  const existing = db
    .prepare(`SELECT content_hash FROM ${target.embeddings} WHERE ${target.idColumn} = ?`)
    .get(id) as { content_hash: string } | undefined;

  if (existing && existing.content_hash === contentHash) return;

  const embedding = await embed(embedInput);
  const buf = embeddingToBuffer(embedding);
  const rowid = BigInt(
    (db.prepare(`SELECT rowid FROM ${target.table} WHERE id = ?`).get(id) as { rowid: number })
      .rowid
  );

  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO ${target.embeddings} (${target.idColumn}, embedding, content_hash) VALUES (?, ?, ?)`
    ).run(id, buf, contentHash);
    db.prepare(`DELETE FROM ${target.vec} WHERE rowid = ?`).run(rowid);
    db.prepare(`INSERT INTO ${target.vec}(rowid, embedding) VALUES (?, ?)`).run(rowid, buf);
  })();
}

/**
 * Embed the given content for `ticketId`. Exported so bulk import — which
 * inserts rows with raw SQL, bypassing {@link createTicket}/{@link updateTicket}
 * — can generate embeddings inline from the content it is inserting, using the
 * same construction as create/update.
 */
export async function embedTicketContent(
  db: Database.Database,
  ticketId: string,
  fields: {
    title: string;
    description: string;
    tags: string[];
    comments: string[];
  },
  transform?: EmbeddingTransform
): Promise<void> {
  const content = buildEmbeddingContent(
    fields.title,
    fields.description,
    fields.tags,
    fields.comments
  );
  await embedEntityContent(db, TICKET_EMBEDDINGS, ticketId, content, transform);
}

/**
 * Embed the given content for `articleId`. Articles have no comments, so their
 * vector is built from title, content, and tags alone.
 */
export async function embedArticleContent(
  db: Database.Database,
  articleId: string,
  fields: {
    title: string;
    content: string;
    tags: string[];
  },
  transform?: EmbeddingTransform
): Promise<void> {
  const content = buildEmbeddingContent(fields.title, fields.content, fields.tags);
  await embedEntityContent(db, ARTICLE_EMBEDDINGS, articleId, content, transform);
}

async function embedTicket(
  db: Database.Database,
  ticket: Ticket,
  transform?: EmbeddingTransform
): Promise<void> {
  const comments = getComments(db, ticket.id);
  await embedTicketContent(
    db,
    ticket.id,
    {
      title: ticket.title,
      description: ticket.description,
      tags: ticket.tags,
      comments: comments.map((c) => c.content),
    },
    transform
  );
}

// --- Ticket CRUD ---

export async function createTicket(
  db: Database.Database,
  input: {
    title: string;
    description?: string;
    status?: Status;
    type?: TicketType;
    priority?: Priority;
    estimate?: string;
    tags?: string[];
    parent_ticket_id?: string;
    assignee?: string;
    due_date?: string | null;
    metadata?: Record<string, unknown>;
    links?: Array<{ target_ticket_id: string; link_type: LinkType }>;
    initial_comment?: string;
  },
  transform?: EmbeddingTransform
): Promise<Ticket & { links?: TicketLink[]; comment?: TicketComment }> {
  const now = new Date().toISOString();
  const id = ulid();
  const tags = input.tags ?? [];
  const metadata = input.metadata ?? {};
  const status = input.status ?? "open";

  db.prepare(`
    INSERT INTO tickets (id, title, description, status, type, priority, estimate, tags, parent_ticket_id, assignee, due_date, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title,
    input.description ?? "",
    status,
    input.type ?? "chore",
    input.priority ?? "medium",
    input.estimate ?? null,
    JSON.stringify(tags),
    input.parent_ticket_id ?? null,
    input.assignee ?? null,
    input.due_date ?? null,
    now,
    now,
    JSON.stringify(metadata)
  );

  recordChange(db, id, "created", null, id);
  if (status !== "open") {
    recordChange(db, id, "status", "open", status);
  }

  const ticket = getTicketById(db, id)!;

  const result: Ticket & { links?: TicketLink[]; comment?: TicketComment } = { ...ticket };

  if (input.links && input.links.length > 0) {
    result.links = input.links.map((l) => linkTickets(db, id, l.target_ticket_id, l.link_type));
  }

  if (input.initial_comment) {
    result.comment = await addComment(db, id, input.initial_comment, transform);
  } else {
    await embedTicket(db, ticket, transform);
  }

  return result;
}

export function getTicketById(db: Database.Database, ticketId: string): Ticket | null {
  const row = db
    .prepare("SELECT * FROM tickets WHERE id = ?")
    .get(ticketId) as TicketRow | undefined;
  return row ? rowToTicket(row) : null;
}

export async function updateTicket(
  db: Database.Database,
  input: {
    ticket_id: string;
    title?: string;
    description?: string;
    type?: TicketType;
    priority?: Priority;
    estimate?: string | null;
    tags?: string[];
    parent_ticket_id?: string | null;
    assignee?: string | null;
    due_date?: string | null;
    metadata?: Record<string, unknown>;
    status?: Status;
    completed_at?: string | null;
    actual?: string | null;
  },
  transform?: EmbeddingTransform
): Promise<Ticket> {
  const current = getTicketById(db, input.ticket_id);
  if (!current) throw new Error(`Ticket not found: ${input.ticket_id}`);

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
    recordChange(db, input.ticket_id, field, oldStr, newStr);

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
  diffField("parent_ticket_id", input.parent_ticket_id, current.parent_ticket_id);
  diffField("assignee", input.assignee, current.assignee);
  diffField("due_date", input.due_date, current.due_date);
  diffField("tags", input.tags, current.tags, (v) => JSON.stringify(v));
  diffField("metadata", input.metadata, current.metadata, (v) => JSON.stringify(v));

  if (updates.length > 0) {
    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(input.ticket_id);

    db.prepare(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  const updated = getTicketById(db, input.ticket_id)!;
  if (needsReembed) await embedTicket(db, updated, transform);
  return updated;
}

export function deleteTicket(db: Database.Database, ticketId: string): void {
  const ticket = getTicketById(db, ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
  db.prepare("DELETE FROM tickets WHERE id = ?").run(ticketId);
}

// --- Workflow ---

export async function startTicket(db: Database.Database, ticketId: string): Promise<Ticket> {
  const ticket = getTicketById(db, ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
  if (ticket.status === "done" || ticket.status === "cancelled") {
    throw new Error(`Cannot start ticket with status: ${ticket.status}`);
  }
  return updateTicket(db, { ticket_id: ticketId, status: "in_progress" });
}

export async function completeTicket(
  db: Database.Database,
  ticketId: string,
  actual?: string
): Promise<Ticket> {
  const ticket = getTicketById(db, ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
  if (ticket.status === "cancelled") {
    throw new Error("Cannot complete a cancelled ticket");
  }
  return updateTicket(db, {
    ticket_id: ticketId,
    status: "done",
    completed_at: new Date().toISOString(),
    actual: actual ?? undefined,
  });
}

export async function cancelTicket(db: Database.Database, ticketId: string): Promise<Ticket> {
  const ticket = getTicketById(db, ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
  if (ticket.status === "cancelled") {
    throw new Error("Ticket is already cancelled");
  }
  return updateTicket(db, { ticket_id: ticketId, status: "cancelled" });
}

export async function reopenTicket(db: Database.Database, ticketId: string): Promise<Ticket> {
  const ticket = getTicketById(db, ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
  if (ticket.status === "open") {
    throw new Error("Ticket is already open");
  }
  return updateTicket(db, { ticket_id: ticketId, status: "open", completed_at: null });
}

// --- Comments ---

export async function addComment(
  db: Database.Database,
  ticketId: string,
  content: string,
  transform?: EmbeddingTransform
): Promise<TicketComment> {
  const ticket = getTicketById(db, ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

  const comment: TicketComment = {
    id: ulid(),
    ticket_id: ticketId,
    content,
    created_at: new Date().toISOString(),
    created_by: getCurrentUser(),
  };

  db.prepare(
    "INSERT INTO ticket_comments (id, ticket_id, content, created_at, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(comment.id, comment.ticket_id, comment.content, comment.created_at, comment.created_by);

  await embedTicket(db, ticket, transform);

  return comment;
}

export function getComments(db: Database.Database, ticketId: string): TicketComment[] {
  return db
    .prepare("SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at")
    .all(ticketId) as TicketComment[];
}

// --- Links ---

export function linkTickets(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType: LinkType
): TicketLink {
  if (sourceId === targetId) {
    throw new Error("Cannot link a ticket to itself");
  }

  // Verify both tickets exist
  if (!getTicketById(db, sourceId)) throw new Error(`Ticket not found: ${sourceId}`);
  if (!getTicketById(db, targetId)) throw new Error(`Ticket not found: ${targetId}`);

  const link: TicketLink = {
    id: ulid(),
    source_ticket_id: sourceId,
    target_ticket_id: targetId,
    link_type: linkType,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    "INSERT INTO ticket_links (id, source_ticket_id, target_ticket_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(link.id, link.source_ticket_id, link.target_ticket_id, link.link_type, link.created_at);

  return link;
}

export function unlinkTickets(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType: LinkType
): void {
  const result = db
    .prepare(
      "DELETE FROM ticket_links WHERE source_ticket_id = ? AND target_ticket_id = ? AND link_type = ?"
    )
    .run(sourceId, targetId, linkType);

  if (result.changes === 0) {
    throw new Error("Link not found");
  }
}

export function getLinks(db: Database.Database, ticketId: string): TicketLink[] {
  return db
    .prepare(
      "SELECT * FROM ticket_links WHERE source_ticket_id = ? OR target_ticket_id = ? ORDER BY created_at"
    )
    .all(ticketId, ticketId) as TicketLink[];
}

// --- History ---

export function getHistory(db: Database.Database, ticketId: string): TicketHistory[] {
  return db
    .prepare("SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY changed_at")
    .all(ticketId) as TicketHistory[];
}

// --- List tickets ---

export interface ListTicketsOptions {
  /**
   * Boolean filter predicate — either the source string of the ticket filter
   * language or a pre-parsed AST. Omit (or pass empty) for no filtering.
   */
  filter?: string | FilterExpr;
  sort?: SortField;
  sort_direction?: SortDirection;
  limit?: number;
  offset?: number;
  /** Local (stdio) mode hides multi-user fields like `assignee` from filters. */
  mode?: "local" | "http";
}

export function listTickets(
  db: Database.Database,
  opts: ListTicketsOptions = {}
): { tickets: Ticket[]; total: number } {
  const { where, params } = compileFilter(opts.filter ?? "", { mode: opts.mode });
  const whereClause = where ? `WHERE ${where}` : "";

  const sort = opts.sort ?? "created_at";
  const dir = opts.sort_direction ?? "desc";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  // Tickets without a due date should sort after tickets with one, regardless of direction.
  const nullsClause = sort === "due_date" ? " NULLS LAST" : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM tickets ${whereClause}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(
      `SELECT * FROM tickets ${whereClause} ORDER BY ${sort} ${dir}${nullsClause} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as TicketRow[];

  return {
    tickets: rows.map(rowToTicket),
    total: countRow.total,
  };
}

// --- Search ---

export interface SearchTicketsOptions {
  mode?: SearchMode;
  /** Boolean filter predicate (filter-language string or AST) to narrow results. */
  filter?: string | FilterExpr;
  limit?: number;
  /** Local (stdio) mode hides multi-user fields like `assignee` from filters. */
  queryMode?: "local" | "http";
}

export async function searchTickets(
  db: Database.Database,
  query: string,
  opts: SearchTicketsOptions = {},
  transform?: EmbeddingTransform
): Promise<Array<Ticket & { score: number }>> {
  return hybridSearch<Ticket, TicketRow>(
    db,
    {
      table: "tickets",
      fts: "tickets_fts",
      vec: "ticket_vec",
      fromRow: rowToTicket,
    },
    query,
    {
      mode: opts.mode,
      limit: opts.limit,
      filter: (alias) =>
        compileFilter(opts.filter ?? "", { mode: opts.queryMode, table: alias }),
    },
    transform
  );
}

// --- Ticket graph (BFS) ---

export function getTicketGraph(
  db: Database.Database,
  ticketId: string,
  depth: number = 1
): { nodes: Ticket[]; edges: TicketLink[] } {
  const visited = new Set<string>();
  const allEdges: TicketLink[] = [];
  let frontier = [ticketId];

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
            link.source_ticket_id === id ? link.target_ticket_id : link.source_ticket_id;
          if (!visited.has(neighbor)) {
            nextFrontier.push(neighbor);
          }
        }
      }
    }

    frontier = nextFrontier;
  }

  const nodes: Ticket[] = [];
  for (const id of visited) {
    const ticket = getTicketById(db, id);
    if (ticket) nodes.push(ticket);
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
      "SELECT status, type, priority, COUNT(*) as count FROM tickets GROUP BY status, type, priority"
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

// --- Article CRUD ---
//
// Articles are living documents: edits land in place, there is no workflow, no
// history, and no comments. `status` is only a reversible kill switch
// (archive/unarchive) so search can hide retired docs.

async function embedArticle(
  db: Database.Database,
  article: Article,
  transform?: EmbeddingTransform
): Promise<void> {
  await embedArticleContent(
    db,
    article.id,
    { title: article.title, content: article.content, tags: article.tags },
    transform
  );
}

export async function createArticle(
  db: Database.Database,
  input: {
    title: string;
    content: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
  transform?: EmbeddingTransform
): Promise<Article> {
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO articles (id, title, content, tags, status, created_at, updated_at, metadata)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.content,
    JSON.stringify(input.tags ?? []),
    now,
    now,
    JSON.stringify(input.metadata ?? {})
  );

  const article = getArticleById(db, id)!;
  await embedArticle(db, article, transform);
  return article;
}

export function getArticleById(db: Database.Database, articleId: string): Article | null {
  const row = db
    .prepare("SELECT * FROM articles WHERE id = ?")
    .get(articleId) as ArticleRow | undefined;
  return row ? rowToArticle(row) : null;
}

export async function updateArticle(
  db: Database.Database,
  input: {
    article_id: string;
    title?: string;
    content?: string;
    tags?: string[];
    status?: ArticleStatus;
    metadata?: Record<string, unknown>;
  },
  transform?: EmbeddingTransform
): Promise<Article> {
  const current = getArticleById(db, input.article_id);
  if (!current) throw new Error(`Article not found: ${input.article_id}`);

  const updates: string[] = [];
  const params: unknown[] = [];
  let needsReembed = false;

  const setField = (
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

    if (field === "title" || field === "content" || field === "tags") {
      needsReembed = true;
    }
  };

  setField("title", input.title, current.title);
  setField("content", input.content, current.content);
  setField("status", input.status, current.status);
  setField("tags", input.tags, current.tags, (v) => JSON.stringify(v));
  setField("metadata", input.metadata, current.metadata, (v) => JSON.stringify(v));

  if (updates.length > 0) {
    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(input.article_id);

    db.prepare(`UPDATE articles SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  const updated = getArticleById(db, input.article_id)!;
  if (needsReembed) await embedArticle(db, updated, transform);
  return updated;
}

export async function archiveArticle(
  db: Database.Database,
  articleId: string
): Promise<Article> {
  const article = getArticleById(db, articleId);
  if (!article) throw new Error(`Article not found: ${articleId}`);
  if (article.status === "archived") throw new Error("Article is already archived");
  return updateArticle(db, { article_id: articleId, status: "archived" });
}

export async function unarchiveArticle(
  db: Database.Database,
  articleId: string
): Promise<Article> {
  const article = getArticleById(db, articleId);
  if (!article) throw new Error(`Article not found: ${articleId}`);
  if (article.status === "active") throw new Error("Article is not archived");
  return updateArticle(db, { article_id: articleId, status: "active" });
}

export interface ListArticlesOptions {
  status?: ArticleStatus;
  /** Articles must carry every tag listed here. */
  tags?: string[];
  sort?: ArticleSortField;
  sort_direction?: SortDirection;
  limit?: number;
  offset?: number;
}

const ARTICLE_SORT_FIELDS = new Set(["created_at", "updated_at", "title"]);

export function listArticles(
  db: Database.Database,
  opts: ListArticlesOptions = {}
): { articles: Article[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  for (const tag of opts.tags ?? []) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(articles.tags) WHERE value = ?)");
    params.push(tag);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sort = opts.sort ?? "updated_at";
  if (!ARTICLE_SORT_FIELDS.has(sort)) throw new Error(`Invalid sort field: ${sort}`);
  const dir = opts.sort_direction === "asc" ? "ASC" : "DESC";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM articles ${whereClause}`)
    .get(...params) as { total: number };

  // Timestamps are millisecond-resolution, so a batch of articles written in
  // the same tick would otherwise page in an unspecified order and rows could
  // repeat or vanish across pages. The id tie-break makes paging total.
  const rows = db
    .prepare(
      `SELECT * FROM articles ${whereClause} ORDER BY ${sort} ${dir}, id ${dir} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ArticleRow[];

  return { articles: rows.map(rowToArticle), total: countRow.total };
}

// --- Tags ---

export function listTags(
  db: Database.Database
): Array<{ tag: string; count: number }> {
  return db
    .prepare(
      "SELECT value as tag, COUNT(*) as count FROM tickets, json_each(tickets.tags) GROUP BY value ORDER BY count DESC"
    )
    .all() as Array<{ tag: string; count: number }>;
}
