// Human-readable rendering for command output (the default when `--json` is
// not passed). Kept deliberately compact and pipe-friendly: one record per line
// where it makes sense, tab-separated, so `willet ... | awk` stays easy.

type Rec = Record<string, unknown>;

function str(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** A one-line ticket summary: id/key, status, priority, title. */
export function ticketLine(t: Rec): string {
  const id = t.key ?? t.id;
  return [str(id), str(t.status), str(t.priority), str(t.title)].join("\t");
}

/** Multi-line detail view of a single ticket. */
export function ticketDetail(t: Rec): string {
  const lines: string[] = [];
  const id = t.key ?? t.id;
  lines.push(`${str(id)}  ${str(t.title)}`);
  for (const f of ["status", "type", "priority", "estimate", "actual", "assignee", "due_date"]) {
    if (t[f] !== undefined) lines.push(`  ${f}: ${str(t[f])}`);
  }
  if (Array.isArray(t.tags) && t.tags.length) lines.push(`  tags: ${(t.tags as unknown[]).join(", ")}`);
  if (typeof t.description === "string" && t.description) lines.push(`\n${t.description}`);
  const comments = t.comments as Rec[] | undefined;
  if (comments?.length) {
    lines.push(`\nComments (${comments.length}):`);
    for (const c of comments) lines.push(`  - ${str(c.content)}`);
  }
  const links = t.links as Rec[] | undefined;
  if (links?.length) {
    lines.push(`\nLinks (${links.length}):`);
    for (const l of links) lines.push(`  ${str(l.link_type)}: ${str(l.source_ticket_id)} -> ${str(l.target_ticket_id)}`);
  }
  return lines.join("\n");
}

/** Render `{ tickets, total }` or a bare ticket array as one line each. */
export function ticketList(data: { tickets?: Rec[]; total?: number } | Rec[]): string {
  const tickets = Array.isArray(data) ? data : (data.tickets ?? []);
  const total = Array.isArray(data) ? data.length : (data.total ?? tickets.length);
  if (tickets.length === 0) return "No tickets.";
  return [...tickets.map(ticketLine), `\n${tickets.length} of ${total}`].join("\n");
}

/** Render `{ count, <key>: [...] }` collections (orgs, projects, members, repos). */
export function collection(key: string, line: (item: Rec) => string) {
  return (data: Rec): string => {
    const items = (data[key] as Rec[] | undefined) ?? [];
    if (items.length === 0) return `No ${key}.`;
    return [...items.map(line), `\n${items.length} ${key}`].join("\n");
  };
}

/** Pretty-print a flat object as `key: value` lines. */
export function record(data: Rec): string {
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${str(v)}`)
    .join("\n");
}

export const orgLine = (o: Rec): string => [str(o.slug), str(o.name), str(o.role ?? o.plan)].join("\t");
export const projectLine = (p: Rec): string => [str(p.slug), str(p.name), str(p.keyPrefix)].join("\t");
export const memberLine = (m: Rec): string => [str(m.userId), str(m.role), str(m.email)].join("\t");
export const repoLine = (r: Rec): string => [str(r.id), str(r.fullName ?? `${str(r.owner)}/${str(r.repo)}`)].join("\t");
export const commentLine = (c: Rec): string => `${str(c.id)}: ${str(c.content)}`;
export const linkLine = (l: Rec): string => `${str(l.link_type)}: ${str(l.source_ticket_id)} -> ${str(l.target_ticket_id)}`;
export const tagLine = (t: Rec): string => `${str(t.tag)}\t${str(t.count)}`;

/** Stats object → grouped counts. */
export function stats(s: Rec): string {
  const group = (label: string, obj: unknown): string => {
    const entries = obj && typeof obj === "object" ? Object.entries(obj as Rec) : [];
    return `${label}: ${entries.map(([k, v]) => `${k}=${str(v)}`).join(" ")}`;
  };
  return [
    `total: ${str(s.total)}`,
    group("byStatus", s.byStatus),
    group("byType", s.byType),
    group("byPriority", s.byPriority),
  ].join("\n");
}

export const tagList = (tags: Rec[]): string => (tags.length ? tags.map(tagLine).join("\n") : "No tags.");
export const board = (b: { board?: unknown }): string => str(b.board);
export const dependencyGraph = (g: { text?: unknown }): string => str(g.text);
export const graph = (g: { nodes?: Rec[]; edges?: Rec[] }): string => {
  const nodes = g.nodes ?? [];
  const edges = g.edges ?? [];
  return [
    `Nodes (${nodes.length}):`,
    ...nodes.map((n) => `  ${ticketLine(n)}`),
    `Edges (${edges.length}):`,
    ...edges.map((e) => `  ${linkLine(e)}`),
  ].join("\n");
};
