import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddCommentInputSchema,
  LinkTasksInputSchema,
  UnlinkTasksInputSchema,
  withProjectId,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  addComment,
  linkTasks,
  unlinkTasks,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

export function registerLinkTools(server: McpServer): void {
  server.tool(
    "add_comment",
    "Add a comment to a task",
    withProjectId(AddCommentInputSchema).shape,
    async ({ project_id, task_id, content }) => {
      const db = resolveDb(project_id);
      const comment = addComment(db, task_id, content);
      return {
        content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
      };
    }
  );

  server.tool(
    "link_tasks",
    "Create a link between two tasks (blocks, relates_to, or duplicates)",
    withProjectId(LinkTasksInputSchema).shape,
    async ({ project_id, source_task_id, target_task_id, link_type }) => {
      const db = resolveDb(project_id);
      const link = linkTasks(db, source_task_id, target_task_id, link_type);
      return {
        content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
      };
    }
  );

  server.tool(
    "unlink_tasks",
    "Remove a link between two tasks",
    withProjectId(UnlinkTasksInputSchema).shape,
    async ({ project_id, source_task_id, target_task_id, link_type }) => {
      const db = resolveDb(project_id);
      unlinkTasks(db, source_task_id, target_task_id, link_type);
      return {
        content: [{ type: "text", text: "Link removed." }],
      };
    }
  );
}
