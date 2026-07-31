import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { setEmbedder } from "@willet/shared";
import { applySchema } from "@willet/shared/dist/db/schema.js";
import {
  createArticle,
  getArticleById,
  updateArticle,
  archiveArticle,
  unarchiveArticle,
  listArticles,
} from "@willet/shared/dist/db/queries.js";

let db: Database.Database;
let embedCalls: string[];

beforeEach(() => {
  embedCalls = [];
  setEmbedder(async (text: string) => {
    embedCalls.push(text);
    return new Float32Array(8).fill(0.1);
  }, 8);

  db = new Database(":memory:");
  applySchema(db);
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
});

const seed = { title: "Auth rationale", content: "why we chose OAuth", tags: ["auth"] };

describe("createArticle", () => {
  it("returns the stored article with defaults applied", async () => {
    const article = await createArticle(db, seed);

    expect(article).toMatchObject({
      title: "Auth rationale",
      content: "why we chose OAuth",
      tags: ["auth"],
      status: "active",
      metadata: {},
    });
    expect(article.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(article.created_at).toBe(article.updated_at);
    expect(getArticleById(db, article.id)).toEqual(article);
  });

  it("embeds title, content, and tags", async () => {
    const article = await createArticle(db, seed);

    expect(embedCalls).toEqual(["Auth rationale\nwhy we chose OAuth\nauth"]);
    const stored = db
      .prepare("SELECT article_id FROM article_embeddings")
      .all() as Array<{ article_id: string }>;
    expect(stored).toEqual([{ article_id: article.id }]);
  });
});

describe("getArticleById", () => {
  it("returns null for an unknown id", () => {
    expect(getArticleById(db, "nope")).toBeNull();
  });
});

describe("updateArticle", () => {
  it("replaces content in place and bumps updated_at", async () => {
    const article = await createArticle(db, seed);

    const updated = await updateArticle(db, {
      article_id: article.id,
      content: "we moved to sessions",
    });

    expect(updated.content).toBe("we moved to sessions");
    expect(updated.title).toBe(article.title);
    expect(updated.updated_at >= article.updated_at).toBe(true);
  });

  it("re-embeds on title, content, or tag changes", async () => {
    const article = await createArticle(db, seed);
    embedCalls.length = 0;

    await updateArticle(db, { article_id: article.id, content: "we moved to sessions" });
    expect(embedCalls).toHaveLength(1);

    await updateArticle(db, { article_id: article.id, tags: ["auth", "adr"] });
    expect(embedCalls).toHaveLength(2);

    await updateArticle(db, { article_id: article.id, title: "Session rationale" });
    expect(embedCalls).toHaveLength(3);
  });

  it("does not re-embed when only metadata changes, or when nothing changes", async () => {
    const article = await createArticle(db, seed);
    embedCalls.length = 0;

    await updateArticle(db, { article_id: article.id, metadata: { source: "adr-4" } });
    await updateArticle(db, { article_id: article.id, content: seed.content });

    expect(embedCalls).toEqual([]);
    expect(getArticleById(db, article.id)!.metadata).toEqual({ source: "adr-4" });
  });

  it("rejects an unknown article", async () => {
    await expect(updateArticle(db, { article_id: "nope", title: "x" })).rejects.toThrow(
      "Article not found: nope"
    );
  });
});

describe("archive / unarchive", () => {
  it("flips status both ways without deleting anything", async () => {
    const article = await createArticle(db, seed);

    expect((await archiveArticle(db, article.id)).status).toBe("archived");
    expect((await unarchiveArticle(db, article.id)).status).toBe("active");
    expect(getArticleById(db, article.id)!.content).toBe(seed.content);
  });

  it("rejects redundant transitions", async () => {
    const article = await createArticle(db, seed);

    await expect(unarchiveArticle(db, article.id)).rejects.toThrow("Article is not archived");
    await archiveArticle(db, article.id);
    await expect(archiveArticle(db, article.id)).rejects.toThrow("Article is already archived");
  });

  it("leaves the embedding alone — archiving is not an edit", async () => {
    const article = await createArticle(db, seed);
    embedCalls.length = 0;

    await archiveArticle(db, article.id);

    expect(embedCalls).toEqual([]);
  });
});

describe("listArticles", () => {
  async function seedThree() {
    const a = await createArticle(db, { title: "A", content: "one", tags: ["auth", "adr"] });
    const b = await createArticle(db, { title: "B", content: "two", tags: ["adr"] });
    const c = await createArticle(db, { title: "C", content: "three" });
    return { a, b, c };
  }

  it("sorts by most recently edited by default", async () => {
    // updated_at has millisecond resolution, so the edit has to be placed on a
    // later tick than the creations for the ordering under test to differ.
    vi.useFakeTimers();
    const { a, b, c } = await seedThree();
    vi.setSystemTime(new Date(Date.now() + 60_000));
    await updateArticle(db, { article_id: a.id, content: "one, revised" });
    vi.useRealTimers();

    const { articles, total } = listArticles(db);

    expect(articles[0].id).toBe(a.id);
    expect(articles.map((x) => x.id).slice(1).sort()).toEqual([b.id, c.id].sort());
    expect(total).toBe(3);
  });

  it("orders ties by id so paging can't repeat or drop a row", async () => {
    await seedThree();

    const ids = listArticles(db).articles.map((x) => x.id);
    const paged = [
      ...listArticles(db, { limit: 2 }).articles,
      ...listArticles(db, { limit: 2, offset: 2 }).articles,
    ].map((x) => x.id);

    expect(paged).toEqual(ids);
  });

  it("hides archived articles unless asked for them", async () => {
    const { b } = await seedThree();
    await archiveArticle(db, b.id);

    expect(listArticles(db).total).toBe(2);
    expect(listArticles(db, { status: "active" }).total).toBe(2);
    expect(listArticles(db, { status: "archived" }).articles.map((x) => x.title)).toEqual(["B"]);
    expect(listArticles(db, { status: "all" }).total).toBe(3);
  });

  it("requires every requested tag to be present", async () => {
    const { a } = await seedThree();

    expect(listArticles(db, { tags: ["adr"] }).total).toBe(2);
    expect(listArticles(db, { tags: ["adr", "auth"] }).articles.map((x) => x.id)).toEqual([a.id]);
    expect(listArticles(db, { tags: ["missing"] }).total).toBe(0);
  });

  it("paginates while reporting the unpaginated total", async () => {
    await seedThree();

    const page = listArticles(db, { sort: "title", sort_direction: "asc", limit: 2 });
    expect(page.articles.map((x) => x.title)).toEqual(["A", "B"]);
    expect(page.total).toBe(3);

    const next = listArticles(db, { sort: "title", sort_direction: "asc", limit: 2, offset: 2 });
    expect(next.articles.map((x) => x.title)).toEqual(["C"]);
  });

  it("rejects a sort field that is not on the allowlist", async () => {
    expect(() =>
      listArticles(db, { sort: "content; DROP TABLE articles" as never })
    ).toThrow("Invalid sort field");
  });
});
