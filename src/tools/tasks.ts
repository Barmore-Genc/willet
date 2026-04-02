import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  GetTaskInputSchema,
  DeleteTaskInputSchema,
  StartTaskInputSchema,
  CompleteTaskInputSchema,
  CancelTaskInputSchema,
  ReopenTaskInputSchema,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  createTask,
  updateTask,
  getTaskById,
  deleteTask,
  startTask,
  completeTask,
  cancelTask,
  reopenTask,
  getComments,
  getHistory,
  getLinks,
} from "../db/queries.js";

function resolveDb() {
  const project = getProject(process.cwd());
  return getProjectDb(project.id);
}

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "create_task",
    "Create a new task",
    CreateTaskInputSchema.shape,
    async (input) => {
      const db = resolveDb();
      const task = await createTask(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "update_task",
    "Update an existing task's fields",
    UpdateTaskInputSchema.shape,
    async (input) => {
      const db = resolveDb();
      const task = await updateTask(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "get_task",
    "Get a task by ID, optionally including comments, history, and links",
    GetTaskInputSchema.shape,
    async ({ task_id, include_comments, include_history, include_links }) => {
      const db = resolveDb();
      const task = getTaskById(db, task_id);
      if (!task) throw new Error(`Task not found: ${task_id}`);

      const result: Record<string, unknown> = { ...task };
      if (include_comments) result.comments = getComments(db, task_id);
      if (include_history) result.history = getHistory(db, task_id);
      if (include_links) result.links = getLinks(db, task_id);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_task",
    "Delete a task and all its related data",
    DeleteTaskInputSchema.shape,
    async ({ task_id }) => {
      const db = resolveDb();
      deleteTask(db, task_id);
      return {
        content: [{ type: "text", text: `Task ${task_id} deleted.` }],
      };
    }
  );

  server.tool(
    "start_task",
    "Set a task's status to in_progress",
    StartTaskInputSchema.shape,
    async ({ task_id }) => {
      const db = resolveDb();
      const task = await startTask(db, task_id);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "complete_task",
    "Mark a task as done",
    CompleteTaskInputSchema.shape,
    async ({ task_id, actual }) => {
      const db = resolveDb();
      const task = await completeTask(db, task_id, actual);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "cancel_task",
    "Cancel a task",
    CancelTaskInputSchema.shape,
    async ({ task_id }) => {
      const db = resolveDb();
      const task = await cancelTask(db, task_id);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "reopen_task",
    "Reopen a completed or cancelled task",
    ReopenTaskInputSchema.shape,
    async ({ task_id }) => {
      const db = resolveDb();
      const task = await reopenTask(db, task_id);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );
}
