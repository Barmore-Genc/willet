import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { getEmbeddingDim } from "../embeddings/local.js";

/**
 * Create an external-content FTS5 table over `table` plus the three triggers
 * that keep it in sync, unless it already exists. Virtual tables don't support
 * IF NOT EXISTS, hence the explicit check.
 */
function ensureFtsTable(
  db: Database.Database,
  opts: { table: string; fts: string; columns: [string, string] }
): void {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(opts.fts);
  if (exists) return;

  const { table, fts } = opts;
  const [a, b] = opts.columns;

  db.exec(`
    CREATE VIRTUAL TABLE ${fts} USING fts5(
      ${a},
      ${b},
      content=${table},
      content_rowid=rowid
    );

    CREATE TRIGGER ${table}_ai AFTER INSERT ON ${table} BEGIN
      INSERT INTO ${fts}(rowid, ${a}, ${b})
      VALUES (new.rowid, new.${a}, new.${b});
    END;

    CREATE TRIGGER ${table}_ad AFTER DELETE ON ${table} BEGIN
      INSERT INTO ${fts}(${fts}, rowid, ${a}, ${b})
      VALUES ('delete', old.rowid, old.${a}, old.${b});
    END;

    CREATE TRIGGER ${table}_au AFTER UPDATE ON ${table} BEGIN
      INSERT INTO ${fts}(${fts}, rowid, ${a}, ${b})
      VALUES ('delete', old.rowid, old.${a}, old.${b});
      INSERT INTO ${fts}(rowid, ${a}, ${b})
      VALUES (new.rowid, new.${a}, new.${b});
    END;

    INSERT INTO ${fts}(${fts}) VALUES('rebuild');
  `);
}

/**
 * Create a sqlite-vec table for `table`, its delete-cleanup trigger, and
 * backfill it from the already-persisted embeddings, unless it already exists.
 */
function ensureVecTable(
  db: Database.Database,
  opts: { table: string; vec: string; embeddings: string; idColumn: string }
): void {
  const { table, vec, embeddings, idColumn } = opts;

  const vecRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(vec) as { sql: string } | undefined;

  if (!vecRow) {
    db.exec(
      `CREATE VIRTUAL TABLE ${vec} USING vec0(embedding float[${getEmbeddingDim()}] distance_metric=cosine)`
    );

    db.exec(`
      CREATE TRIGGER ${vec}_cleanup BEFORE DELETE ON ${table} BEGIN
        DELETE FROM ${vec} WHERE rowid = old.rowid;
      END;
    `);

    const rows = db
      .prepare(
        `SELECT t.rowid, e.embedding FROM ${embeddings} e JOIN ${table} t ON t.id = e.${idColumn}`
      )
      .all() as Array<{ rowid: number; embedding: Buffer }>;

    if (rows.length > 0) {
      const insert = db.prepare(`INSERT INTO ${vec}(rowid, embedding) VALUES (?, ?)`);
      db.transaction(() => {
        for (const row of rows) {
          insert.run(BigInt(row.rowid), row.embedding);
        }
      })();
    }
    return;
  }

  // The table is created once at the then-active dimension and never
  // auto-migrated (that's the embedder's/operator's job — e.g. a re-embed
  // import). If the active model's dimension no longer matches, vector search
  // will error or silently misbehave, so surface a loud warning rather than
  // failing opaquely later.
  const existingDim = vecRow.sql.match(/float\[(\d+)\]/)?.[1];
  const activeDim = getEmbeddingDim();
  if (existingDim !== undefined && Number(existingDim) !== activeDim) {
    console.error(
      `Warning: ${vec} was created with dimension ${existingDim} but the ` +
        `active embedding model produces ${activeDim}. Vector search will fail ` +
        `until the table is rebuilt (re-embed/re-import). The schema is not ` +
        `auto-migrated.`
    );
  }
}

