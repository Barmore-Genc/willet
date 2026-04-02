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
  RenderTaskBoardInputSchema,
  RenderDependencyGraphInputSchema,
  withProjectId,
  type GroupBy,
  type Task,
  type TaskLink,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  listTasks,
  getTaskGraph,
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
const TYPE_ORDER = ["epic", "feature", "task", "bug"];

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

function renderBoard(tasks: Task[], groupBy: GroupBy): string {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task[groupBy];
    const list = groups.get(key) ?? [];
    list.push(task);
    groups.set(key, list);
  }

  const order = getGroupOrder(groupBy);
  const lines: string[] = [];

  for (const group of order) {
    const groupTasks = groups.get(group);
    if (!groupTasks || groupTasks.length === 0) continue;

    lines.push(`## ${group} (${groupTasks.length})`);
    lines.push("");
    lines.push("| ID | Title | Priority | Type | Estimate |");
    lines.push("|---|---|---|---|---|");
    for (const t of groupTasks) {
      const shortId = t.id.slice(-8);
      lines.push(
        `| ${shortId} | ${t.title} | ${t.priority} | ${t.type} | ${t.estimate ?? "-"} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderDependencyGraphText(
  nodes: Task[],
  edges: TaskLink[],
  rootId: string
): string {
  const taskMap = new Map(nodes.map((t) => [t.id, t]));
  const adjacency = new Map<string, Array<{ taskId: string; linkType: string; direction: string }>>();

  for (const edge of edges) {
    const fromId = edge.source_task_id;
    const toId = edge.target_task_id;

    if (!adjacency.has(fromId)) adjacency.set(fromId, []);
    adjacency.get(fromId)!.push({ taskId: toId, linkType: edge.link_type, direction: "→" });

    if (!adjacency.has(toId)) adjacency.set(toId, []);
    adjacency.get(toId)!.push({ taskId: fromId, linkType: edge.link_type, direction: "←" });
  }

  const lines: string[] = [];
  const visited = new Set<string>();

  function walk(id: string, indent: number): void {
    if (visited.has(id)) return;
    visited.add(id);

    const task = taskMap.get(id);
    if (!task) return;

    const shortId = task.id.slice(-8);
    const prefix = "  ".repeat(indent);
    lines.push(`${prefix}${task.title} [${task.status}] (${shortId})`);

    const neighbors = adjacency.get(id) ?? [];
    for (const n of neighbors) {
      if (visited.has(n.taskId)) continue;
      const neighborTask = taskMap.get(n.taskId);
      if (!neighborTask) continue;
      const shortNId = neighborTask.id.slice(-8);
      const arrow = `${prefix}  ${n.direction} ${n.linkType} ${n.direction === "→" ? "→" : "←"} ${neighborTask.title} [${neighborTask.status}] (${shortNId})`;
      lines.push(arrow);
      walk(n.taskId, indent + 2);
    }
  }

  walk(rootId, 0);

  if (lines.length === 0) {
    const task = taskMap.get(rootId);
    if (task) {
      lines.push(`${task.title} [${task.status}] (${task.id.slice(-8)})`);
      lines.push("  (no links)");
    }
  }

  return lines.join("\n");
}

export function registerVizTools(server: McpServer): void {
  // --- Task Board (App-enhanced) ---

  const boardUri = "ui://willet/task-board.html";

  registerAppResource(
    server,
    "Task Board",
    boardUri,
    {},
    async (): Promise<ReadResourceResult> => {
      const html = await loadView("task-board");
      return {
        contents: [{ uri: boardUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    }
  );

  registerAppTool(
    server,
    "render_task_board",
    {
      description:
        "Render a kanban board grouped by status, priority, or type. Returns interactive board in supporting clients, markdown otherwise. IMPORTANT: Display the returned markdown directly to the user as-is.",
      inputSchema: withProjectId(RenderTaskBoardInputSchema).shape,
      _meta: { ui: { resourceUri: boardUri } },
    },
    async ({ project_id, group_by, ...filters }) => {
      const db = resolveDb(project_id);
      const { tasks } = listTasks(db, { ...filters, limit: 200 });
      const groupBy = group_by ?? "status";
      const board = renderBoard(tasks, groupBy);
      return {
        content: [{ type: "text", text: board }],
        structuredContent: { tasks, groupBy },
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
        "Render a dependency graph showing how a task relates to others via links. Returns interactive visualization in supporting clients, text tree otherwise.",
      inputSchema: withProjectId(RenderDependencyGraphInputSchema).shape,
      _meta: { ui: { resourceUri: depGraphUri } },
    },
    async ({ project_id, task_id, depth }) => {
      const db = resolveDb(project_id);
      const graph = getTaskGraph(db, task_id, depth ?? 2);
      const text = renderDependencyGraphText(graph.nodes, graph.edges, task_id);
      return {
        content: [{ type: "text", text }],
        structuredContent: { nodes: graph.nodes, edges: graph.edges },
      };
    }
  );
}
