import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddCommentInputSchema,
  LinkTicketsInputSchema,
  UnlinkTicketsInputSchema,
  withProjectId,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  addComment,
  linkTickets,
  unlinkTickets,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

export function registerLinkTools(server: McpServer): void {
  server.tool(
    "add_comment",
    "Add a comment to a ticket",
    withProjectId(AddCommentInputSchema).shape,
    async ({ project_id, ticket_id, content }) => {
      const db = resolveDb(project_id);
      const comment = await addComment(db, ticket_id, content);
      return {
        content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
      };
    }
  );

  server.tool(
    "link_tickets",
    "Create a link between two tickets (blocks, relates_to, or duplicates)",
    withProjectId(LinkTicketsInputSchema).shape,
    async ({ project_id, source_ticket_id, target_ticket_id, link_type }) => {
      const db = resolveDb(project_id);
      const link = linkTickets(db, source_ticket_id, target_ticket_id, link_type);
      return {
        content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
      };
    }
  );

  server.tool(
    "unlink_tickets",
    "Remove a link between two tickets",
    withProjectId(UnlinkTicketsInputSchema).shape,
    async ({ project_id, source_ticket_id, target_ticket_id, link_type }) => {
      const db = resolveDb(project_id);
      unlinkTickets(db, source_ticket_id, target_ticket_id, link_type);
      return {
        content: [{ type: "text", text: "Link removed." }],
      };
    }
  );
}
