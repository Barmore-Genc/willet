/**
 * The set of ticket fields the filter language can reference, and how each one
 * behaves. This is the OSS catalog — it covers the columns that exist on the
 * per-project SQLite `tickets` table. Cloud-only concepts (human-readable keys
 * / numbers) are not here; the cloud layer resolves those to `id` before the
 * expression reaches the compiler.
 */

export type FieldKind =
  // ULID text: equality + IN + null. No ordering.
  | "id"
  // Closed enum stored as text: equality + IN + null, values normalized
  // case-insensitively against `values`.
  | "enum"
  // Priority: a closed enum with a severity order, so it also supports
  // <, <=, >, >= by rank.
  | "priority"
  // Freeform text (assignee, estimate, actual): equality + IN + null.
  | "text"
  // ISO-8601 timestamp text: full comparison against date literals / now()/today().
  | "date";

export interface FieldDef {
  column: string;
  kind: FieldKind;
  /** Canonical (lowercase) members for enum / priority. */
  values?: readonly string[];
  /** When false, the field is rejected in local (stdio) mode. */
  localAvailable?: boolean;
}

export const STATUS_VALUES = ["open", "in_progress", "done", "cancelled"] as const;
export const TYPE_VALUES = ["chore", "bug", "feature", "epic"] as const;
// Ordered low → urgent; the index is the severity rank used for comparisons.
export const PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;

export const CATALOG: Record<string, FieldDef> = {
  id: { column: "id", kind: "id" },
  status: { column: "status", kind: "enum", values: STATUS_VALUES },
  type: { column: "type", kind: "enum", values: TYPE_VALUES },
  priority: { column: "priority", kind: "priority", values: PRIORITY_VALUES },
  parent_ticket_id: { column: "parent_ticket_id", kind: "id" },
  assignee: { column: "assignee", kind: "text", localAvailable: false },
  estimate: { column: "estimate", kind: "text" },
  actual: { column: "actual", kind: "text" },
  created_at: { column: "created_at", kind: "date" },
  updated_at: { column: "updated_at", kind: "date" },
  completed_at: { column: "completed_at", kind: "date" },
  due_date: { column: "due_date", kind: "date" },
};

/** Free-text fields that are deliberately not filterable — point at search. */
export const BLOCKED_FIELDS = new Set(["title", "description"]);

/** The one set-membership field: `'x' IN tags`. */
export const TAGS_FIELD = "tags";

/** Prefix for JSON metadata references: `metadata.<key>`. */
export const METADATA_PREFIX = "metadata.";
