import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateTicketInputSchema,
  UpdateTicketInputSchema,
  GetTicketInputSchema,
  DeleteTicketInputSchema,
  StartTicketInputSchema,
  CompleteTicketInputSchema,
  CancelTicketInputSchema,
  ReopenTicketInputSchema,
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
  startTicket,
  completeTicket,
  cancelTicket,
  reopenTicket,
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
        const { tickets: subtickets } = listTickets(db, { parent_ticket_id: ticket_id });
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
    "start_ticket",
    "Set a ticket's status to in_progress",
    withProjectId(StartTicketInputSchema).shape,
    async ({ project_id, ticket_id }) => {
      const db = resolveDb(project_id);
      const ticket = await startTicket(db, ticket_id);
      return {
        content: [{ type: "text", text: JSON.stringify(formatTicket(ticket, options), null, 2) }],
      };
    }
  );

  server.tool(
    "complete_ticket",
    "Mark a ticket as done",
    withProjectId(CompleteTicketInputSchema).shape,
    async ({ project_id, ticket_id, actual }) => {
      const db = resolveDb(project_id);
      const ticket = await completeTicket(db, ticket_id, actual);
      return {
        content: [{ type: "text", text: JSON.stringify(formatTicket(ticket, options), null, 2) }],
      };
    }
  );

  server.tool(
    "cancel_ticket",
    "Cancel a ticket",
    withProjectId(CancelTicketInputSchema).shape,
    async ({ project_id, ticket_id }) => {
      const db = resolveDb(project_id);
      const ticket = await cancelTicket(db, ticket_id);
      return {
        content: [{ type: "text", text: JSON.stringify(formatTicket(ticket, options), null, 2) }],
      };
    }
  );

  server.tool(
    "reopen_ticket",
    "Move a ticket back to the open queue. Accepts tickets that are done, cancelled, or in_progress",
    withProjectId(ReopenTicketInputSchema).shape,
    async ({ project_id, ticket_id }) => {
      const db = resolveDb(project_id);
      const ticket = await reopenTicket(db, ticket_id);
      return {
        content: [{ type: "text", text: JSON.stringify(formatTicket(ticket, options), null, 2) }],
      };
    }
  );
}
