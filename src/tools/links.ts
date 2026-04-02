import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddCommentInputSchema,
  LinkTasksInputSchema,
  UnlinkTasksInputSchema,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  addComment,
  linkTasks,
  unlinkTasks,
} from "../db/queries.js";

function resolveDb() {
  const project = getProject(process.cwd());
  return getProjectDb(project.id);
}

export function registerLinkTools(server: McpServer): void {
  server.tool(
    "add_comment",
    "Add a comment to a task",
    AddCommentInputSchema.shape,
    async ({ task_id, content }) => {
      const db = resolveDb();
      const comment = addComment(db, task_id, content);
      return {
        content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
      };
    }
  );

  server.tool(
    "link_tasks",
    "Create a link between two tasks (blocks, relates_to, or duplicates)",
    LinkTasksInputSchema.shape,
    async ({ source_task_id, target_task_id, link_type }) => {
      const db = resolveDb();
      const link = linkTasks(db, source_task_id, target_task_id, link_type);
      return {
        content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
      };
    }
  );

  server.tool(
    "unlink_tasks",
    "Remove a link between two tasks",
    UnlinkTasksInputSchema.shape,
    async ({ source_task_id, target_task_id, link_type }) => {
      const db = resolveDb();
      unlinkTasks(db, source_task_id, target_task_id, link_type);
      return {
        content: [{ type: "text", text: "Link removed." }],
      };
    }
  );
}
