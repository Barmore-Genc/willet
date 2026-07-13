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

// --- Robustness: SQL-injection-style payloads stay data, never SQL ---
//
// The compiler's defense is that every user-supplied value (strings, numbers,
// dates, tag names, metadata values, and the metadata JSON path) is bound as a
// `?` parameter; only fixed catalog column names and the developer-supplied
// table alias are ever interpolated into the SQL text. These tests assert that
// invariant holds against classic injection payloads: the compiled `where`
// contains no fragment of the payload, and executing it against real SQLite
// neither errors, drops the table, nor matches rows it shouldn't.

describe("compileFilter injection robustness", () => {
  // Payloads that, if interpolated, would break out of a string literal or
  // change the statement. All are used as *values*, where they must be inert.
  const PAYLOADS = [
    "'; DROP TABLE tickets; --",
    "' OR '1'='1",
    "' OR 1=1 --",
    "x'); DELETE FROM tickets; --",
    "admin'--",
    "1; DELETE FROM tickets",
    "%' OR tags LIKE '%",
    "/* comment */",
    "  null byte",
    "back\\slash",
    "'||(SELECT id FROM tickets)||'",
  ];

  it("binds every payload as a parameter and never interpolates it", () => {
    for (const p of PAYLOADS) {
      // A single-quoted string literal doubles embedded quotes.
      const literal = `'${p.replace(/'/g, "''")}'`;
      const { where, params } = compileFilter(`assignee = ${literal}`);
      // Structure is a bare parameterized comparison.
      expect(where).toBe("tickets.assignee = ?");
      // The payload rides entirely in params, verbatim.
      expect(params).toEqual([p]);
      // No fragment of the payload leaked into the SQL text.
      for (const marker of ["DROP", "DELETE", "--", ";", "OR", "/*"]) {
        expect(where).not.toContain(marker);
      }
    }
  });

  it("does not let quote-doubling break out of a string literal", () => {
    // Decodes to the single literal:  open' OR '1'='1
    const { where, params } = compileFilter("assignee = 'open'' OR ''1''=''1'");
    expect(where).toBe("tickets.assignee = ?");
    expect(params).toEqual(["open' OR '1'='1"]);
  });

  it("binds payloads in tag membership and metadata comparisons too", () => {
    // Value decodes to:  '; DROP TABLE tickets; --  (leading quote doubled)
    const tag = compileFilter("'''; DROP TABLE tickets; --' IN tags");
    expect(tag.where).toBe("EXISTS (SELECT 1 FROM json_each(tickets.tags) WHERE value = ?)");
    expect(tag.params).toEqual(["'; DROP TABLE tickets; --"]);

    const meta = compileFilter("metadata.team = ''' OR 1=1 --'");
    expect(meta.where).toBe("json_extract(tickets.metadata, ?) = ?");
    expect(meta.params).toEqual(["$.team", "' OR 1=1 --"]);
  });

  it("rejects malformed / adversarial syntax as a QueryError, never a crash", () => {
    const malformed = [
      "assignee = 'open", // unterminated string
      "assignee = 'open';", // trailing statement terminator
      "assignee = 'open'; DROP TABLE tickets", // stacked statement
      "; DROP TABLE tickets", // bare terminator
      "assignee = ", // missing value
      "((((status = 'open')", // unbalanced parens
    ];
    for (const f of malformed) {
      expect(() => compileFilter(f), f).toThrow(QueryError);
    }
  });

  it("treats a backslash as an ordinary character, not an escape", () => {
    // `\` does not escape the closing quote — the string closes normally and
    // the backslash rides along as literal data.
    const { where, params } = compileFilter("assignee = 'a\\'");
    expect(where).toBe("tickets.assignee = ?");
    expect(params).toEqual(["a\\"]);
  });

  describe("against real SQLite", () => {
    let db: Database.Database;

    function count(): number {
      return (db.prepare("SELECT count(*) AS n FROM tickets").get() as { n: number }).n;
    }

    beforeEach(() => {
      db = new Database(":memory:");
      applySchema(db);
      const now = new Date().toISOString();
      // A canary row that must survive and never be matched by a payload.
      db.prepare(
        `INSERT INTO tickets (id, title, description, status, type, priority, tags, assignee, created_at, updated_at, metadata)
         VALUES ('canary', '', '', 'open', 'chore', 'medium', '[]', 'realuser', ?, ?, '{}')`
      ).run(now, now);
    });

    it("treats payloads as literals: table survives, no rows match", () => {
      for (const p of PAYLOADS) {
        const literal = `'${p.replace(/'/g, "''")}'`;
        const { where, params } = compileFilter(`assignee = ${literal}`);
        // The statement is single, well-formed SQL; better-sqlite3 rejects
        // multi-statement text at prepare time, so this both compiles and runs.
        const rows = db.prepare(`SELECT id FROM tickets WHERE ${where}`).all(...params);
        expect(rows).toEqual([]); // no assignee equals the payload string
      }
      // Table and its one row are untouched by any payload.
      expect(count()).toBe(1);
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'").get()
      ).toBeTruthy();
    });

    it("matches a value that literally equals an injection-looking string", () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO tickets (id, title, description, status, type, priority, tags, assignee, created_at, updated_at, metadata)
         VALUES ('evil', '', '', 'open', 'chore', 'medium', '[]', ?, ?, ?, '{}')`
      ).run("' OR '1'='1", now, now);
      const { where, params } = compileFilter("assignee = ''' OR ''1''=''1'");
      const ids = (db.prepare(`SELECT id FROM tickets WHERE ${where}`).all(...params) as Array<{ id: string }>).map(
        (r) => r.id
      );
      // Exactly the row whose assignee IS that literal string — not the canary.
      expect(ids).toEqual(["evil"]);
    });
  });
});
