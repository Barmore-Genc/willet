import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { drag } from "d3-drag";

// --- Types ---

interface TaskNode extends SimulationNodeDatum {
  id: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  shortId: string;
}

interface TaskEdge extends SimulationLinkDatum<TaskNode> {
  id: string;
  link_type: string;
  source_task_id: string;
  target_task_id: string;
}

interface GraphData {
  nodes: Array<{
    id: string;
    title: string;
    status: string;
    type: string;
    priority: string;
  }>;
  edges: Array<{
    id: string;
    source_task_id: string;
    target_task_id: string;
    link_type: string;
  }>;
}

// --- Colors ---

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  in_progress: "#f59e0b",
  done: "#22c55e",
  cancelled: "#9ca3af",
};

const LINK_COLORS: Record<string, string> = {
  blocks: "#ef4444",
  relates_to: "#8b5cf6",
  duplicates: "#6b7280",
};

// --- Style ---

const style = document.createElement("style");
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 100%;
    height: 100vh;
    overflow: hidden;
    background: var(--color-background-primary, #0a0a0a);
    font-family: var(--font-sans, system-ui, sans-serif);
  }
  #graph { width: 100%; height: 100%; }
  svg { display: block; }

  .node-group { cursor: grab; }
  .node-group:active { cursor: grabbing; }
  .node-group text {
    fill: var(--color-text-primary, #e5e5e5);
    font-size: 11px;
    pointer-events: none;
    text-anchor: middle;
  }
  .node-group .node-id {
    fill: var(--color-text-secondary, #a3a3a3);
    font-size: 9px;
    font-family: var(--font-mono, monospace);
  }

  .link-label {
    fill: var(--color-text-tertiary, #737373);
    font-size: 9px;
    pointer-events: none;
    text-anchor: middle;
  }

  .legend {
    position: fixed;
    bottom: 12px;
    left: 12px;
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--color-text-secondary, #a3a3a3);
    background: var(--color-background-secondary, #171717);
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--color-border-primary, #262626);
  }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .dimmed { opacity: 0.15; transition: opacity 0.2s; }
  .highlighted { opacity: 1; transition: opacity 0.2s; }
`;
document.head.appendChild(style);

// --- Legend ---

const legendEl = document.createElement("div");
legendEl.className = "legend";
for (const [status, color] of Object.entries(STATUS_COLORS)) {
  const item = document.createElement("span");
  item.className = "legend-item";
  item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${status.replace("_", " ")}`;
  legendEl.appendChild(item);
}
document.body.appendChild(legendEl);

// --- Render ---

let currentHighlight: string | null = null;

function renderGraph(data: GraphData) {
  const container = document.getElementById("graph")!;
  container.innerHTML = "";

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;

  const nodeMap = new Map<string, TaskNode>();
  const nodes: TaskNode[] = data.nodes.map((n) => {
    const node: TaskNode = {
      id: n.id,
      title: n.title.length > 30 ? n.title.slice(0, 28) + "..." : n.title,
      status: n.status,
      type: n.type,
      priority: n.priority,
      shortId: n.id.slice(-8),
    };
    nodeMap.set(n.id, node);
    return node;
  });

  const edges: TaskEdge[] = data.edges
    .filter((e) => nodeMap.has(e.source_task_id) && nodeMap.has(e.target_task_id))
    .map((e) => ({
      id: e.id,
      source: e.source_task_id,
      target: e.target_task_id,
      link_type: e.link_type,
      source_task_id: e.source_task_id,
      target_task_id: e.target_task_id,
    }));

  const svg = select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Arrow markers
  const defs = svg.append("defs");
  for (const [type, color] of Object.entries(LINK_COLORS)) {
    defs
      .append("marker")
      .attr("id", `arrow-${type}`)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 28)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", color);
  }

  const g = svg.append("g");

  // Zoom
  const zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 4])
    .on("zoom", (event) => g.attr("transform", event.transform));
  svg.call(zoomBehavior);

  // Links
  const linkGroup = g
    .append("g")
    .selectAll("line")
    .data(edges)
    .join("line")
    .attr("stroke", (d) => LINK_COLORS[d.link_type] || "#666")
    .attr("stroke-width", 1.5)
    .attr("stroke-opacity", 0.7)
    .attr("marker-end", (d) => `url(#arrow-${d.link_type})`)
    .attr("class", "link");

  // Link labels
  const linkLabelGroup = g
    .append("g")
    .selectAll("text")
    .data(edges)
    .join("text")
    .attr("class", "link-label")
    .text((d) => d.link_type.replace("_", " "));

  // Node groups
  const nodeGroup = g
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node-group")
    .on("click", (_event, d) => {
      if (currentHighlight === d.id) {
        // Clear highlight
        currentHighlight = null;
        svg.selectAll(".node-group, .link, .link-label").classed("dimmed", false).classed("highlighted", false);
      } else {
        currentHighlight = d.id;
        const connectedIds = new Set<string>([d.id]);
        edges.forEach((e) => {
          const srcId = typeof e.source === "object" ? (e.source as TaskNode).id : e.source;
          const tgtId = typeof e.target === "object" ? (e.target as TaskNode).id : e.target;
          if (srcId === d.id) connectedIds.add(tgtId);
          if (tgtId === d.id) connectedIds.add(srcId);
        });

        svg.selectAll<SVGGElement, TaskNode>(".node-group")
          .classed("dimmed", (n) => !connectedIds.has(n.id))
          .classed("highlighted", (n) => connectedIds.has(n.id));
        svg.selectAll<SVGLineElement, TaskEdge>(".link")
          .classed("dimmed", (e) => {
            const srcId = typeof e.source === "object" ? (e.source as TaskNode).id : e.source;
            const tgtId = typeof e.target === "object" ? (e.target as TaskNode).id : e.target;
            return !connectedIds.has(srcId) || !connectedIds.has(tgtId);
          })
          .classed("highlighted", (e) => {
            const srcId = typeof e.source === "object" ? (e.source as TaskNode).id : e.source;
            const tgtId = typeof e.target === "object" ? (e.target as TaskNode).id : e.target;
            return connectedIds.has(srcId) && connectedIds.has(tgtId);
          });
        svg.selectAll<SVGTextElement, TaskEdge>(".link-label")
          .classed("dimmed", (e) => {
            const srcId = typeof e.source === "object" ? (e.source as TaskNode).id : e.source;
            const tgtId = typeof e.target === "object" ? (e.target as TaskNode).id : e.target;
            return !connectedIds.has(srcId) || !connectedIds.has(tgtId);
          });
      }
    });

  // Node circles
  nodeGroup
    .append("circle")
    .attr("r", 18)
    .attr("fill", (d) => STATUS_COLORS[d.status] || "#666")
    .attr("stroke", "var(--color-border-primary, #262626)")
    .attr("stroke-width", 2);

  // Node title
  nodeGroup
    .append("text")
    .attr("dy", -24)
    .text((d) => d.title);

  // Node short ID
  nodeGroup
    .append("text")
    .attr("class", "node-id")
    .attr("dy", 4)
    .text((d) => d.shortId);

  // Drag
  const dragBehavior = drag<SVGGElement, TaskNode>()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });

  nodeGroup.call(dragBehavior);

  // Simulation
  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<TaskNode, TaskEdge>(edges)
        .id((d) => d.id)
        .distance(150)
    )
    .force("charge", forceManyBody().strength(-400))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide(40))
    .on("tick", () => {
      linkGroup
        .attr("x1", (d) => (d.source as TaskNode).x!)
        .attr("y1", (d) => (d.source as TaskNode).y!)
        .attr("x2", (d) => (d.target as TaskNode).x!)
        .attr("y2", (d) => (d.target as TaskNode).y!);

      linkLabelGroup
        .attr("x", (d) => ((d.source as TaskNode).x! + (d.target as TaskNode).x!) / 2)
        .attr("y", (d) => ((d.source as TaskNode).y! + (d.target as TaskNode).y!) / 2 - 6);

      nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

  // Center view after layout settles
  simulation.on("end", () => {
    const bounds = (g.node() as SVGGElement).getBBox();
    if (bounds.width > 0 && bounds.height > 0) {
      const scale = Math.min(
        width / (bounds.width + 100),
        height / (bounds.height + 100),
        1.5
      );
      const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
      const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;
      svg
        .transition()
        .duration(500)
        .call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(scale));
    }
  });
}

