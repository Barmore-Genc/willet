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
  ListTicketsInputSchema,
  SearchTicketsInputSchema,
  GetTicketGraphInputSchema,
  GetProjectStatsInputSchema,
  ListTagsInputSchema,
  withProjectId,
  projectTickets,
  type ToolOptions,
  type Verbosity,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  listTickets,
  searchTickets,
  getTicketGraph,
  getProjectStats,
  listTags,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

async function findViewsDir(): Promise<string> {
  const dir = import.meta.dirname;
  const candidates = [
    path.join(dir, "..", "views", "views"),
    path.join(dir, "..", "..", "dist", "views", "views"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return candidates[0];
}

const viewsDirPromise = findViewsDir();

async function loadView(name: string): Promise<string> {
  const viewsDir = await viewsDirPromise;
  return fs.readFile(path.join(viewsDir, name, "index.html"), "utf-8");
}

export function registerQueryTools(server: McpServer, options: ToolOptions): void {
  const listSchema =
    options.mode === "local"
      ? withProjectId(ListTicketsInputSchema.omit({ assignee: true }))
      : withProjectId(ListTicketsInputSchema);

  server.tool(
    "list_tickets",
    "List tickets with structured filtering (status, type, priority, tags, dates, parent). All filters use AND semantics. `verbosity` controls output: 'short' (id/title/status/type/priority/estimate/assignee/tags/due_date), 'detailed' (all fields, description truncated, default), or 'full' (all fields, no truncation).",
    listSchema.shape,
    async ({ project_id, verbosity, ...input }) => {
      const db = resolveDb(project_id);
      const result = listTickets(db, input);
      const mode: Verbosity = verbosity ?? "detailed";
      return {
        content: [{ type: "text", text: JSON.stringify({ ...result, tickets: projectTickets(result.tickets, mode, options) }, null, 2) }],
      };
    }
  );

  server.tool(
    "search_tickets",
    "Search tickets using text (FTS5), semantic (vector similarity), or hybrid (both with reciprocal rank fusion) mode. `verbosity` controls output: 'short', 'detailed' (default), or 'full'.",
    withProjectId(SearchTicketsInputSchema).shape,
    async ({ project_id, query, mode, status, type, priority, limit, verbosity }) => {
      const db = resolveDb(project_id);
      const results = await searchTickets(db, query, { mode, status, type, priority, limit });
      const v: Verbosity = verbosity ?? "detailed";
      return {
        content: [{ type: "text", text: JSON.stringify(projectTickets(results, v, options), null, 2) }],
      };
    }
  );

  server.tool(
    "get_ticket_graph",
    "Get a ticket and all linked tickets up to N hops out, returning nodes and edges. `verbosity` controls node output: 'short', 'detailed' (default), or 'full'.",
    withProjectId(GetTicketGraphInputSchema).shape,
    async ({ project_id, ticket_id, depth, verbosity }) => {
      const db = resolveDb(project_id);
      const graph = getTicketGraph(db, ticket_id, depth);
      const v: Verbosity = verbosity ?? "detailed";
      return {
        content: [{ type: "text", text: JSON.stringify({ ...graph, nodes: projectTickets(graph.nodes, v, options) }, null, 2) }],
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
      description: "Get ticket counts grouped by status, type, and priority. Returns interactive dashboard in supporting clients.",
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
    "List all tags in use with their ticket counts",
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
