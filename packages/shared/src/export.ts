import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import archiver from "archiver";
import StreamZip from "node-stream-zip";
import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type {
  Task,
  TaskComment,
  TaskLink,
  TaskHistory,
} from "./models/types.js";

// --- Types ---

export interface TaskWithExtras extends Task {
  comments: TaskComment[];
  links: TaskLink[];
  history: TaskHistory[];
}

export interface ExportTaskJson {
  exportVersion: number;
  project: string;
  tasks: Array<{
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
    parent_task_id: string | null;
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
      source_task_id: string;
      target_task_id: string;
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
  taskCount: number;
  warnings: string[];
}

// --- Safety limits for import ---

const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_ENTRY_SIZE = 256 * 1024 * 1024;
const MAX_DECOMPRESSED_SIZE = 512 * 1024 * 1024;

// --- Data gathering ---

export function gatherTaskData(
  projectDb: Database.Database,
): TaskWithExtras[] {
  const tasks = projectDb
    .prepare(
      "SELECT id, title, description, status, type, priority, estimate, actual, tags, parent_task_id, assignee, created_at, updated_at, completed_at, metadata FROM tasks ORDER BY created_at",
    )
    .all() as Task[];

  // Deduplicate links: since we query links for each task (both source and target),
  // the same link can appear on multiple tasks. Collect globally and attach once.
  const allLinks = projectDb
    .prepare(
      "SELECT id, source_task_id, target_task_id, link_type, created_at FROM task_links ORDER BY created_at",
    )
    .all() as TaskLink[];
  const linksByTask = new Map<string, TaskLink[]>();
  for (const link of allLinks) {
    // Attach to source task only (matches cloud export behavior: each link appears once per task)
    const list = linksByTask.get(link.source_task_id) ?? [];
    list.push(link);
    linksByTask.set(link.source_task_id, list);
  }

  return tasks.map((task) => {
    const parsedTask = {
      ...task,
      tags:
        typeof task.tags === "string"
          ? (JSON.parse(task.tags) as string[])
          : task.tags,
      metadata:
        typeof task.metadata === "string"
          ? (JSON.parse(task.metadata) as Record<string, unknown>)
          : task.metadata,
    };

    const comments = projectDb
      .prepare(
        "SELECT id, task_id, content, created_at, created_by FROM task_comments WHERE task_id = ? ORDER BY created_at",
      )
      .all(task.id) as TaskComment[];

    const links = linksByTask.get(task.id) ?? [];

    const history = projectDb
      .prepare(
        "SELECT id, task_id, field_changed, old_value, new_value, changed_at, changed_by FROM task_history WHERE task_id = ? ORDER BY changed_at",
      )
      .all(task.id) as TaskHistory[];

    return { ...parsedTask, comments, links, history };
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

function formatCommentsForCSV(comments: TaskComment[]): string {
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

export function tasksToCSV(tasks: TaskWithExtras[]): string {
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
    "parent_task_id",
    "created_at",
    "updated_at",
    "completed_at",
    "comments",
  ];

  const rows = tasks.map((t) =>
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
      escapeCSV(t.parent_task_id),
      escapeCSV(t.created_at),
      escapeCSV(t.updated_at),
      escapeCSV(t.completed_at),
      escapeCSV(formatCommentsForCSV(t.comments)),
    ].join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

export function tasksToJSON(
  tasks: TaskWithExtras[],
  projectName: string,
): ExportTaskJson {
  return {
    exportVersion: 1,
    project: projectName,
    tasks: tasks.map((t) => ({
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
      parent_task_id: t.parent_task_id,
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
        source_task_id: l.source_task_id,
        target_task_id: l.target_task_id,
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

  tasks-<project>.csv
    A CSV dump of all tasks in the project (all statuses). Columns:
    id, title, description, status, type, priority, estimate, actual,
    tags, assignee, parent_task_id, created_at, updated_at,
    completed_at, comments.
    Comments are formatted as "author (date): text" entries separated
    by newlines, so non-technical users can read them in Excel or
    Google Sheets.

  tasks-<project>.json
    The same task data as the CSV, but in JSON format with full
    structured data. Each task includes its comments, links to other
    tasks, and change history as nested arrays. This file is intended
    for machine consumption and programmatic import.

Export format version: 1
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
): Promise<{ taskCount: number }> {
  const tasks = gatherTaskData(projectDb);
  const slug = slugify(projectName);

  const archive = archiver("zip", { zlib: { level: 6 } });
  const output = createWriteStream(outputPath);
  archive.pipe(output);

  archive.append(README_CONTENT, { name: "README.txt" });
  archive.append(tasksToCSV(tasks), { name: `tasks-${slug}.csv` });
  archive.append(JSON.stringify(tasksToJSON(tasks, projectName), null, 2), {
    name: `tasks-${slug}.json`,
  });

  await archive.finalize();

  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });

  return { taskCount: tasks.length };
}

// --- Import ---

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function isValidUlid(id: string): boolean {
  return ULID_RE.test(id);
}

export function importTasksIntoDb(
  projectDb: Database.Database,
  tasks: ExportTaskJson["tasks"],
): { inserted: number; warnings: string[] } {
  const warnings: string[] = [];

  // Validate all IDs before inserting anything
  for (const task of tasks) {
    if (!isValidUlid(task.id)) {
      throw new Error(
        `Invalid task ID: "${task.id}". IDs must be valid ULIDs.`,
      );
    }
    if (task.parent_task_id && !isValidUlid(task.parent_task_id)) {
      throw new Error(
        `Invalid parent_task_id: "${task.parent_task_id}". IDs must be valid ULIDs.`,
      );
    }
    for (const c of task.comments ?? []) {
      if (c.id && !isValidUlid(c.id)) {
        throw new Error(
          `Invalid comment ID: "${c.id}". IDs must be valid ULIDs.`,
        );
      }
    }
    for (const l of task.links ?? []) {
      if (l.id && !isValidUlid(l.id)) {
        throw new Error(
          `Invalid link ID: "${l.id}". IDs must be valid ULIDs.`,
        );
      }
      if (!isValidUlid(l.source_task_id)) {
        throw new Error(
          `Invalid link source_task_id: "${l.source_task_id}". IDs must be valid ULIDs.`,
        );
      }
      if (!isValidUlid(l.target_task_id)) {
        throw new Error(
          `Invalid link target_task_id: "${l.target_task_id}". IDs must be valid ULIDs.`,
        );
      }
    }
    for (const h of task.history ?? []) {
      if (h.id && !isValidUlid(h.id)) {
        throw new Error(
          `Invalid history ID: "${h.id}". IDs must be valid ULIDs.`,
        );
      }
    }
  }

  const taskIds = new Set(tasks.map((t) => t.id));

  // Topological insert: parents before children
  const inserted = new Set<string>();
  const queue = [...tasks];
  let passes = 0;
  const maxPasses = tasks.length + 1;

  const insertTask = projectDb.prepare(
    `INSERT OR IGNORE INTO tasks (id, title, description, status, type, priority, estimate, actual, tags, parent_task_id, assignee, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertComment = projectDb.prepare(
    `INSERT OR IGNORE INTO task_comments (id, task_id, content, created_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertLink = projectDb.prepare(
    `INSERT OR IGNORE INTO task_links (id, source_task_id, target_task_id, link_type, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertHistory = projectDb.prepare(
    `INSERT OR IGNORE INTO task_history (id, task_id, field_changed, old_value, new_value, changed_at, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const runImport = projectDb.transaction(() => {
    while (queue.length > 0 && passes < maxPasses) {
      passes++;
      const remaining: ExportTaskJson["tasks"] = [];
      for (const task of queue) {
        const parentInExport =
          task.parent_task_id && taskIds.has(task.parent_task_id);
        const parentReady =
          !task.parent_task_id ||
          !parentInExport ||
          inserted.has(task.parent_task_id);
        if (parentReady) {
          insertTask.run(
            task.id,
            task.title,
            task.description ?? "",
            task.status ?? "open",
            task.type ?? "task",
            task.priority ?? "medium",
            task.estimate ?? null,
            task.actual ?? null,
            JSON.stringify(task.tags ?? []),
            parentInExport ? task.parent_task_id : null,
            null, // assignee — not portable between instances
            task.created_at,
            task.updated_at,
            task.completed_at ?? null,
            JSON.stringify(task.metadata ?? {}),
          );
          inserted.add(task.id);
        } else {
          remaining.push(task);
        }
      }
      queue.length = 0;
      queue.push(...remaining);
    }

    if (queue.length > 0) {
      warnings.push(
        `${queue.length} task(s) could not be imported due to unresolved parent references.`,
      );
    }

    // Insert comments, links, and history for all inserted tasks
    for (const task of tasks) {
      if (!inserted.has(task.id)) continue;

      for (const comment of task.comments ?? []) {
        insertComment.run(
          comment.id || ulid(),
          task.id,
          comment.content,
          comment.created_at,
          comment.created_by ?? "imported",
        );
      }

      for (const link of task.links ?? []) {
        if (inserted.has(link.source_task_id) && inserted.has(link.target_task_id)) {
          insertLink.run(
            link.id || ulid(),
            link.source_task_id,
            link.target_task_id,
            link.link_type,
            link.created_at,
          );
        }
      }

      for (const entry of task.history ?? []) {
        insertHistory.run(
          entry.id || ulid(),
          task.id,
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
    const taskFiles = entryNames.filter(
      (n) => n.startsWith("tasks-") && n.endsWith(".json"),
    );

    if (taskFiles.length === 0) {
      throw new Error(
        "No task data files (tasks-*.json) found in the archive.",
      );
    }

    const results: ImportResult[] = [];

    for (const taskFile of taskFiles) {
      const buf = await zip.entryData(taskFile);
      const taskData = JSON.parse(buf.toString("utf-8")) as ExportTaskJson;

      const projectName =
        taskData.project || taskFile.replace(/^tasks-/, "").replace(/\.json$/, "");

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
      const { inserted, warnings } = importTasksIntoDb(
        projectDb,
        taskData.tasks ?? [],
      );

      results.push({
        projectName: resolvedName,
        projectId,
        taskCount: inserted,
        warnings,
      });
    }

    return results;
  } finally {
    await zip.close();
  }
}