// --- MCP App ---

function extractGraph(result: CallToolResult): GraphData | null {
  if (result.structuredContent) {
    return result.structuredContent as unknown as GraphData;
  }
  // Try parsing from text content
  for (const item of result.content ?? []) {
    if (item.type === "text") {
      try {
        const parsed = JSON.parse(item.text);
        if (parsed.nodes && parsed.edges) return parsed;
      } catch {
        // not JSON
      }
    }
  }
  return null;
}

function handleHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    document.body.style.padding = `${ctx.safeAreaInsets.top}px ${ctx.safeAreaInsets.right}px ${ctx.safeAreaInsets.bottom}px ${ctx.safeAreaInsets.left}px`;
  }
}

const app = new App({ name: "Dependency Graph", version: "1.0.0" });

app.ontoolinput = (params) => {
  const container = document.getElementById("graph")!;
  container.innerHTML = '<p style="color:var(--color-text-secondary,#a3a3a3);padding:20px;">Loading graph...</p>';
};

app.ontoolresult = (result) => {
  const data = extractGraph(result);
  if (data && data.nodes.length > 0) {
    renderGraph(data);
  } else {
    const container = document.getElementById("graph")!;
    container.innerHTML = '<p style="color:var(--color-text-secondary,#a3a3a3);padding:20px;">No graph data available.</p>';
  }
};

app.onhostcontextchanged = handleHostContext;

app.onteardown = async () => ({});
app.onerror = console.error;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContext(ctx);
});
