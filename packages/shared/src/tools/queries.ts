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
  FindTicketsInputSchema,
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
  const queryMode: "local" | "http" = options.mode === "local" ? "local" : "http";

  server.tool(
    "find_tickets",
    "Find tickets. With `query`, searches by relevance using text (FTS5), semantic (vector similarity), or hybrid mode; without it, lists tickets in sort order. Either way `filter` narrows the results (see the filter parameter for the language). Returns `tickets`, plus `total` — the full number of matches ignoring `limit` — when listing. Searching omits `total`, so never read the result count as the number of matching tickets. `verbosity` controls output: 'short' (id/title/status/type/priority/estimate/assignee/tags/due_date), 'detailed' (all fields, description truncated, default), or 'full' (all fields, no truncation).",
    withProjectId(FindTicketsInputSchema).shape,
    async ({ project_id, query, mode, filter, sort, sort_direction, limit, offset, verbosity }) => {
      const db = resolveDb(project_id);
      const v: Verbosity = verbosity ?? "detailed";

      // Relevance search has no cheap way to count matches beyond `limit`, so it
      // reports no `total` rather than passing off the page size as one.
      if (query) {
        const results = await searchTickets(db, query, { mode, filter, limit, queryMode });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tickets: projectTickets(results, v, options) }, null, 2),
            },
          ],
        };
      }

      const result = listTickets(db, { filter, sort, sort_direction, limit, offset, mode: queryMode });
      return {
        content: [{ type: "text", text: JSON.stringify({ ...result, tickets: projectTickets(result.tickets, v, options) }, null, 2) }],
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
