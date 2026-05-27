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
  RenderTicketBoardInputSchema,
  RenderDependencyGraphInputSchema,
  withProjectId,
  formatTickets,
  type GroupBy,
  type Ticket,
  type TicketLink,
  type ToolOptions,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  listTickets,
  getTicketGraph,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

// Path to bundled view HTML files
// Resolve views directory — works for:
// - Dev (ts-node): src/tools/ → ../../dist/views/views/
// - Shared dist:   dist/tools/ → ../views/views/
// - esbuild bundle / mcpb: dist/ → ../views/views/
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

const STATUS_ORDER = ["open", "in_progress", "done", "cancelled"];
const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];
const TYPE_ORDER = ["epic", "feature", "chore", "bug"];

function getGroupOrder(groupBy: GroupBy): string[] {
  switch (groupBy) {
    case "status":
      return STATUS_ORDER;
    case "priority":
      return PRIORITY_ORDER;
    case "type":
      return TYPE_ORDER;
  }
}

function renderBoard(tickets: Ticket[], groupBy: GroupBy, showAssignee: boolean): string {
  const groups = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    const key = ticket[groupBy];
    const list = groups.get(key) ?? [];
    list.push(ticket);
    groups.set(key, list);
  }

  const order = getGroupOrder(groupBy);
  const lines: string[] = [];

  for (const group of order) {
    const groupTickets = groups.get(group);
    if (!groupTickets || groupTickets.length === 0) continue;

    lines.push(`## ${group} (${groupTickets.length})`);
    lines.push("");
    if (showAssignee) {
      lines.push("| ID | Title | Priority | Type | Assignee | Estimate |");
      lines.push("|---|---|---|---|---|---|");
    } else {
      lines.push("| ID | Title | Priority | Type | Estimate |");
      lines.push("|---|---|---|---|---|");
    }
    for (const t of groupTickets) {
      const shortId = t.id.slice(-8);
      if (showAssignee) {
        lines.push(
          `| ${shortId} | ${t.title} | ${t.priority} | ${t.type} | ${t.assignee ?? "-"} | ${t.estimate ?? "-"} |`
        );
      } else {
        lines.push(
          `| ${shortId} | ${t.title} | ${t.priority} | ${t.type} | ${t.estimate ?? "-"} |`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderDependencyGraphText(
  nodes: Ticket[],
  edges: TicketLink[],
  rootId: string
): string {
  const ticketMap = new Map(nodes.map((t) => [t.id, t]));
  const adjacency = new Map<string, Array<{ ticketId: string; linkType: string; direction: string }>>();

  for (const edge of edges) {
    const fromId = edge.source_ticket_id;
    const toId = edge.target_ticket_id;

    if (!adjacency.has(fromId)) adjacency.set(fromId, []);
    adjacency.get(fromId)!.push({ ticketId: toId, linkType: edge.link_type, direction: "→" });

    if (!adjacency.has(toId)) adjacency.set(toId, []);
    adjacency.get(toId)!.push({ ticketId: fromId, linkType: edge.link_type, direction: "←" });
  }

  const lines: string[] = [];
  const visited = new Set<string>();

  function walk(id: string, indent: number): void {
    if (visited.has(id)) return;
    visited.add(id);

    const ticket = ticketMap.get(id);
    if (!ticket) return;

    const shortId = ticket.id.slice(-8);
    const prefix = "  ".repeat(indent);
    lines.push(`${prefix}${ticket.title} [${ticket.status}] (${shortId})`);

    const neighbors = adjacency.get(id) ?? [];
    for (const n of neighbors) {
      if (visited.has(n.ticketId)) continue;
      const neighborTicket = ticketMap.get(n.ticketId);
      if (!neighborTicket) continue;
      const shortNId = neighborTicket.id.slice(-8);
      const arrow = `${prefix}  ${n.direction} ${n.linkType} ${n.direction === "→" ? "→" : "←"} ${neighborTicket.title} [${neighborTicket.status}] (${shortNId})`;
      lines.push(arrow);
      walk(n.ticketId, indent + 2);
    }
  }

  walk(rootId, 0);

  if (lines.length === 0) {
    const ticket = ticketMap.get(rootId);
    if (ticket) {
      lines.push(`${ticket.title} [${ticket.status}] (${ticket.id.slice(-8)})`);
      lines.push("  (no links)");
    }
  }

  return lines.join("\n");
}

export function registerVizTools(server: McpServer, options: ToolOptions): void {
  // --- Ticket Board (App-enhanced) ---

  const boardUri = "ui://willet/ticket-board.html";

  registerAppResource(
    server,
    "Ticket Board",
    boardUri,
    {},
    async (): Promise<ReadResourceResult> => {
      const html = await loadView("ticket-board");
      return {
        contents: [{ uri: boardUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    }
  );

  registerAppTool(
    server,
    "render_ticket_board",
    {
      description:
        "Render a kanban board grouped by status, priority, or type. Returns interactive board in supporting clients, markdown otherwise. IMPORTANT: Display the returned markdown directly to the user as-is.",
      inputSchema: withProjectId(RenderTicketBoardInputSchema).shape,
      _meta: { ui: { resourceUri: boardUri } },
    },
    async ({ project_id, group_by, ...filters }) => {
      const db = resolveDb(project_id);
      const { tickets } = listTickets(db, { ...filters, limit: 200 });
      const groupBy = group_by ?? "status";
      const showAssignee = options.mode === "selfhosted";
      const board = renderBoard(tickets, groupBy, showAssignee);
      return {
        content: [{ type: "text", text: board }],
        structuredContent: { tickets: formatTickets(tickets, options), groupBy },
      };
    }
  );

  // --- Dependency Graph (App-enhanced) ---

  const depGraphUri = "ui://willet/dependency-graph.html";

  registerAppResource(
    server,
    "Dependency Graph",
    depGraphUri,
    {},
    async (): Promise<ReadResourceResult> => {
      const html = await loadView("dependency-graph");
      return {
        contents: [{ uri: depGraphUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    }
  );

  registerAppTool(
    server,
    "render_dependency_graph",
    {
      description:
        "Render a dependency graph showing how a ticket relates to others via links. Returns interactive visualization in supporting clients, text tree otherwise.",
      inputSchema: withProjectId(RenderDependencyGraphInputSchema).shape,
      _meta: { ui: { resourceUri: depGraphUri } },
    },
    async ({ project_id, ticket_id, depth }) => {
      const db = resolveDb(project_id);
      const graph = getTicketGraph(db, ticket_id, depth ?? 2);
      const text = renderDependencyGraphText(graph.nodes, graph.edges, ticket_id);
      return {
        content: [{ type: "text", text }],
        structuredContent: { nodes: formatTickets(graph.nodes, options), edges: graph.edges },
      };
    }
  );
}
