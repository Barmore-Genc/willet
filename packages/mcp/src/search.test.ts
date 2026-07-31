import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { setEmbedder, EMBEDDING_DIM } from "@willet/shared";
import { applySchema } from "@willet/shared/dist/db/schema.js";
import {
  createTicket,
  searchTickets,
  embedArticleContent,
} from "@willet/shared/dist/db/queries.js";
import { hybridSearch } from "@willet/shared/dist/db/search.js";
import type { SearchMode } from "@willet/shared";

// A custom embedder keeps these tests off the ONNX model. Deterministic, and
// the vector hits don't matter here — what's under test is FTS5 expression
// building, not ranking.
beforeAll(() => {
  setEmbedder(async (text: string) => {
    const v = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < text.length; i++) v[i % EMBEDDING_DIM] += text.charCodeAt(i);
    const norm = Math.hypot(...v) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }, EMBEDDING_DIM);
});

let db: Database.Database;

beforeEach(async () => {
  db = new Database(":memory:");
  applySchema(db);
  await createTicket(db, {
    title: "Standup meeting at 14:30",
    description: "login redirect loop is in progress",
  });
});

const MODES: SearchMode[] = ["text", "hybrid", "semantic"];

describe("searchTickets FTS5 expression building", () => {
  // Every one of these is valid FTS5 syntax that means something other than
  // "match this text", so an unescaped query blew up the whole search.
  // https://kaan-barmore-genc.sentry.io/issues/WILLET-SERVER-8
  const syntaxQueries = [
    ["a column filter", "in:progress"],
    ["a ticket key with a colon", "WD-30: fix"],
    ["a time", "meeting at 14:30"],
    ["a dangling boolean keyword", "login OR"],
    ["an unbalanced double quote", 'say "hi'],
    ["a bare prefix star", "*"],
    ["parens", "(login)"],
  ] as const;

  for (const [label, query] of syntaxQueries) {
    for (const mode of MODES) {
      it(`does not throw on ${label} in ${mode} mode`, async () => {
        await expect(
          searchTickets(db, query, { mode })
        ).resolves.toBeInstanceOf(Array);
      });
    }
  }

  it("matches a colon-containing term literally rather than as a column filter", async () => {
    const results = await searchTickets(db, "14:30", { mode: "text" });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Standup meeting at 14:30");
  });

  it("requires every term to match in text mode", async () => {
    await expect(searchTickets(db, "standup meeting", { mode: "text" })).resolves.toHaveLength(1);
    // "absent" appears in no ticket, so the implicit AND rules the row out.
    await expect(searchTickets(db, "standup absent", { mode: "text" })).resolves.toHaveLength(0);
  });

  // An empty MATCH expression is itself an FTS5 syntax error. Semantic mode is
  // excluded: it never touches FTS5, and still returns vector neighbours here.
  it("returns no results for a whitespace-only text query instead of throwing", async () => {
    await expect(searchTickets(db, "   ", { mode: "text" })).resolves.toEqual([]);
  });
});

// searchTickets is one caller of the shared helper; articles are the other.
// Driving it against a second entity is what proves the extraction actually
// generalized rather than just moving ticket-shaped code to a new file.
describe("hybridSearch over a second entity (articles)", () => {
  interface ArticleRow {
    id: string;
    title: string;
    content: string;
    status: string;
  }

  const target = {
    table: "articles",
    fts: "articles_fts",
    vec: "article_vec",
    fromRow: (row: ArticleRow) => row,
  };

  beforeEach(async () => {
    const now = new Date().toISOString();
    const insert = db.prepare(
      "INSERT INTO articles (id, title, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const rows: Array<[string, string, string, string]> = [
      ["a1", "Auth rationale", "why we chose OAuth over sessions", "active"],
      ["a2", "Search design", "FTS5 and vector KNN fused with RRF", "active"],
      ["a3", "Retired plan", "an old OAuth plan we abandoned", "archived"],
    ];
    for (const [id, title, content, status] of rows) {
      insert.run(id, title, content, status, now, now);
      await embedArticleContent(db, id, { title, content, tags: [] });
    }
  });

  for (const mode of MODES) {
    it(`finds articles in ${mode} mode`, async () => {
      const results = await hybridSearch<ArticleRow, ArticleRow>(db, target, "OAuth", { mode });
      expect(results.map((r) => r.id)).toContain("a1");
    });
  }

  it("applies a caller-supplied filter in every mode", async () => {
    for (const mode of MODES) {
      const results = await hybridSearch<ArticleRow, ArticleRow>(db, target, "OAuth", {
        mode,
        filter: (alias) => ({ where: `${alias}.status = ?`, params: ["active"] }),
      });
      expect(results.map((r) => r.id)).not.toContain("a3");
    }
  });

  it("escapes FTS5 syntax in article queries too", async () => {
    for (const mode of MODES) {
      await expect(
        hybridSearch<ArticleRow, ArticleRow>(db, target, "in:progress OR", { mode })
      ).resolves.toBeInstanceOf(Array);
    }
  });
});
