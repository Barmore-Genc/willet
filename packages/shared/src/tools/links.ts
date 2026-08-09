import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddCommentInputSchema,
  LinkTicketsInputSchema,
  withProjectId,
} from "../models/types.js";
import { getProject, getProjectDb, addComment, applyTicketLinks } from "../db/queries.js";

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
    "Create or remove links between tickets (blocks, relates_to, or duplicates). Takes a list, so express a whole dependency graph in one call rather than one link at a time.",
    withProjectId(LinkTicketsInputSchema).shape,
    async ({ project_id, operation, links }) => {
      const db = resolveDb(project_id);
      const removing = operation === "remove";
      const applied = applyTicketLinks(db, links, removing);
      return {
        content: [
          {
            type: "text",
            text: removing
              ? `${links.length} link(s) removed.`
              : JSON.stringify(applied, null, 2),
          },
        ],
      };
    }
  );
}
