import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ListTasksInputSchema,
  SearchTasksInputSchema,
  GetTaskGraphInputSchema,
  GetProjectStatsInputSchema,
  ListTagsInputSchema,
  withProjectId,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  listTasks,
  searchTasks,
  getTaskGraph,
  getProjectStats,
  listTags,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

const VIEWS_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "..", "..", "dist", "views")
  : path.join(import.meta.dirname, "..", "views");

async function loadView(name: string): Promise<string> {
  return fs.readFile(path.join(VIEWS_DIR, "views", name, "index.html"), "utf-8");
}

export function registerQueryTools(server: McpServer): void {
  server.tool(
    "list_tasks",
    "List tasks with structured filtering (status, type, priority, tags, dates, parent). All filters use AND semantics.",
    withProjectId(ListTasksInputSchema).shape,
    async ({ project_id, ...input }) => {
      const db = resolveDb(project_id);
      const result = listTasks(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "search_tasks",
    "Search tasks using text (FTS5), semantic (vector similarity), or hybrid (both with reciprocal rank fusion) mode",
    withProjectId(SearchTasksInputSchema).shape,
    async ({ project_id, query, mode, status, type, priority, limit }) => {
      const db = resolveDb(project_id);
      const results = await searchTasks(db, query, { mode, status, type, priority, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "get_task_graph",
    "Get a task and all linked tasks up to N hops out, returning nodes and edges",
    withProjectId(GetTaskGraphInputSchema).shape,
    async ({ project_id, task_id, depth }) => {
      const db = resolveDb(project_id);
      const graph = getTaskGraph(db, task_id, depth);
      return {
        content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
      };
    }
  );

  // --- Project Stats (App-enhanced) ---

  const statsUri = "ui://willet/project-stats.html";

  registerAppResource(
    server,
    "Project Stats",
    statsUri,
    {},
    async (): Promise<ReadResourceResult> => {
      const html = await loadView("project-stats");
      return {
        contents: [{ uri: statsUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    }
  );

  registerAppTool(
    server,
    "get_project_stats",
    {
      description: "Get task counts grouped by status, type, and priority. Returns interactive dashboard in supporting clients.",
      inputSchema: withProjectId(GetProjectStatsInputSchema).shape,
      _meta: { ui: { resourceUri: statsUri } },
    },
    async ({ project_id }) => {
      const db = resolveDb(project_id);
      const stats = getProjectStats(db);
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
        structuredContent: stats,
      };
    }
  );

  server.tool(
    "list_tags",
    "List all tags in use with their task counts",
    withProjectId(ListTagsInputSchema).shape,
    async ({ project_id }) => {
      const db = resolveDb(project_id);
      const tags = listTags(db);
      return {
        content: [{ type: "text", text: JSON.stringify(tags, null, 2) }],
      };
    }
  );
}
