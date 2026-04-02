import Database from "better-sqlite3";

export function applySchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      type TEXT NOT NULL DEFAULT 'task',
      priority TEXT NOT NULL DEFAULT 'medium',
      estimate TEXT,
      actual TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS task_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      field_changed TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT NOT NULL,
      changed_by TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS task_links (
      id TEXT PRIMARY KEY,
      source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(source_task_id, target_task_id, link_type)
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS task_embeddings (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed_at);
    CREATE INDEX IF NOT EXISTS idx_task_links_source ON task_links(source_task_id);
    CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_task_id);
    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
  `);

  // FTS5 virtual table — can't use IF NOT EXISTS, so check first
  const ftsExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks_fts'"
    )
    .get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE tasks_fts USING fts5(
        title,
        description,
        content=tasks,
        content_rowid=rowid
      );

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
    `);
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
