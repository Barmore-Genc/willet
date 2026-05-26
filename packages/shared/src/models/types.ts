import { z } from "zod";

// --- Enums ---

export const StatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);
export type Status = z.infer<typeof StatusSchema>;

export const TicketTypeSchema = z.enum(["chore", "bug", "feature", "epic"]);
export type TicketType = z.infer<typeof TicketTypeSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const LinkTypeSchema = z.enum(["blocks", "relates_to", "duplicates"]);
export type LinkType = z.infer<typeof LinkTypeSchema>;

export const SearchModeSchema = z.enum(["text", "semantic", "hybrid"]);
export type SearchMode = z.infer<typeof SearchModeSchema>;

export const SortFieldSchema = z.enum([
  "created_at",
  "updated_at",
  "priority",
  "status",
  "title",
  "type",
  "due_date",
]);
export type SortField = z.infer<typeof SortFieldSchema>;

export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

export const GroupBySchema = z.enum(["status", "priority", "type"]);
export type GroupBy = z.infer<typeof GroupBySchema>;

export const VerbositySchema = z.enum(["short", "detailed", "full"]);
export type Verbosity = z.infer<typeof VerbositySchema>;

// --- Helper: accept single value or array ---

function stringOrArray<T extends z.ZodType<string>>(schema: T) {
  return z.union([schema, z.array(schema)]);
}

// --- Entity types ---

export interface Project {
  id: string;
  name: string;
  directory: string;
  created_at: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: Status;
  type: TicketType;
  priority: Priority;
  estimate: string | null;
  actual: string | null;
  tags: string[];
  parent_ticket_id: string | null;
  assignee: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface TicketHistory {
  id: string;
  ticket_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by: string;
}

export interface TicketLink {
  id: string;
  source_ticket_id: string;
  target_ticket_id: string;
  link_type: LinkType;
  created_at: string;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  content: string;
  created_at: string;
  created_by: string;
}

// --- Tool input schemas ---

export const InitProjectInputSchema = z.object({
  name: z.string().min(1),
});

export const ListProjectsInputSchema = z.object({
  name: z.string().optional(),
});

export const TicketLinkInputSchema = z.object({
  target_ticket_id: z.string(),
  link_type: LinkTypeSchema,
});

export const CreateTicketInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: StatusSchema.optional(),
  type: TicketTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  estimate: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parent_ticket_id: z.string().optional(),
  assignee: z.string().optional(),
  due_date: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  links: z.array(TicketLinkInputSchema).optional(),
  initial_comment: z.string().optional(),
});

