import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import archiver from "archiver";
import StreamZip from "node-stream-zip";
import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type {
  Ticket,
  TicketComment,
  TicketLink,
  TicketHistory,
} from "./models/types.js";

// --- Types ---

export interface TicketWithExtras extends Ticket {
  comments: TicketComment[];
  links: TicketLink[];
  history: TicketHistory[];
}

export const EXPORT_VERSION = 2;
export const SUPPORTED_EXPORT_VERSIONS = [1, 2] as const;

export interface ExportTicketJson {
  exportVersion: number;
  project: string;
  tickets: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    type: string;
    priority: string;
    estimate: string | null;
    actual: string | null;
    tags: string[];
    assignee: string | null;
    parent_ticket_id: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    metadata: Record<string, unknown>;
    comments: Array<{
      id: string;
      content: string;
      created_at: string;
      created_by: string;
    }>;
    links: Array<{
      id: string;
      source_ticket_id: string;
      target_ticket_id: string;
      link_type: string;
      created_at: string;
    }>;
    history: Array<{
      id: string;
      field_changed: string;
      old_value: string | null;
      new_value: string | null;
      changed_at: string;
      changed_by: string;
    }>;
  }>;
}

export interface ImportResult {
  projectName: string;
  projectId: string;
  ticketCount: number;
  warnings: string[];
}

// --- Safety limits for import ---

const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_ENTRY_SIZE = 256 * 1024 * 1024;
const MAX_DECOMPRESSED_SIZE = 512 * 1024 * 1024;

// --- Data gathering ---

export function gatherTicketData(
  projectDb: Database.Database,
): TicketWithExtras[] {
  const tickets = projectDb
    .prepare(
      "SELECT id, title, description, status, type, priority, estimate, actual, tags, parent_ticket_id, assignee, created_at, updated_at, completed_at, metadata FROM tickets ORDER BY created_at",
    )
    .all() as Ticket[];

  // Deduplicate links: since we query links for each ticket (both source and target),
  // the same link can appear on multiple tickets. Collect globally and attach once.
  const allLinks = projectDb
    .prepare(
      "SELECT id, source_ticket_id, target_ticket_id, link_type, created_at FROM ticket_links ORDER BY created_at",
    )
    .all() as TicketLink[];
  const linksByTicket = new Map<string, TicketLink[]>();
  for (const link of allLinks) {
    // Attach to source ticket only (matches cloud export behavior: each link appears once per ticket)
    const list = linksByTicket.get(link.source_ticket_id) ?? [];
    list.push(link);
    linksByTicket.set(link.source_ticket_id, list);
  }

  return tickets.map((ticket) => {
    const parsedTicket = {
      ...ticket,
      tags:
        typeof ticket.tags === "string"
          ? (JSON.parse(ticket.tags) as string[])
          : ticket.tags,
      metadata:
        typeof ticket.metadata === "string"
          ? (JSON.parse(ticket.metadata) as Record<string, unknown>)
          : ticket.metadata,
    };

    const comments = projectDb
      .prepare(
        "SELECT id, ticket_id, content, created_at, created_by FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at",
      )
      .all(ticket.id) as TicketComment[];

    const links = linksByTicket.get(ticket.id) ?? [];

    const history = projectDb
      .prepare(
        "SELECT id, ticket_id, field_changed, old_value, new_value, changed_at, changed_by FROM ticket_history WHERE ticket_id = ? ORDER BY changed_at",
      )
      .all(ticket.id) as TicketHistory[];

    return { ...parsedTicket, comments, links, history };
  });
}

// --- CSV generation ---

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return "";
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCommentsForCSV(comments: TicketComment[]): string {
  if (comments.length === 0) return "";
  return comments
    .map((c) => {
      const date = new Date(c.created_at).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      return `${c.created_by} (${date}): ${c.content}`;
    })
    .join("\n");
}

