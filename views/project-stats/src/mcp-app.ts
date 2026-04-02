import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// --- Types ---

interface StatsData {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
}

// --- Colors ---

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  in_progress: "#f59e0b",
  done: "#22c55e",
  cancelled: "#9ca3af",
};

const TYPE_COLORS: Record<string, string> = {
  task: "#6366f1",
  bug: "#ef4444",
  feature: "#22c55e",
  epic: "#8b5cf6",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

// --- Style ---

const style = document.createElement("style");
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--color-background-primary, #0a0a0a);
    font-family: var(--font-sans, system-ui, sans-serif);
    color: var(--color-text-primary, #e5e5e5);
    padding: 20px;
  }
  .dashboard { max-width: 700px; margin: 0 auto; }
  .summary-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
    margin-bottom: 24px;
  }
  .summary-card {
    background: var(--color-background-secondary, #171717);
    border: 1px solid var(--color-border-primary, #262626);
    border-radius: 8px;
    padding: 14px 16px;
    text-align: center;
  }
  .summary-card .value {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.2;
  }
  .summary-card .label {
    font-size: 11px;
    color: var(--color-text-secondary, #a3a3a3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 2px;
  }
  .chart-section {
    background: var(--color-background-secondary, #171717);
    border: 1px solid var(--color-border-primary, #262626);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 14px;
  }
  .chart-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-secondary, #a3a3a3);
    margin-bottom: 12px;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .bar-label {
    font-size: 12px;
    width: 90px;
    text-align: right;
    color: var(--color-text-secondary, #a3a3a3);
    flex-shrink: 0;
  }
  .bar-track {
    flex: 1;
    height: 22px;
    background: var(--color-background-primary, #0a0a0a);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }
  .bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s ease;
    min-width: 2px;
  }
  .bar-value {
    font-size: 12px;
    font-weight: 600;
    width: 36px;
    text-align: right;
    flex-shrink: 0;
  }
  .empty {
    color: var(--color-text-tertiary, #737373);
    font-size: 13px;
    text-align: center;
    padding: 40px 20px;
    font-style: italic;
  }
`;
document.head.appendChild(style);

// --- Render ---

function renderBarChart(
  container: HTMLElement,
  title: string,
  data: Record<string, number>,
  colors: Record<string, string>,
  order?: string[]
) {
  const section = document.createElement("div");
  section.className = "chart-section";

  const titleEl = document.createElement("div");
  titleEl.className = "chart-title";
  titleEl.textContent = title;
  section.appendChild(titleEl);

  const keys = order
    ? order.filter((k) => k in data || true)
    : Object.keys(data).sort((a, b) => (data[b] || 0) - (data[a] || 0));

  const maxVal = Math.max(...Object.values(data), 1);

  for (const key of keys) {
    const count = data[key] || 0;
    const row = document.createElement("div");
    row.className = "bar-row";

    const pct = (count / maxVal) * 100;
    const color = colors[key] || "#666";

    row.innerHTML = `
      <span class="bar-label">${key.replace("_", " ")}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="bar-value" style="color:${color}">${count}</span>
    `;
    section.appendChild(row);
  }

  container.appendChild(section);
}

function renderDashboard(stats: StatsData) {
  const container = document.getElementById("dashboard")!;
  container.innerHTML = "";

  const dashboard = document.createElement("div");
  dashboard.className = "dashboard";

  // Summary cards
  const cards = document.createElement("div");
  cards.className = "summary-cards";

  const summaryItems = [
    { value: stats.total, label: "Total", color: "var(--color-text-primary, #e5e5e5)" },
    { value: stats.byStatus?.open || 0, label: "Open", color: STATUS_COLORS.open },
    { value: stats.byStatus?.in_progress || 0, label: "In Progress", color: STATUS_COLORS.in_progress },
    { value: stats.byStatus?.done || 0, label: "Done", color: STATUS_COLORS.done },
  ];

  for (const item of summaryItems) {
    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML = `
      <div class="value" style="color:${item.color}">${item.value}</div>
      <div class="label">${item.label}</div>
    `;
    cards.appendChild(card);
  }
  dashboard.appendChild(cards);

  // Charts
  renderBarChart(dashboard, "By Status", stats.byStatus, STATUS_COLORS,
    ["open", "in_progress", "done", "cancelled"]);
  renderBarChart(dashboard, "By Type", stats.byType, TYPE_COLORS,
    ["epic", "feature", "task", "bug"]);
  renderBarChart(dashboard, "By Priority", stats.byPriority, PRIORITY_COLORS,
    ["urgent", "high", "medium", "low"]);

  container.appendChild(dashboard);
}

// --- MCP App ---

function extractStats(result: CallToolResult): StatsData | null {
  if (result.structuredContent) {
    return result.structuredContent as unknown as StatsData;
  }
  for (const item of result.content ?? []) {
    if (item.type === "text") {
      try {
        const parsed = JSON.parse(item.text);
        if ("total" in parsed) return parsed;
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
    document.body.style.padding = `${ctx.safeAreaInsets.top + 20}px ${ctx.safeAreaInsets.right + 20}px ${ctx.safeAreaInsets.bottom + 20}px ${ctx.safeAreaInsets.left + 20}px`;
  }
}

const app = new App({ name: "Project Stats", version: "1.0.0" });

app.ontoolinput = () => {
  const container = document.getElementById("dashboard")!;
  container.innerHTML = '<p style="color:var(--color-text-secondary,#a3a3a3);padding:20px;">Loading stats...</p>';
};

app.ontoolresult = (result) => {
  const stats = extractStats(result);
  if (stats) {
    renderDashboard(stats);
  } else {
    const container = document.getElementById("dashboard")!;
    container.innerHTML = '<p class="empty">No stats available. Initialize a project first.</p>';
  }
};

app.onhostcontextchanged = handleHostContext;
app.onteardown = async () => ({});
app.onerror = console.error;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContext(ctx);
});
