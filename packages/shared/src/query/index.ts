/**
 * The ticket filter language: a pure boolean predicate over ticket fields,
 * used as the single filter surface for listing and searching tickets.
 *
 * `parseFilter` turns a string into an AST (pure, mode-agnostic).
 * `compileFilter` validates that AST against the field catalog for a given
 * mode and translates it into a parameterized SQL boolean expression.
 */
export { parseFilter } from "./parser.js";
export { compileFilter, type CompileOptions, type CompiledFilter } from "./compile.js";
export { QueryError } from "./errors.js";
export { CATALOG, PRIORITY_VALUES, STATUS_VALUES, TYPE_VALUES } from "./catalog.js";
export type {
  FilterExpr,
  CompareOp,
  Literal,
  Interval,
} from "./ast.js";
