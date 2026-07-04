import { parseFilter } from "./parser.js";
import { QueryError } from "./errors.js";
import {
  CATALOG,
  BLOCKED_FIELDS,
  TAGS_FIELD,
  METADATA_PREFIX,
  PRIORITY_VALUES,
  type FieldDef,
} from "./catalog.js";
import type { CompareOp, FilterExpr, Literal } from "./ast.js";

export interface CompileOptions {
  /** Local (stdio) mode hides multi-user fields like `assignee`. Defaults to http. */
  mode?: "local" | "http";
  /** Table name or alias to qualify columns against. Defaults to `tickets`. */
  table?: string;
}

export interface CompiledFilter {
  /** SQL boolean expression with no `WHERE` keyword; empty string if no filter. */
  where: string;
  params: unknown[];
}

const ORDER_OPS = new Set<CompareOp>(["<", "<=", ">", ">="]);
const UNIT_MS: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 604_800_000 };

const KNOWN_FIELDS = Object.keys(CATALOG).concat(TAGS_FIELD, `${METADATA_PREFIX}<key>`);

function resolveDateLiteral(lit: Literal): string {
  if (lit.kind === "string") return lit.value;
  if (lit.kind !== "date") {
    throw new QueryError("Expected a date value (an ISO string, or now()/today()).");
  }
  const base = new Date();
  if (lit.fn === "today") base.setUTCHours(0, 0, 0, 0);
  if (lit.interval) {
    const ms = lit.interval.amount * UNIT_MS[lit.interval.unit];
    base.setTime(base.getTime() + (lit.interval.sign === "-" ? -ms : ms));
  }
  return base.toISOString();
}

function normalizeEnum(field: string, value: string, values: readonly string[]): string {
  const lower = value.toLowerCase();
  if (!values.includes(lower)) {
    throw new QueryError(`Unknown ${field} value "${value}". Valid: ${values.join(", ")}.`);
  }
  return lower;
}

function expectString(field: string, lit: Literal): string {
  if (lit.kind !== "string") {
    throw new QueryError(`Field "${field}" expects a quoted string value.`);
  }
  return lit.value;
}

/**
 * Validate a filter AST against the field catalog for the given mode and
 * translate it to a parameterized SQL boolean expression. Throws
 * {@link QueryError} on any semantic problem (unknown field, illegal operator
 * for a field's type, unknown enum value, mode-restricted field).
 */
