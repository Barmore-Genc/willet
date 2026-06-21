// Markdown board and text dependency-tree renderers for the REST API. These
// mirror the shapes produced by the MCP viz tools (and the cloud server) so
// both surfaces honor the same OpenAPI contract. OSS has no project key
// prefixes, so the display id is the ULID suffix.

import type { GroupBy, Ticket, TicketLink } from "@willet/shared";

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
    default:
      return [];
  }
}

function displayId(t: Ticket): string {
  return t.id.slice(-8);
}

export function renderBoard(tickets: Ticket[], groupBy: GroupBy): string {
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
    lines.push("| ID | Title | Priority | Type | Estimate |");
    lines.push("|---|---|---|---|---|");
    for (const t of groupTickets) {
      lines.push(`| ${displayId(t)} | ${t.title} | ${t.priority} | ${t.type} | ${t.estimate ?? "-"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderDependencyGraphText(
  nodes: Ticket[],
  edges: TicketLink[],
  rootId: string,
): string {
  const ticketMap = new Map(nodes.map((t) => [t.id, t]));
  const adjacency = new Map<string, Array<{ ticketId: string; linkType: string; direction: string }>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source_ticket_id)) adjacency.set(edge.source_ticket_id, []);
    adjacency.get(edge.source_ticket_id)!.push({ ticketId: edge.target_ticket_id, linkType: edge.link_type, direction: "→" });
    if (!adjacency.has(edge.target_ticket_id)) adjacency.set(edge.target_ticket_id, []);
    adjacency.get(edge.target_ticket_id)!.push({ ticketId: edge.source_ticket_id, linkType: edge.link_type, direction: "←" });
  }

  const lines: string[] = [];
  const visited = new Set<string>();
  function walk(id: string, indent: number): void {
    if (visited.has(id)) return;
    visited.add(id);
    const ticket = ticketMap.get(id);
    if (!ticket) return;
    const prefix = "  ".repeat(indent);
    lines.push(`${prefix}${ticket.title} [${ticket.status}] (${displayId(ticket)})`);
    for (const n of adjacency.get(id) ?? []) {
      if (visited.has(n.ticketId)) continue;
      const neighbor = ticketMap.get(n.ticketId);
      if (!neighbor) continue;
      lines.push(
        `${prefix}  ${n.direction} ${n.linkType} ${n.direction === "→" ? "→" : "←"} ${neighbor.title} [${neighbor.status}] (${displayId(neighbor)})`,
      );
      walk(n.ticketId, indent + 2);
    }
  }
  walk(rootId, 0);
  if (lines.length === 0) {
    const ticket = ticketMap.get(rootId);
    if (ticket) {
      lines.push(`${ticket.title} [${ticket.status}] (${displayId(ticket)})`);
      lines.push("  (no links)");
    }
  }
  return lines.join("\n");
}
