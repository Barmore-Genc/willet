import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { applySchema } from "@willet/shared/dist/db/schema.js";
import { parseFilter, compileFilter, QueryError } from "@willet/shared";

// --- Parser: structure and precedence ---

describe("parseFilter", () => {
  it("binds AND tighter than OR", () => {
    const ast = parseFilter("a = '1' OR b = '2' AND c = '3'");
    // Expect: a=1 OR (b=2 AND c=3)
    expect(ast.node).toBe("or");
    if (ast.node !== "or") return;
    expect(ast.left).toMatchObject({ node: "compare", field: "a" });
    expect(ast.right).toMatchObject({ node: "and" });
  });

  it("binds NOT tighter than AND", () => {
    const ast = parseFilter("NOT a = '1' AND b = '2'");
    expect(ast.node).toBe("and");
    if (ast.node !== "and") return;
    expect(ast.left).toMatchObject({ node: "not" });
  });

  it("honors parentheses", () => {
    const ast = parseFilter("(a = '1' OR b = '2') AND c = '3'");
    expect(ast.node).toBe("and");
    if (ast.node !== "and") return;
    expect(ast.left).toMatchObject({ node: "or" });
  });

  it("parses a relative date interval", () => {
    const ast = parseFilter("due_date < now() - 7d");
    expect(ast).toMatchObject({
      node: "compare",
      field: "due_date",
      op: "<",
      value: { kind: "date", fn: "now", interval: { sign: "-", amount: 7, unit: "d" } },
    });
  });

  it("normalizes <> to !=", () => {
    const ast = parseFilter("status <> 'done'");
    expect(ast).toMatchObject({ node: "compare", op: "!=" });
  });
});

// --- Compiler: SQL + params ---

