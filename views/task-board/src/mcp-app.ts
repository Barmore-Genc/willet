import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// --- Types ---

interface Task {
  id: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  estimate: string | null;
  tags: string[];
}

interface BoardData {
  tasks: Task[];
  groupBy: string;
}

// --- Colors ---

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  in_progress: "#f59e0b",
  done: "#22c55e",
  cancelled: "#9ca3af",
};

const PRIORITY_BADGES: Record<string, { color: string; label: string }> = {
  urgent: { color: "#ef4444", label: "URGENT" },
  high: { color: "#f97316", label: "HIGH" },
  medium: { color: "#eab308", label: "MED" },
  low: { color: "#6b7280", label: "LOW" },
};

const TYPE_ICONS: Record<string, string> = {
  task: "\u2611",
  bug: "\ud83d\udc1b",
  feature: "\u2728",
  epic: "\ud83d\ude80",
};

const GROUP_ORDERS: Record<string, string[]> = {
  status: ["open", "in_progress", "done", "cancelled"],
  priority: ["urgent", "high", "medium", "low"],
  type: ["epic", "feature", "task", "bug"],
};

// --- Style ---

const style = document.createElement("style");
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--color-background-primary, #0a0a0a);
    font-family: var(--font-sans, system-ui, sans-serif);
    color: var(--color-text-primary, #e5e5e5);
    padding: 16px;
    min-height: 100vh;
  }
  #board {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    align-items: flex-start;
    min-height: calc(100vh - 32px);
  }
  .column {
    flex: 1;
    min-width: 220px;
    max-width: 320px;
    background: var(--color-background-secondary, #171717);
    border-radius: 8px;
    border: 1px solid var(--color-border-primary, #262626);
    overflow: hidden;
  }
  .column-header {
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--color-border-primary, #262626);
  }
  .column-header .count {
    font-size: 11px;
    font-weight: 400;
    color: var(--color-text-secondary, #a3a3a3);
    background: var(--color-background-primary, #0a0a0a);
    padding: 1px 7px;
    border-radius: 10px;
  }
  .column-body {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card {
    background: var(--color-background-primary, #0a0a0a);
    border: 1px solid var(--color-border-primary, #262626);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 13px;
    transition: border-color 0.15s;
  }
  .card:hover {
    border-color: var(--color-border-secondary, #404040);
  }
  .card-header {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 6px;
  }
  .card-type { font-size: 14px; flex-shrink: 0; }
  .card-title {
    font-weight: 500;
    line-height: 1.3;
    word-break: break-word;
  }
  .card-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .card-id {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--color-text-tertiary, #737373);
  }
  .badge {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.03em;
    color: #fff;
  }
  .tag {
    font-size: 10px;
    color: var(--color-text-secondary, #a3a3a3);
    background: var(--color-background-secondary, #171717);
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid var(--color-border-primary, #262626);
  }
  .estimate {
    font-size: 10px;
    color: var(--color-text-secondary, #a3a3a3);
    margin-left: auto;
  }
  .empty {
    color: var(--color-text-tertiary, #737373);
    font-size: 12px;
    text-align: center;
    padding: 20px 10px;
    font-style: italic;
  }
`;
document.head.appendChild(style);

// --- Render ---

function renderBoard(data: BoardData) {
  const container = document.getElementById("board")!;
  container.innerHTML = "";

  const groupBy = data.groupBy || "status";
  const order = GROUP_ORDERS[groupBy] || GROUP_ORDERS.status;

  const groups = new Map<string, Task[]>();
  for (const task of data.tasks) {
    const key = (task as Record<string, unknown>)[groupBy] as string;
    const list = groups.get(key) ?? [];
    list.push(task);
    groups.set(key, list);
  }

  for (const group of order) {
    const tasks = groups.get(group) ?? [];

    const col = document.createElement("div");
    col.className = "column";

    // Header with color indicator
    const headerColor = groupBy === "status"
      ? STATUS_COLORS[group] || "#666"
      : groupBy === "priority"
        ? PRIORITY_BADGES[group]?.color || "#666"
        : "#666";

    col.innerHTML = `
      <div class="column-header" style="border-top: 3px solid ${headerColor}">
        <span>${group.replace("_", " ")}</span>
        <span class="count">${tasks.length}</span>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "column-body";

    if (tasks.length === 0) {
      body.innerHTML = '<div class="empty">No tasks</div>';
    } else {
      for (const task of tasks) {
        const card = document.createElement("div");
        card.className = "card";

        const typeIcon = TYPE_ICONS[task.type] || "";
        const priority = PRIORITY_BADGES[task.priority];
        const shortId = task.id.slice(-8);

        let metaHtml = `<span class="card-id">${shortId}</span>`;
        if (priority) {
          metaHtml += `<span class="badge" style="background:${priority.color}">${priority.label}</span>`;
        }
        for (const tag of task.tags || []) {
          metaHtml += `<span class="tag">${tag}</span>`;
        }
        if (task.estimate) {
          metaHtml += `<span class="estimate">${task.estimate}</span>`;
        }

        card.innerHTML = `
          <div class="card-header">
            <span class="card-type">${typeIcon}</span>
            <span class="card-title">${task.title}</span>
          </div>
          <div class="card-meta">${metaHtml}</div>
        `;
        body.appendChild(card);
      }
    }

    col.appendChild(body);
    container.appendChild(col);
  }
}

// --- MCP App ---

function extractBoardData(result: CallToolResult): BoardData | null {
  if (result.structuredContent) {
    return result.structuredContent as unknown as BoardData;
  }
  for (const item of result.content ?? []) {
    if (item.type === "text") {
      try {
        const parsed = JSON.parse(item.text);
        if (parsed.tasks && parsed.groupBy) return parsed;
      } catch { /* not JSON */ }
    }
  }
  return null;
}

function handleHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    document.body.style.padding = `${ctx.safeAreaInsets.top + 16}px ${ctx.safeAreaInsets.right + 16}px ${ctx.safeAreaInsets.bottom + 16}px ${ctx.safeAreaInsets.left + 16}px`;
  }
}

const app = new App({ name: "Task Board", version: "1.0.0" });

app.ontoolinput = () => {
  const container = document.getElementById("board")!;
  container.innerHTML = '<p style="color:var(--color-text-secondary,#a3a3a3);padding:20px;">Loading board...</p>';
};

app.ontoolresult = (result) => {
  const data = extractBoardData(result);
  if (data) {
    renderBoard(data);
  }
};

app.onhostcontextchanged = handleHostContext;
app.onteardown = async () => ({});
app.onerror = console.error;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContext(ctx);
});
