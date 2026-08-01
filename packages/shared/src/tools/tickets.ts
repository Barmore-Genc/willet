import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateTicketInputSchema,
  UpdateTicketInputSchema,
  GetTicketInputSchema,
  DeleteTicketInputSchema,
  SetTicketStatusInputSchema,
  withProjectId,
  formatTicket,
  projectTicket,
  projectTickets,
  validateAssignee,
  type ToolOptions,
  type Verbosity,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  createTicket,
  updateTicket,
  getTicketById,
  deleteTicket,
  setTicketStatus,
  getComments,
  getHistory,
  getLinks,
  listTickets,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

export function registerTicketTools(server: McpServer, options: ToolOptions): void {
  // Build mode-aware schemas for create and update
  const createSchema =
    options.mode === "local"
      ? withProjectId(CreateTicketInputSchema.omit({ assignee: true }))
      : withProjectId(CreateTicketInputSchema.extend({ assignee: z.string().min(1) }));

  const updateSchema =
    options.mode === "local"
      ? withProjectId(UpdateTicketInputSchema.omit({ assignee: true }))
      : withProjectId(UpdateTicketInputSchema);

  server.tool(
    "create_ticket",
    "Create a new ticket with optional links and initial_comment",
    createSchema.shape,
    async ({ project_id, ...input }) => {
      if (options.mode === "selfhosted") {
        validateAssignee((input as { assignee?: string }).assignee, options);
      }
      const db = resolveDb(project_id);
      const ticket = await createTicket(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(formatTicket(ticket, options), null, 2) }],
      };
    }
  );

  server.tool(
    "update_ticket",
    "Update an existing ticket's fields",
    updateSchema.shape,
    async ({ project_id, ...input }) => {
      if (options.mode === "selfhosted") {
        validateAssignee((input as { assignee?: string | null }).assignee, options);
      }
      const db = resolveDb(project_id);
      const ticket = await updateTicket(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(formatTicket(ticket, options), null, 2) }],
      };
    }
  );

  server.tool(
    "get_ticket",
    "Get a ticket by ID with its comments and links. History and subtickets are opt-in. `verbosity` controls output: 'short', 'detailed', or 'full' (default).",
    withProjectId(GetTicketInputSchema).shape,
    async ({ project_id, ticket_id, include_history, include_subtickets, verbosity }) => {
      const db = resolveDb(project_id);
      const ticket = getTicketById(db, ticket_id);
      if (!ticket) throw new Error(`Ticket not found: ${ticket_id}`);

      const v: Verbosity = verbosity ?? "full";
      const result: Record<string, unknown> = { ...projectTicket(ticket, v, options) };
      result.comments = getComments(db, ticket_id);
      if (include_history) result.history = getHistory(db, ticket_id);
      result.links = getLinks(db, ticket_id);
      if (include_subtickets) {
        const { tickets: subtickets } = listTickets(db, {
          filter: {
            node: "compare",
            field: "parent_ticket_id",
            op: "=",
            value: { kind: "string", value: ticket_id },
          },
        });
        result.subtickets = projectTickets(subtickets, v, options);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_ticket",
    "Delete a ticket and all its related data",
    withProjectId(DeleteTicketInputSchema).shape,
    async ({ project_id, ticket_id }) => {
      const db = resolveDb(project_id);
      deleteTicket(db, ticket_id);
      return {
        content: [{ type: "text", text: `Ticket ${ticket_id} deleted.` }],
      };
    }
  );

  server.tool(
    "set_ticket_status",
    "Move a ticket through its lifecycle. 'in_progress' starts work, 'done' completes it (pass `actual` to record time spent), 'cancelled' drops it, and 'open' reopens a ticket that is done, cancelled, or in progress.",
    withProjectId(SetTicketStatusInputSchema).shape,
    async ({ project_id, ticket_id, status, actual }) => {
      const db = resolveDb(project_id);
      const ticket = await setTicketStatus(db, ticket_id, status, actual);
      return {
        content: [{ type: "text", text: JSON.stringify(formatTicket(ticket, options), null, 2) }],
      };
    }
  );
}