export function ticketsToCSV(tickets: TicketWithExtras[]): string {
  const headers = [
    "id",
    "title",
    "description",
    "status",
    "type",
    "priority",
    "estimate",
    "actual",
    "tags",
    "assignee",
    "parent_ticket_id",
    "created_at",
    "updated_at",
    "completed_at",
    "comments",
  ];

  const rows = tickets.map((t) =>
    [
      escapeCSV(t.id),
      escapeCSV(t.title),
      escapeCSV(t.description),
      escapeCSV(t.status),
      escapeCSV(t.type),
      escapeCSV(t.priority),
      escapeCSV(t.estimate),
      escapeCSV(t.actual),
      escapeCSV(Array.isArray(t.tags) ? t.tags.join(", ") : ""),
      escapeCSV(t.assignee),
      escapeCSV(t.parent_ticket_id),
      escapeCSV(t.created_at),
      escapeCSV(t.updated_at),
      escapeCSV(t.completed_at),
      escapeCSV(formatCommentsForCSV(t.comments)),
    ].join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

export function ticketsToJSON(
  tickets: TicketWithExtras[],
  projectName: string,
): ExportTicketJson {
  return {
    exportVersion: EXPORT_VERSION,
    project: projectName,
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      type: t.type,
      priority: t.priority,
      estimate: t.estimate,
      actual: t.actual,
      tags: t.tags,
      assignee: t.assignee,
      parent_ticket_id: t.parent_ticket_id,
      created_at: t.created_at,
      updated_at: t.updated_at,
      completed_at: t.completed_at,
      metadata: t.metadata,
      comments: t.comments.map((c) => ({
        id: c.id,
        content: c.content,
        created_at: c.created_at,
        created_by: c.created_by,
      })),
      links: t.links.map((l) => ({
        id: l.id,
        source_ticket_id: l.source_ticket_id,
        target_ticket_id: l.target_ticket_id,
        link_type: l.link_type,
        created_at: l.created_at,
      })),
      history: t.history.map((h) => ({
        id: h.id,
        field_changed: h.field_changed,
        old_value: h.old_value,
        new_value: h.new_value,
        changed_at: h.changed_at,
        changed_by: h.changed_by,
      })),
    })),
  };
}

// --- README ---

const README_CONTENT = `Willet Data Export
==================

This archive contains a full export of your Willet project data.

Files included:

  tickets-<project>.csv
    A CSV dump of all tickets in the project (all statuses). Columns:
    id, title, description, status, type, priority, estimate, actual,
    tags, assignee, parent_ticket_id, created_at, updated_at,
    completed_at, comments.
    Comments are formatted as "author (date): text" entries separated
    by newlines, so non-technical users can read them in Excel or
    Google Sheets.

  tickets-<project>.json
    The same ticket data as the CSV, but in JSON format with full
    structured data. Each ticket includes its comments, links to other
    tickets, and change history as nested arrays. This file is intended
    for machine consumption and programmatic import.

Export format version: 2
Generated by: Willet
Documentation: https://github.com/SeriousBug/willet

This export format is compatible with Willet Cloud. You can import
this archive into any Willet instance (local, self-hosted, or cloud).
`;

// --- Export ---

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export async function exportProject(
  projectDb: Database.Database,
  projectName: string,
  outputPath: string,
): Promise<{ ticketCount: number }> {
  const tickets = gatherTicketData(projectDb);
  const slug = slugify(projectName);

  const archive = archiver("zip", { zlib: { level: 6 } });
  const output = createWriteStream(outputPath);
  archive.pipe(output);

  archive.append(README_CONTENT, { name: "README.txt" });
  archive.append(ticketsToCSV(tickets), { name: `tickets-${slug}.csv` });
  archive.append(JSON.stringify(ticketsToJSON(tickets, projectName), null, 2), {
    name: `tickets-${slug}.json`,
  });

  await archive.finalize();

  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });

  return { ticketCount: tickets.length };
}

// --- Import ---

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function isValidUlid(id: string): boolean {
  return ULID_RE.test(id);
}

// v1 export shape: top-level `tasks` array, `parent_task_id`/`source_task_id`/
// `target_task_id` field names, and the legacy `"task"` type value.
interface ExportTicketJsonV1 {
  exportVersion?: number;
  project?: string;
  tasks: Array<{
    id: string;
    title: string;
    description?: string;
    status?: string;
    type?: string;
    priority?: string;
    estimate?: string | null;
    actual?: string | null;
    tags?: string[];
    assignee?: string | null;
    parent_task_id?: string | null;
    created_at: string;
    updated_at: string;
    completed_at?: string | null;
    metadata?: Record<string, unknown>;
    comments?: Array<{
      id: string;
      content: string;
      created_at: string;
      created_by: string;
    }>;
    links?: Array<{
      id: string;
      source_task_id: string;
      target_task_id: string;
      link_type: string;
      created_at: string;
    }>;
    history?: Array<{
      id: string;
      field_changed: string;
      old_value: string | null;
      new_value: string | null;
      changed_at: string;
      changed_by: string;
    }>;
  }>;
}

function migrateV1ToV2(v1: ExportTicketJsonV1): ExportTicketJson {
  return {
    exportVersion: EXPORT_VERSION,
    project: v1.project ?? "",
    tickets: (v1.tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? "",
      status: t.status ?? "open",
      type: t.type === "task" ? "chore" : (t.type ?? "chore"),
      priority: t.priority ?? "medium",
      estimate: t.estimate ?? null,
      actual: t.actual ?? null,
      tags: t.tags ?? [],
      assignee: t.assignee ?? null,
      parent_ticket_id: t.parent_task_id ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at,
      completed_at: t.completed_at ?? null,
      metadata: t.metadata ?? {},
      comments: t.comments ?? [],
      links: (t.links ?? []).map((l) => ({
        id: l.id,
        source_ticket_id: l.source_task_id,
        target_ticket_id: l.target_task_id,
        link_type: l.link_type,
        created_at: l.created_at,
      })),
      history: t.history ?? [],
    })),
  };
}

