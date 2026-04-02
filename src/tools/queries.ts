import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListTasksInputSchema,
  SearchTasksInputSchema,
  GetTaskGraphInputSchema,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  listTasks,
  searchTasks,
  getTaskGraph,
} from "../db/queries.js";

function resolveDb() {
  const project = getProject(process.cwd());
  return getProjectDb(project.id);
}

export function registerQueryTools(server: McpServer): void {
  server.tool(
    "list_tasks",
    "List tasks with structured filtering (status, type, priority, tags, dates, parent). All filters use AND semantics.",
    ListTasksInputSchema.shape,
    async (input) => {
      const db = resolveDb();
      const result = listTasks(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "search_tasks",
    "Search tasks using text (FTS5), semantic (vector similarity), or hybrid (both with reciprocal rank fusion) mode",
    SearchTasksInputSchema.shape,
    async ({ query, mode, status, limit }) => {
      const db = resolveDb();
      const results = await searchTasks(db, query, mode, status, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "get_task_graph",
    "Get a task and all linked tasks up to N hops out, returning nodes and edges",
    GetTaskGraphInputSchema.shape,
    async ({ task_id, depth }) => {
      const db = resolveDb();
      const graph = getTaskGraph(db, task_id, depth);
      return {
        content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
      };
    }
  );
}