export function compileFilter(
  input: string | FilterExpr,
  opts: CompileOptions = {}
): CompiledFilter {
  const table = opts.table ?? "tickets";
  const mode = opts.mode ?? "http";

  if (typeof input === "string" && input.trim() === "") {
    return { where: "", params: [] };
  }
  const ast = typeof input === "string" ? parseFilter(input) : input;
  const params: unknown[] = [];

  const col = (c: string) => `${table}.${c}`;

  // Resolve a field reference to either a catalog entry or a metadata path.
  function resolveField(
    field: string
  ): { def: FieldDef } | { metadataPath: string } {
    if (BLOCKED_FIELDS.has(field)) {
      throw new QueryError(
        `Field "${field}" is not filterable. Use search (the query/mode parameters) for text matching.`
      );
    }
    if (field === TAGS_FIELD) {
      throw new QueryError(`Use set membership for tags, e.g. 'value' IN tags.`);
    }
    if (field.startsWith(METADATA_PREFIX)) {
      const key = field.slice(METADATA_PREFIX.length);
      if (key === "") throw new QueryError(`Missing metadata key after "metadata.".`);
      return { metadataPath: `$.${key}` };
    }
    const def = CATALOG[field];
    if (!def) {
      throw new QueryError(`Unknown field "${field}". Filterable fields: ${KNOWN_FIELDS.join(", ")}.`);
    }
    if (def.localAvailable === false && mode === "local") {
      throw new QueryError(`Field "${field}" is not available in local mode.`);
    }
    return { def };
  }

  // `field OP value` for a plain (non-metadata) catalog field.
  function compileCatalogCompare(def: FieldDef, field: string, op: CompareOp, value: Literal): string {
    const ordered = ORDER_OPS.has(op);

    switch (def.kind) {
      case "id":
      case "text": {
        if (ordered) {
          throw new QueryError(`Operator "${op}" is not supported on field "${field}" (only =, !=, IN).`);
        }
        params.push(expectString(field, value));
        return `${col(def.column)} ${op} ?`;
      }
      case "enum": {
        if (ordered) {
          throw new QueryError(`Operator "${op}" is not supported on field "${field}" (only =, !=, IN).`);
        }
        params.push(normalizeEnum(field, expectString(field, value), def.values!));
        return `${col(def.column)} ${op} ?`;
      }
      case "priority": {
        const canonical = normalizeEnum(field, expectString(field, value), def.values!);
        if (ordered) {
          params.push((PRIORITY_VALUES as readonly string[]).indexOf(canonical));
          return `${priorityRank(def.column)} ${op} ?`;
        }
        params.push(canonical);
        return `${col(def.column)} ${op} ?`;
      }
      case "date": {
        params.push(resolveDateLiteral(value));
        return `${col(def.column)} ${op} ?`;
      }
    }
  }

  function priorityRank(column: string): string {
    const cases = PRIORITY_VALUES.map((v, i) => `WHEN '${v}' THEN ${i}`).join(" ");
    return `(CASE ${col(column)} ${cases} END)`;
  }

  // A scalar value used inside metadata comparisons / IN lists.
  function metadataValue(lit: Literal): string | number {
    if (lit.kind === "string") return lit.value;
    if (lit.kind === "number") return lit.value;
    throw new QueryError("Metadata comparisons accept only string or number values.");
  }

  function compileNode(node: FilterExpr): string {
    switch (node.node) {
      case "and":
        return `(${compileNode(node.left)} AND ${compileNode(node.right)})`;
      case "or":
        return `(${compileNode(node.left)} OR ${compileNode(node.right)})`;
      case "not":
        return `(NOT ${compileNode(node.expr)})`;

      case "compare": {
        const resolved = resolveField(node.field);
        if ("metadataPath" in resolved) {
          params.push(resolved.metadataPath, metadataValue(node.value));
          return `json_extract(${col("metadata")}, ?) ${node.op} ?`;
        }
        return compileCatalogCompare(resolved.def, node.field, node.op, node.value);
      }

      case "in": {
        const resolved = resolveField(node.field);
        const keyword = node.negated ? "NOT IN" : "IN";
        if ("metadataPath" in resolved) {
          params.push(resolved.metadataPath);
          const placeholders = node.values.map((v) => {
            params.push(metadataValue(v));
            return "?";
          });
          return `json_extract(${col("metadata")}, ?) ${keyword} (${placeholders.join(", ")})`;
        }
        const def = resolved.def;
        const placeholders = node.values.map((v) => {
          params.push(inValue(def, node.field, v));
          return "?";
        });
        return `${col(def.column)} ${keyword} (${placeholders.join(", ")})`;
      }

      case "null": {
        const resolved = resolveField(node.field);
        const keyword = node.negated ? "IS NOT NULL" : "IS NULL";
        if ("metadataPath" in resolved) {
          params.push(resolved.metadataPath);
          return `json_extract(${col("metadata")}, ?) ${keyword}`;
        }
        return `${col(resolved.def.column)} ${keyword}`;
      }

      case "member": {
        if (node.field !== TAGS_FIELD) {
          throw new QueryError(
            `Set membership is only supported on tags (e.g. 'ui' IN tags), not "${node.field}".`
          );
        }
        if (node.tag.kind !== "string") {
          throw new QueryError("Tag membership expects a quoted tag name.");
        }
        params.push(node.tag.value);
        const exists = `EXISTS (SELECT 1 FROM json_each(${col("tags")}) WHERE value = ?)`;
        return node.negated ? `(NOT ${exists})` : exists;
      }
    }
  }

  // Normalize one element of an IN list to its stored form.
  function inValue(def: FieldDef, field: string, lit: Literal): unknown {
    switch (def.kind) {
      case "enum":
      case "priority":
        return normalizeEnum(field, expectString(field, lit), def.values!);
      case "date":
        return resolveDateLiteral(lit);
      default:
        return expectString(field, lit);
    }
  }

  return { where: compileNode(ast), params };
}
