import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RenderTaskBoardInputSchema,
  type GroupBy,
  type Task,
} from "../models/types.js";
import {
  getProject,
  getProjectDb,
  listTasks,
} from "../db/queries.js";

function resolveDb() {
  const project = getProject(process.cwd());
  return getProjectDb(project.id);
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

    lines.push(`## ${group}`);
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

export function registerVizTools(server: McpServer): void {
  server.tool(
    "render_task_board",
    "Render a markdown kanban board grouped by status, priority, or type. IMPORTANT: Display the returned markdown directly to the user as-is. Do not summarize, interpret, or reformat the output.",
    RenderTaskBoardInputSchema.shape,
    async ({ group_by, ...filters }) => {
      const db = resolveDb();
      const { tasks } = listTasks(db, { ...filters, limit: 200 });
      const groupBy = group_by ?? "status";
      const board = renderBoard(tasks, groupBy);
      return {
        content: [{ type: "text", text: board }],
      };
    }
  );

}
