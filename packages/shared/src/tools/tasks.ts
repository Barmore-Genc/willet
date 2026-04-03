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
  withProjectId,
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
  listTasks,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "create_task",
    "Create a new task with optional links and initial_comment",
    withProjectId(CreateTaskInputSchema).shape,
    async ({ project_id, ...input }) => {
      const db = resolveDb(project_id);
      const task = await createTask(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "update_task",
    "Update an existing task's fields",
    withProjectId(UpdateTaskInputSchema).shape,
    async ({ project_id, ...input }) => {
      const db = resolveDb(project_id);
      const task = await updateTask(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "get_task",
    "Get a task by ID with its comments and links. History and subtasks are opt-in.",
    withProjectId(GetTaskInputSchema).shape,
    async ({ project_id, task_id, include_history, include_subtasks }) => {
      const db = resolveDb(project_id);
      const task = getTaskById(db, task_id);
      if (!task) throw new Error(`Task not found: ${task_id}`);

      const result: Record<string, unknown> = { ...task };
      result.comments = getComments(db, task_id);
      if (include_history) result.history = getHistory(db, task_id);
      result.links = getLinks(db, task_id);
      if (include_subtasks) {
        const { tasks: subtasks } = listTasks(db, { parent_task_id: task_id });
        result.subtasks = subtasks;
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_task",
    "Delete a task and all its related data",
    withProjectId(DeleteTaskInputSchema).shape,
    async ({ project_id, task_id }) => {
      const db = resolveDb(project_id);
      deleteTask(db, task_id);
      return {
        content: [{ type: "text", text: `Task ${task_id} deleted.` }],
      };
    }
  );

  server.tool(
    "start_task",
    "Set a task's status to in_progress",
    withProjectId(StartTaskInputSchema).shape,
    async ({ project_id, task_id }) => {
      const db = resolveDb(project_id);
      const task = await startTask(db, task_id);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "complete_task",
    "Mark a task as done",
    withProjectId(CompleteTaskInputSchema).shape,
    async ({ project_id, task_id, actual }) => {
      const db = resolveDb(project_id);
      const task = await completeTask(db, task_id, actual);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "cancel_task",
    "Cancel a task",
    withProjectId(CancelTaskInputSchema).shape,
    async ({ project_id, task_id }) => {
      const db = resolveDb(project_id);
      const task = await cancelTask(db, task_id);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );

  server.tool(
    "reopen_task",
    "Reopen a completed or cancelled task",
    withProjectId(ReopenTaskInputSchema).shape,
    async ({ project_id, task_id }) => {
      const db = resolveDb(project_id);
      const task = await reopenTask(db, task_id);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
      };
    }
  );
}
