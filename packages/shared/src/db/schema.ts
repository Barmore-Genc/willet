import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { EMBEDDING_DIM } from "../embeddings/local.js";

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

  // FTS5 virtual table — can't use IF NOT EXISTS, so check first
  const ftsExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tickets_fts'"
    )
    .get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE tickets_fts USING fts5(
        title,
        description,
        content=tickets,
        content_rowid=rowid
      );

      CREATE TRIGGER tickets_ai AFTER INSERT ON tickets BEGIN
        INSERT INTO tickets_fts(rowid, title, description)
        VALUES (new.rowid, new.title, new.description);
      END;

      CREATE TRIGGER tickets_ad AFTER DELETE ON tickets BEGIN
        INSERT INTO tickets_fts(tickets_fts, rowid, title, description)
        VALUES ('delete', old.rowid, old.title, old.description);
      END;

      CREATE TRIGGER tickets_au AFTER UPDATE ON tickets BEGIN
        INSERT INTO tickets_fts(tickets_fts, rowid, title, description)
        VALUES ('delete', old.rowid, old.title, old.description);
        INSERT INTO tickets_fts(rowid, title, description)
        VALUES (new.rowid, new.title, new.description);
      END;

      INSERT INTO tickets_fts(tickets_fts) VALUES('rebuild');
    `);
  }

  // --- Vector search (sqlite-vec) ---

  const vecExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ticket_vec'"
    )
    .get();

  if (!vecExists) {
    db.exec(
      `CREATE VIRTUAL TABLE ticket_vec USING vec0(embedding float[${EMBEDDING_DIM}] distance_metric=cosine)`
    );

    db.exec(`
      CREATE TRIGGER ticket_vec_cleanup BEFORE DELETE ON tickets BEGIN
        DELETE FROM ticket_vec WHERE rowid = old.rowid;
      END;
    `);

    // Backfill from existing embeddings
    const rows = db
      .prepare(
        "SELECT t.rowid, te.embedding FROM ticket_embeddings te JOIN tickets t ON t.id = te.ticket_id"
      )
      .all() as Array<{ rowid: number; embedding: Buffer }>;

    if (rows.length > 0) {
      const insert = db.prepare(
        "INSERT INTO ticket_vec(rowid, embedding) VALUES (?, ?)"
      );
      db.transaction(() => {
        for (const row of rows) {
          insert.run(BigInt(row.rowid), row.embedding);
        }
      })();
    }
  }
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