describe("compileFilter", () => {
  it("returns an empty predicate for a blank filter", () => {
    expect(compileFilter("")).toEqual({ where: "", params: [] });
    expect(compileFilter("   ")).toEqual({ where: "", params: [] });
  });

  it("compiles enum IN and priority ordinal", () => {
    const { where, params } = compileFilter(
      "status IN ('open', 'in_progress') AND priority >= 'high'"
    );
    expect(where).toBe(
      "(tickets.status IN (?, ?) AND (CASE tickets.priority WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'urgent' THEN 3 END) >= ?)"
    );
    expect(params).toEqual(["open", "in_progress", 2]);
  });

  it("normalizes enum values case-insensitively", () => {
    const { params } = compileFilter("status = 'OPEN'");
    expect(params).toEqual(["open"]);
  });

  it("compiles tag membership to EXISTS with a case-sensitive value", () => {
    const { where, params } = compileFilter("'UI' IN tags");
    expect(where).toBe("EXISTS (SELECT 1 FROM json_each(tickets.tags) WHERE value = ?)");
    expect(params).toEqual(["UI"]);
  });

  it("compiles negated tag membership", () => {
    const { where } = compileFilter("'x' NOT IN tags");
    expect(where).toBe("(NOT EXISTS (SELECT 1 FROM json_each(tickets.tags) WHERE value = ?))");
  });

  it("compiles metadata access with a bound json path", () => {
    const { where, params } = compileFilter("metadata.team = 'core'");
    expect(where).toBe("json_extract(tickets.metadata, ?) = ?");
    expect(params).toEqual(["$.team", "core"]);
  });

  it("resolves now()/today() to an ISO timestamp param", () => {
    const { params } = compileFilter("created_at > now() - 1h");
    expect(params).toHaveLength(1);
    expect(String(params[0])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("qualifies columns with a custom table alias", () => {
    const { where } = compileFilter("status = 'open'", { table: "t" });
    expect(where).toBe("t.status = ?");
  });

  it("compiles IS NOT NULL", () => {
    const { where } = compileFilter("assignee IS NOT NULL");
    expect(where).toBe("tickets.assignee IS NOT NULL");
  });
});

// --- Compiler: semantic errors ---

describe("compileFilter errors", () => {
  const cases: Array<[string, RegExp, { mode?: "local" | "http" }?]> = [
    ["bogus = '1'", /Unknown field "bogus"/],
    ["title = 'x'", /not filterable/],
    ["status > 'open'", /not supported on field "status"/],
    ["status = 'nope'", /Unknown status value "nope"/],
    ["assignee = 'me'", /not available in local mode/, { mode: "local" }],
    ["tags = 'ui'", /Use set membership for tags/],
    ["priority = 5", /expects a quoted string/],
  ];
  for (const [filter, pattern, opts] of cases) {
    it(`rejects: ${filter}`, () => {
      expect(() => compileFilter(filter, opts)).toThrow(QueryError);
      expect(() => compileFilter(filter, opts)).toThrow(pattern);
    });
  }

  it("reports an incomplete expression", () => {
    expect(() => compileFilter("status = ")).toThrow(/incomplete/);
  });
});

// --- End-to-end: the compiled SQL actually filters rows ---

describe("compileFilter execution", () => {
  let db: Database.Database;

  function insert(t: {
    id?: string;
    status?: string;
    type?: string;
    priority?: string;
    tags?: string[];
    assignee?: string | null;
    due_date?: string | null;
    metadata?: Record<string, unknown>;
  }): string {
    const id = t.id ?? ulid();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tickets (id, title, description, status, type, priority, tags, assignee, due_date, created_at, updated_at, metadata)
       VALUES (?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      t.status ?? "open",
      t.type ?? "chore",
      t.priority ?? "medium",
      JSON.stringify(t.tags ?? []),
      t.assignee ?? null,
      t.due_date ?? null,
      now,
      now,
      JSON.stringify(t.metadata ?? {})
    );
    return id;
  }

  function matchIds(filter: string): string[] {
    const { where, params } = compileFilter(filter);
    const sql = where ? `SELECT id FROM tickets WHERE ${where} ORDER BY id` : "SELECT id FROM tickets ORDER BY id";
    return (db.prepare(sql).all(...params) as Array<{ id: string }>).map((r) => r.id);
  }

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  it("filters by enum set and priority rank", () => {
    const a = insert({ id: "a", status: "open", priority: "urgent" });
    insert({ id: "b", status: "done", priority: "urgent" });
    const c = insert({ id: "c", status: "in_progress", priority: "high" });
    insert({ id: "d", status: "in_progress", priority: "low" });
    expect(matchIds("status IN ('open','in_progress') AND priority >= 'high'")).toEqual([a, c]);
  });

  it("filters by tag membership", () => {
    const a = insert({ id: "a", tags: ["ui", "bug"] });
    insert({ id: "b", tags: ["backend"] });
    expect(matchIds("'ui' IN tags")).toEqual([a]);
    expect(matchIds("'ui' NOT IN tags")).toEqual(["b"]);
  });

  it("filters by metadata scalar", () => {
    const a = insert({ id: "a", metadata: { team: "core", size: 5 } });
    insert({ id: "b", metadata: { team: "ops" } });
    expect(matchIds("metadata.team = 'core'")).toEqual([a]);
    expect(matchIds("metadata.size >= 5")).toEqual([a]);
    expect(matchIds("metadata.size IS NULL")).toEqual(["b"]);
  });

  it("filters by null assignee and OR grouping", () => {
    const a = insert({ id: "a", assignee: null, status: "open" });
    const b = insert({ id: "b", assignee: "kaan", status: "done" });
    insert({ id: "c", assignee: "kaan", status: "open" });
    expect(matchIds("assignee IS NULL OR status = 'done'").sort()).toEqual([a, b].sort());
  });

  it("filters by relative due date", () => {
    const past = new Date(Date.now() - 10 * 86400000).toISOString();
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    const a = insert({ id: "a", due_date: past });
    insert({ id: "b", due_date: future });
    insert({ id: "c", due_date: null });
    expect(matchIds("due_date < now()")).toEqual([a]);
  });
});