// Normalize a parsed export payload to v2 shape. Throws on unknown/unsupported
// versions. Detects v1 either by `exportVersion: 1` or by the presence of a
// top-level `tasks` array (early exports omitted exportVersion entirely).
export function normalizeExportPayload(payload: unknown): ExportTicketJson {
  if (payload == null || typeof payload !== "object") {
    throw new Error("Export payload is not a JSON object.");
  }
  const p = payload as Record<string, unknown>;
  const version = typeof p.exportVersion === "number" ? p.exportVersion : undefined;

  if (version === 2) {
    return p as unknown as ExportTicketJson;
  }
  if (version === 1 || (version === undefined && Array.isArray(p.tasks))) {
    return migrateV1ToV2(p as unknown as ExportTicketJsonV1);
  }
  if (version === undefined) {
    throw new Error(
      "Export payload is missing exportVersion and has no recognizable shape.",
    );
  }
  throw new Error(
    `Unsupported export version: ${version}. Supported versions: ${SUPPORTED_EXPORT_VERSIONS.join(", ")}.`,
  );
}

export function importTicketsIntoDb(
  projectDb: Database.Database,
  tickets: ExportTicketJson["tickets"],
): { inserted: number; warnings: string[] } {
  const warnings: string[] = [];

  // Validate all IDs before inserting anything
  for (const ticket of tickets) {
    if (!isValidUlid(ticket.id)) {
      throw new Error(
        `Invalid ticket ID: "${ticket.id}". IDs must be valid ULIDs.`,
      );
    }
    if (ticket.parent_ticket_id && !isValidUlid(ticket.parent_ticket_id)) {
      throw new Error(
        `Invalid parent_ticket_id: "${ticket.parent_ticket_id}". IDs must be valid ULIDs.`,
      );
    }
    for (const c of ticket.comments ?? []) {
      if (c.id && !isValidUlid(c.id)) {
        throw new Error(
          `Invalid comment ID: "${c.id}". IDs must be valid ULIDs.`,
        );
      }
    }
    for (const l of ticket.links ?? []) {
      if (l.id && !isValidUlid(l.id)) {
        throw new Error(
          `Invalid link ID: "${l.id}". IDs must be valid ULIDs.`,
        );
      }
      if (!isValidUlid(l.source_ticket_id)) {
        throw new Error(
          `Invalid link source_ticket_id: "${l.source_ticket_id}". IDs must be valid ULIDs.`,
        );
      }
      if (!isValidUlid(l.target_ticket_id)) {
        throw new Error(
          `Invalid link target_ticket_id: "${l.target_ticket_id}". IDs must be valid ULIDs.`,
        );
      }
    }
    for (const h of ticket.history ?? []) {
      if (h.id && !isValidUlid(h.id)) {
        throw new Error(
          `Invalid history ID: "${h.id}". IDs must be valid ULIDs.`,
        );
      }
    }
  }

  const ticketIds = new Set(tickets.map((t) => t.id));

  // Topological insert: parents before children
  const inserted = new Set<string>();
  const queue = [...tickets];
  let passes = 0;
  const maxPasses = tickets.length + 1;

  const insertTicket = projectDb.prepare(
    `INSERT OR IGNORE INTO tickets (id, title, description, status, type, priority, estimate, actual, tags, parent_ticket_id, assignee, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertComment = projectDb.prepare(
    `INSERT OR IGNORE INTO ticket_comments (id, ticket_id, content, created_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertLink = projectDb.prepare(
    `INSERT OR IGNORE INTO ticket_links (id, source_ticket_id, target_ticket_id, link_type, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertHistory = projectDb.prepare(
    `INSERT OR IGNORE INTO ticket_history (id, ticket_id, field_changed, old_value, new_value, changed_at, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const runImport = projectDb.transaction(() => {
    while (queue.length > 0 && passes < maxPasses) {
      passes++;
      const remaining: ExportTicketJson["tickets"] = [];
      for (const ticket of queue) {
        const parentInExport =
          ticket.parent_ticket_id && ticketIds.has(ticket.parent_ticket_id);
        const parentReady =
          !ticket.parent_ticket_id ||
          !parentInExport ||
          inserted.has(ticket.parent_ticket_id);
        if (parentReady) {
          insertTicket.run(
            ticket.id,
            ticket.title,
            ticket.description ?? "",
            ticket.status ?? "open",
            ticket.type ?? "chore",
            ticket.priority ?? "medium",
            ticket.estimate ?? null,
            ticket.actual ?? null,
            JSON.stringify(ticket.tags ?? []),
            parentInExport ? ticket.parent_ticket_id : null,
            null, // assignee — not portable between instances
            ticket.created_at,
            ticket.updated_at,
            ticket.completed_at ?? null,
            JSON.stringify(ticket.metadata ?? {}),
          );
          inserted.add(ticket.id);
        } else {
          remaining.push(ticket);
        }
      }
      queue.length = 0;
      queue.push(...remaining);
    }

    if (queue.length > 0) {
      warnings.push(
        `${queue.length} ticket(s) could not be imported due to unresolved parent references.`,
      );
    }

    // Insert comments, links, and history for all inserted tickets
    for (const ticket of tickets) {
      if (!inserted.has(ticket.id)) continue;

      for (const comment of ticket.comments ?? []) {
        insertComment.run(
          comment.id || ulid(),
          ticket.id,
          comment.content,
          comment.created_at,
          comment.created_by ?? "imported",
        );
      }

      for (const link of ticket.links ?? []) {
        if (inserted.has(link.source_ticket_id) && inserted.has(link.target_ticket_id)) {
          insertLink.run(
            link.id || ulid(),
            link.source_ticket_id,
            link.target_ticket_id,
            link.link_type,
            link.created_at,
          );
        }
      }

      for (const entry of ticket.history ?? []) {
        insertHistory.run(
          entry.id || ulid(),
          ticket.id,
          entry.field_changed,
          entry.old_value ?? null,
          entry.new_value ?? null,
          entry.changed_at,
          entry.changed_by ?? "imported",
        );
      }
    }
  });

  runImport();

  return { inserted: inserted.size, warnings };
}

export async function importFromZip(
  zipPath: string,
  getProjectDb: (projectId: string) => Database.Database,
  initProject: (name: string, directory?: string) => { id: string; name: string },
  targetProjectId?: string,
): Promise<ImportResult[]> {
  const { statSync } = await import("node:fs");
  const stat = statSync(zipPath);
  if (stat.size > MAX_ZIP_SIZE) {
    throw new Error(
      `Zip file too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_ZIP_SIZE / 1024 / 1024} MB.`,
    );
  }

  const zip = new StreamZip.async({ file: zipPath });

  try {
    const entryCount = await zip.entriesCount;
    if (entryCount > MAX_ENTRIES) {
      throw new Error(
        `Zip contains too many entries (${entryCount}). Maximum is ${MAX_ENTRIES}.`,
      );
    }

    const entries = await zip.entries();
    let totalSize = 0;
    for (const entry of Object.values(entries)) {
      if (entry.size > MAX_ENTRY_SIZE) {
        throw new Error(
          `Entry "${entry.name}" is too large (${(entry.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_ENTRY_SIZE / 1024 / 1024} MB.`,
        );
      }
      totalSize += entry.size;
      if (totalSize > MAX_DECOMPRESSED_SIZE) {
        throw new Error(
          `Total decompressed size exceeds ${MAX_DECOMPRESSED_SIZE / 1024 / 1024} MB limit.`,
        );
      }
    }

    const entryNames = Object.keys(entries);
    // Accept both v2 (`tickets-*.json`) and v1 (`tasks-*.json`) data files.
    const ticketFiles = entryNames.filter(
      (n) =>
        (n.startsWith("tickets-") || n.startsWith("tasks-")) &&
        n.endsWith(".json"),
    );

    if (ticketFiles.length === 0) {
      throw new Error(
        "No ticket data files (tickets-*.json or tasks-*.json) found in the archive.",
      );
    }

    const results: ImportResult[] = [];

    for (const ticketFile of ticketFiles) {
      const buf = await zip.entryData(ticketFile);
      const rawPayload = JSON.parse(buf.toString("utf-8"));
      const ticketData = normalizeExportPayload(rawPayload);

      const projectName =
        ticketData.project ||
        ticketFile
          .replace(/^tickets-/, "")
          .replace(/^tasks-/, "")
          .replace(/\.json$/, "");

      let projectId: string;
      let resolvedName: string;

      if (targetProjectId) {
        projectId = targetProjectId;
        resolvedName = projectName;
      } else {
        const project = initProject(projectName);
        projectId = project.id;
        resolvedName = project.name;
      }

      const projectDb = getProjectDb(projectId);
      const { inserted, warnings } = importTicketsIntoDb(
        projectDb,
        ticketData.tickets ?? [],
      );

      results.push({
        projectName: resolvedName,
        projectId,
        ticketCount: inserted,
        warnings,
      });
    }

    return results;
  } finally {
    await zip.close();
  }
}