export const UpdateTicketInputSchema = z.object({
  ticket_id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: TicketTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  estimate: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  parent_ticket_id: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const GetTicketInputSchema = z.object({
  ticket_id: z.string(),
  include_history: z.boolean().optional(),
  include_subtickets: z.boolean().optional(),
  verbosity: VerbositySchema.optional(),
});

export const DeleteTicketInputSchema = z.object({
  ticket_id: z.string(),
});

export const StartTicketInputSchema = z.object({
  ticket_id: z.string(),
});

export const CompleteTicketInputSchema = z.object({
  ticket_id: z.string(),
  actual: z.string().optional(),
});

export const CancelTicketInputSchema = z.object({
  ticket_id: z.string(),
});

export const ReopenTicketInputSchema = z.object({
  ticket_id: z.string(),
});

export const AddCommentInputSchema = z.object({
  ticket_id: z.string(),
  content: z.string().min(1),
});

export const LinkTicketsInputSchema = z.object({
  source_ticket_id: z.string(),
  target_ticket_id: z.string(),
  link_type: LinkTypeSchema,
});

export const UnlinkTicketsInputSchema = z.object({
  source_ticket_id: z.string(),
  target_ticket_id: z.string(),
  link_type: LinkTypeSchema,
});

export const ListTicketsInputSchema = z.object({
  status: stringOrArray(StatusSchema).optional(),
  type: stringOrArray(TicketTypeSchema).optional(),
  priority: stringOrArray(PrioritySchema).optional(),
  tags: z.array(z.string()).optional(),
  parent_ticket_id: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  completed_after: z.string().optional(),
  completed_before: z.string().optional(),
  due_after: z.string().optional(),
  due_before: z.string().optional(),
  sort: SortFieldSchema.optional(),
  sort_direction: SortDirectionSchema.optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  verbosity: VerbositySchema.optional(),
});

export const SearchTicketsInputSchema = z.object({
  query: z.string().min(1),
  mode: SearchModeSchema.optional(),
  status: stringOrArray(StatusSchema).optional(),
  type: stringOrArray(TicketTypeSchema).optional(),
  priority: stringOrArray(PrioritySchema).optional(),
  limit: z.number().int().positive().optional(),
  verbosity: VerbositySchema.optional(),
});

export const GetTicketGraphInputSchema = z.object({
  ticket_id: z.string(),
  depth: z.number().int().min(1).max(5).optional(),
  verbosity: VerbositySchema.optional(),
});

export const RenderTicketBoardInputSchema = z.object({
  group_by: GroupBySchema.optional(),
  status: stringOrArray(StatusSchema).optional(),
  type: stringOrArray(TicketTypeSchema).optional(),
  priority: stringOrArray(PrioritySchema).optional(),
  tags: z.array(z.string()).optional(),
});

export const GetProjectStatsInputSchema = z.object({});

export const ListTagsInputSchema = z.object({});

export const RenderDependencyGraphInputSchema = z.object({
  ticket_id: z.string(),
  depth: z.number().int().min(1).max(5).optional(),
});

// --- Mode-aware tool options ---

export interface ToolOptions {
  mode: "local" | "selfhosted";
  validAssignees?: string[];
}

/** Strip assignee from a ticket object (local mode only) */
export function formatTicket(ticket: Ticket, options: ToolOptions): Omit<Ticket, "assignee"> | Ticket {
  if (options.mode === "local") {
    const { assignee, ...rest } = ticket;
    return rest;
  }
  return ticket;
}

/** Strip assignee from an array of tickets (local mode only) */
export function formatTickets(tickets: Ticket[], options: ToolOptions): Array<Omit<Ticket, "assignee"> | Ticket> {
  if (options.mode === "local") {
    return tickets.map(({ assignee, ...rest }) => rest);
  }
  return tickets;
}

// --- Verbosity projection ---
//
// Ticket-reading tools return large payloads when a caller only needs an at-a-glance list.
// `projectTicket` trims the serialized shape based on a verbosity mode:
//
//   short    — id, title (truncated), status, type, priority, estimate, assignee, tags
//              (truncated), due_date. For triage scans.
//   detailed — all fields, description truncated.
//   full     — the full Ticket, no truncation.
//
// Local mode still strips the `assignee` field in every mode, matching `formatTicket`.

const SHORT_TITLE_MAX = 80;
const SHORT_TAGS_MAX = 5;
const DETAILED_DESCRIPTION_MAX = 200;

function truncateString(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function shortTitle(title: string): string {
  const firstLine = title.split("\n", 1)[0];
  const hasMoreLines = firstLine.length < title.length;
  if (firstLine.length > SHORT_TITLE_MAX) {
    return firstLine.slice(0, SHORT_TITLE_MAX - 1) + "…";
  }
  return hasMoreLines ? firstLine + "…" : firstLine;
}

// Tags are an array of strings. When truncated, we append a sentinel element
// like "+3 more" so the shape stays `string[]` and the agent sees the count.
function shortTags(tags: string[]): string[] {
  if (tags.length <= SHORT_TAGS_MAX) return tags;
  const remaining = tags.length - SHORT_TAGS_MAX;
  return [...tags.slice(0, SHORT_TAGS_MAX), `+${remaining} more`];
}

export type TicketProjection = Record<string, unknown>;

/** Project a ticket for serialization under the given verbosity mode. */
export function projectTicket(ticket: Ticket, verbosity: Verbosity, options: ToolOptions): TicketProjection {
  if (verbosity === "full") {
    return formatTicket(ticket, options) as TicketProjection;
  }
  if (verbosity === "short") {
    const out: TicketProjection = {
      id: ticket.id,
      title: shortTitle(ticket.title),
      status: ticket.status,
      type: ticket.type,
      priority: ticket.priority,
      estimate: ticket.estimate,
      tags: shortTags(ticket.tags),
      due_date: ticket.due_date,
    };
    if (options.mode !== "local") {
      out.assignee = ticket.assignee;
    }
    return out;
  }
  // detailed: full shape, description truncated
  const formatted = formatTicket(ticket, options) as TicketProjection;
  return {
    ...formatted,
    description: truncateString(ticket.description, DETAILED_DESCRIPTION_MAX),
  };
}

/** Project an array of tickets. Preserves an extra `score` field if present (search results). */
export function projectTickets<T extends Ticket>(
  tickets: T[],
  verbosity: Verbosity,
  options: ToolOptions,
): TicketProjection[] {
  return tickets.map((t) => {
    const projected = projectTicket(t, verbosity, options);
    if ("score" in t) {
      return { ...projected, score: (t as T & { score: number }).score };
    }
    return projected;
  });
}

/** Validate assignee against the config user list (self-hosted only). Throws on invalid. */
export function validateAssignee(assignee: string | null | undefined, options: ToolOptions): void {
  if (options.mode === "selfhosted" && options.validAssignees && assignee != null) {
    if (!options.validAssignees.includes(assignee)) {
      throw new Error(
        `Invalid assignee "${assignee}". Valid users: ${options.validAssignees.join(", ")}`
      );
    }
  }
}

// --- Project-scoped schema helper ---

/** Adds optional project_id to any tool input schema */
export function withProjectId<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.extend({
    project_id: z.string().optional(),
  });
}