export function applySchema(db: Database.Database): void {
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // One-shot migration: rename legacy `tasks`/* tables and columns to the
  // `tickets` naming. Runs at most once per DB — gated on the old `tasks`
  // table still existing. Safe to leave in place forever; the check is cheap
  // and no-ops once migrated.
  const legacyTasks = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
    .get();

  if (legacyTasks) {
    db.exec(`
      DROP TRIGGER IF EXISTS tasks_ai;
      DROP TRIGGER IF EXISTS tasks_ad;
      DROP TRIGGER IF EXISTS tasks_au;
      DROP TABLE IF EXISTS tasks_fts;

      DROP TRIGGER IF EXISTS task_vec_cleanup;
      DROP TABLE IF EXISTS task_vec;

      DROP INDEX IF EXISTS idx_tasks_status;
      DROP INDEX IF EXISTS idx_tasks_parent;
      DROP INDEX IF EXISTS idx_tasks_created;
      DROP INDEX IF EXISTS idx_tasks_completed;
      DROP INDEX IF EXISTS idx_tasks_assignee;
      DROP INDEX IF EXISTS idx_tasks_due_date;
      DROP INDEX IF EXISTS idx_task_links_source;
      DROP INDEX IF EXISTS idx_task_links_target;
      DROP INDEX IF EXISTS idx_task_comments_task;
      DROP INDEX IF EXISTS idx_task_history_task;

      ALTER TABLE tasks RENAME COLUMN parent_task_id TO parent_ticket_id;
      ALTER TABLE tasks RENAME TO tickets;

      ALTER TABLE task_history RENAME COLUMN task_id TO ticket_id;
      ALTER TABLE task_history RENAME TO ticket_history;

      ALTER TABLE task_links RENAME COLUMN source_task_id TO source_ticket_id;
      ALTER TABLE task_links RENAME COLUMN target_task_id TO target_ticket_id;
      ALTER TABLE task_links RENAME TO ticket_links;

      ALTER TABLE task_comments RENAME COLUMN task_id TO ticket_id;
      ALTER TABLE task_comments RENAME TO ticket_comments;

      ALTER TABLE task_embeddings RENAME COLUMN task_id TO ticket_id;
      ALTER TABLE task_embeddings RENAME TO ticket_embeddings;

      UPDATE tickets SET type = 'chore' WHERE type = 'task';
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      type TEXT NOT NULL DEFAULT 'chore',
      priority TEXT NOT NULL DEFAULT 'medium',
      estimate TEXT,
      actual TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      parent_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
      assignee TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );


    CREATE TABLE IF NOT EXISTS ticket_history (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      field_changed TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT NOT NULL,
      changed_by TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS ticket_links (
      id TEXT PRIMARY KEY,
      source_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      target_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(source_ticket_id, target_ticket_id, link_type)
    );

    CREATE TABLE IF NOT EXISTS ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS ticket_embeddings (
      ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_ticket_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_completed ON tickets(completed_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_links_source ON ticket_links(source_ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_links_target ON ticket_links(target_ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id);
  `);

  // Migration: add assignee column to existing databases
  const hasAssignee = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('tickets') WHERE name = 'assignee'")
    .get() as { cnt: number };
  if (hasAssignee.cnt === 0) {
    db.exec("ALTER TABLE tickets ADD COLUMN assignee TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee)");

  // Migration: add due_date column to existing databases
  const hasDueDate = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('tickets') WHERE name = 'due_date'")
    .get() as { cnt: number };
  if (hasDueDate.cnt === 0) {
    db.exec("ALTER TABLE tickets ADD COLUMN due_date TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON tickets(due_date)");

  ensureFtsTable(db, {
    table: "tickets",
    fts: "tickets_fts",
    columns: ["title", "description"],
  });

  ensureVecTable(db, {
    table: "tickets",
    vec: "ticket_vec",
    embeddings: "ticket_embeddings",
    idColumn: "ticket_id",
  });

  // --- Articles (knowledge base) ---
  //
  // Deliberately narrower than tickets: no workflow status, no priority, no
  // assignee, no due date, no comments, no history. `status` is only a
  // reversible kill switch so search can hide retired docs.

  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS article_embeddings (
      article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);
    CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at);
  `);

  ensureFtsTable(db, {
    table: "articles",
    fts: "articles_fts",
    columns: ["title", "content"],
  });

  ensureVecTable(db, {
    table: "articles",
    vec: "article_vec",
    embeddings: "article_embeddings",
    idColumn: "article_id",
  });
}

export function applyRegistrySchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      directory TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
}
