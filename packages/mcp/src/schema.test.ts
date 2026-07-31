import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { EMBEDDING_DIM } from "@willet/shared";
import { applySchema } from "@willet/shared/dist/db/schema.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  applySchema(db);
});

function tableExists(name: string): boolean {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) !== undefined
  );
}

function insertArticle(id: string, title: string, content: string): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO articles (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, title, content, now, now);
}

function ftsIds(match: string): string[] {
  return (
    db
      .prepare(
        `SELECT a.id FROM articles_fts fts JOIN articles a ON a.rowid = fts.rowid
         WHERE articles_fts MATCH ? ORDER BY fts.rank`
      )
      .all(match) as Array<{ id: string }>
  ).map((r) => r.id);
}

describe("article schema", () => {
  it("creates the articles tables and search structures", () => {
    expect(tableExists("articles")).toBe(true);
    expect(tableExists("article_embeddings")).toBe(true);
    expect(tableExists("articles_fts")).toBe(true);
    expect(tableExists("article_vec")).toBe(true);
  });

  it("defaults status to active", () => {
    insertArticle("a1", "Auth rationale", "why we chose OAuth");
    const row = db.prepare("SELECT status, tags, metadata FROM articles WHERE id = 'a1'").get() as {
      status: string;
      tags: string;
      metadata: string;
    };
    expect(row).toEqual({ status: "active", tags: "[]", metadata: "{}" });
  });

  it("is idempotent — re-applying leaves data intact", () => {
    insertArticle("a1", "Auth rationale", "why we chose OAuth");

    expect(() => applySchema(db)).not.toThrow();
    expect(() => applySchema(db)).not.toThrow();

    expect(
      (db.prepare("SELECT COUNT(*) as n FROM articles").get() as { n: number }).n
    ).toBe(1);
    expect(ftsIds("OAuth")).toEqual(["a1"]);
  });

  it("leaves the ticket tables in place", () => {
    for (const t of ["tickets", "ticket_embeddings", "tickets_fts", "ticket_vec"]) {
      expect(tableExists(t)).toBe(true);
    }
  });
});

describe("articles_fts sync triggers", () => {
  beforeEach(() => {
    insertArticle("a1", "Auth rationale", "why we chose OAuth over sessions");
  });

  it("indexes on insert", () => {
    expect(ftsIds("OAuth")).toEqual(["a1"]);
    expect(ftsIds("rationale")).toEqual(["a1"]);
  });

  it("reindexes on update", () => {
    db.prepare("UPDATE articles SET content = ? WHERE id = 'a1'").run(
      "we switched to sessions instead"
    );

    expect(ftsIds("OAuth")).toEqual([]);
    expect(ftsIds("sessions")).toEqual(["a1"]);
  });

  it("drops the row on delete", () => {
    db.prepare("DELETE FROM articles WHERE id = 'a1'").run();

    expect(ftsIds("OAuth")).toEqual([]);
  });
});

describe("article_vec", () => {
  const zeroEmbedding = () => Buffer.from(new Float32Array(EMBEDDING_DIM).buffer);

  function vecCount(): number {
    return (db.prepare("SELECT COUNT(*) as n FROM article_vec").get() as { n: number }).n;
  }

  it("cascades deletes from articles", () => {
    insertArticle("a1", "Auth rationale", "why we chose OAuth");
    const { rowid } = db.prepare("SELECT rowid FROM articles WHERE id = 'a1'").get() as {
      rowid: number;
    };
    db.prepare("INSERT INTO article_vec(rowid, embedding) VALUES (?, ?)").run(
      BigInt(rowid),
      zeroEmbedding()
    );
    expect(vecCount()).toBe(1);

    db.prepare("DELETE FROM articles WHERE id = 'a1'").run();

    expect(vecCount()).toBe(0);
  });

  // The upgrade path for a DB that has embeddings but no vec table yet — the
  // same situation ticket_vec was introduced into.
  it("backfills from article_embeddings when the table is (re)created", () => {
    insertArticle("a1", "Auth rationale", "why we chose OAuth");
    db.prepare(
      "INSERT INTO article_embeddings (article_id, embedding, content_hash) VALUES (?, ?, ?)"
    ).run("a1", zeroEmbedding(), "hash");

    db.exec("DROP TRIGGER article_vec_cleanup; DROP TABLE article_vec;");
    applySchema(db);

    expect(vecCount()).toBe(1);
  });
});
