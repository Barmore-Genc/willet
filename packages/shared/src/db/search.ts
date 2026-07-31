import Database from "better-sqlite3";
import { embed, embeddingToBuffer, type EmbeddingTransform } from "../embeddings/local.js";
import type { SearchMode } from "../models/types.js";

/** The tables backing one searchable entity, plus how to hydrate its rows. */
export interface SearchTarget<T, Row> {
  /** Source table. Must have `id` and `rowid` columns. */
  table: string;
  /** External-content FTS5 table over `table`. */
  fts: string;
  /** sqlite-vec index over `table`. */
  vec: string;
  fromRow(row: Row): T;
}

// Build an FTS5 MATCH expression from a free-text query.
// Each whitespace-separated term is wrapped in a double-quoted string so FTS5
// treats it as a literal, not as query syntax. Without this, a term containing
// special syntax (a column filter like `in:progress`, a prefix `*`, a bare
// keyword like `OR`/`NEAR`, or an unbalanced `"`) makes FTS5 raise a syntax or
// "no such column" error and the whole search fails. Internal double quotes are
// escaped by doubling, per FTS5 string-literal rules.
//
// Text mode joins terms with FTS5's implicit AND (every term must appear);
// hybrid mode ORs them, since recall matters more there — RRF re-ranks against
// the vector hits anyway.
export function buildMatchExpr(query: string, join: "AND" | "OR"): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(join === "OR" ? " OR " : " ");
}

export interface HybridSearchOptions {
  mode?: SearchMode;
  limit?: number;
  /**
   * Build a SQL predicate narrowing results, over the entity table under
   * `alias`. Called per query since the alias differs between the FTS join
   * (`t`) and the id-restriction pass (the table's own name).
   */
  filter?: (alias: string) => { where: string; params: unknown[] };
}

/**
 * Search one entity by text (FTS5), meaning (vector KNN), or both fused with
 * reciprocal rank fusion.
 *
 * Text mode filters inside the FTS query. The semantic and hybrid modes rank
 * first and filter after, so a restrictive predicate can return fewer than
 * `limit` results even when more would match — they over-fetch to compensate.
 */
export async function hybridSearch<T, Row>(
  db: Database.Database,
  target: SearchTarget<T, Row>,
  query: string,
  opts: HybridSearchOptions = {},
  transform?: EmbeddingTransform
): Promise<Array<T & { score: number }>> {
  const mode = opts.mode ?? "hybrid";
  const limit = opts.limit ?? 20;
  const compile = opts.filter ?? (() => ({ where: "", params: [] as unknown[] }));

  const byId = (id: string): T | null => {
    const row = db.prepare(`SELECT * FROM ${target.table} WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row ? target.fromRow(row) : null;
  };

  // Restrict a set of candidate ids to those the predicate accepts. Used by the
  // semantic/hybrid paths, which rank first then filter.
  const idFilter = compile(target.table);
  function passesFilter(ids: string[]): Set<string> {
    if (!idFilter.where || ids.length === 0) return new Set(ids);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT id FROM ${target.table} WHERE id IN (${placeholders}) AND (${idFilter.where})`
      )
      .all(...ids, ...idFilter.params) as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  if (mode === "text") {
    const matchExpr = buildMatchExpr(query, "AND");
    if (!matchExpr) return [];

    // The FTS join aliases the source table as `t`; compile against that alias.
    const { where, params } = compile("t");
    const filterClause = where ? ` AND (${where})` : "";
    const rows = db
      .prepare(
        `SELECT t.*, fts.rank as score
         FROM ${target.fts} fts
         JOIN ${target.table} t ON t.rowid = fts.rowid
         WHERE ${target.fts} MATCH ?${filterClause}
         ORDER BY fts.rank
         LIMIT ?`
      )
      .all(matchExpr, ...params, limit) as Array<Row & { score: number }>;

    return rows.map((r) => ({ ...target.fromRow(r), score: r.score }));
  }

  async function knnSearch(kLimit: number): Promise<Array<{ id: string; distance: number }>> {
    const queryEmbedding = await embed(query, transform);
    const queryBuf = embeddingToBuffer(queryEmbedding);
    return db
      .prepare(
        `SELECT t.id, knn.distance
         FROM (SELECT rowid, distance FROM ${target.vec} WHERE embedding MATCH ? AND k = ?) knn
         JOIN ${target.table} t ON t.rowid = knn.rowid`
      )
      .all(queryBuf, kLimit) as Array<{ id: string; distance: number }>;
  }

  if (mode === "semantic") {
    const knnRows = await knnSearch(limit * 5);
    const allowed = passesFilter(knnRows.map((r) => r.id));
    const results: Array<T & { score: number }> = [];
    for (const row of knnRows) {
      if (results.length >= limit) break;
      if (!allowed.has(row.id)) continue;
      const entity = byId(row.id);
      if (!entity) continue;
      results.push({ ...entity, score: 1 - row.distance });
    }
    return results;
  }

  // Hybrid: reciprocal rank fusion
  const k = 60;

  const matchExpr = buildMatchExpr(query, "OR");
  const ftsRows = matchExpr
    ? (db
        .prepare(
          `SELECT t.id
           FROM ${target.fts} fts
           JOIN ${target.table} t ON t.rowid = fts.rowid
           WHERE ${target.fts} MATCH ?
           ORDER BY fts.rank
           LIMIT ?`
        )
        .all(matchExpr, limit * 2) as Array<{ id: string }>)
    : [];

  const knnRows = await knnSearch(limit * 5);

  const rrfScores = new Map<string, number>();
  ftsRows.forEach((r, i) => {
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });
  knnRows.forEach((r, i) => {
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });

  const sorted = [...rrfScores.entries()].sort((a, b) => b[1] - a[1]);

  const allowed = passesFilter(sorted.map(([id]) => id));
  const results: Array<T & { score: number }> = [];
  for (const [id, score] of sorted) {
    if (results.length >= limit) break;
    if (!allowed.has(id)) continue;
    const entity = byId(id);
    if (!entity) continue;
    results.push({ ...entity, score });
  }
  return results;
}
