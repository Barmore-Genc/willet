/**
 * Abstract syntax tree for the ticket filter language.
 *
 * The AST is a pure boolean predicate — no projection, ordering, or limits.
 * It is produced by {@link ./parser.parseFilter} and knows nothing about
 * which fields exist, SQL, or the caller's mode; that lives in the compiler
 * ({@link ./compile.compileFilter}), which validates and translates the tree.
 */

export type CompareOp = "=" | "!=" | "<" | "<=" | ">" | ">=";

/** Relative offset applied to `now()` / `today()`, e.g. `- 7d`. */
export interface Interval {
  sign: "+" | "-";
  amount: number;
  unit: "h" | "d" | "w";
}

/** A literal value on the right-hand side of a comparison. */
export type Literal =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; fn: "now" | "today"; interval: Interval | null };

export type FilterExpr =
  | { node: "and"; left: FilterExpr; right: FilterExpr }
  | { node: "or"; left: FilterExpr; right: FilterExpr }
  | { node: "not"; expr: FilterExpr }
  /** `field OP value` */
  | { node: "compare"; field: string; op: CompareOp; value: Literal }
  /** `field [NOT] IN (v1, v2, ...)` */
  | { node: "in"; field: string; negated: boolean; values: Literal[] }
  /** `field IS [NOT] NULL` */
  | { node: "null"; field: string; negated: boolean }
  /** `'tag' [NOT] IN field` — set membership, currently only `tags` */
  | { node: "member"; tag: Literal; negated: boolean; field: string };
