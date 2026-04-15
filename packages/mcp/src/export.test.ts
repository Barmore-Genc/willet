import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ulid } from "ulid";
import StreamZip from "node-stream-zip";
import { applySchema } from "@willet/shared/dist/db/schema.js";
import {
  gatherTaskData,
  tasksToCSV,
  tasksToJSON,
  exportProject,
  importTasksIntoDb,
  importFromZip,
} from "@willet/shared";
import type { ExportTaskJson } from "@willet/shared";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

function insertTask(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    title: string;
    description: string;
    status: string;
    type: string;
    priority: string;
    estimate: string | null;
    actual: string | null;
    tags: string;
    parent_task_id: string | null;
    assignee: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    metadata: string;
  }> = {},
) {
  const now = new Date().toISOString();
  const defaults = {
    id: ulid(),
    title: "Test task",
    description: "A test task",
    status: "open",
    type: "task",
    priority: "medium",
    estimate: null,
    actual: null,
    tags: "[]",
    parent_task_id: null,
    assignee: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    metadata: "{}",
  };
  const task = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, type, priority, estimate, actual, tags, parent_task_id, assignee, created_at, updated_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    task.id,
    task.title,
    task.description,
    task.status,
    task.type,
    task.priority,
    task.estimate,
    task.actual,
    task.tags,
    task.parent_task_id,
    task.assignee,
    task.created_at,
    task.updated_at,
    task.completed_at,
    task.metadata,
  );
  return task;
}

function insertComment(
  db: Database.Database,
  taskId: string,
  content: string,
  createdBy = "testuser",
) {
  const commentId = ulid();
  db.prepare(
    `INSERT INTO task_comments (id, task_id, content, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
  ).run(commentId, taskId, content, new Date().toISOString(), createdBy);
  return commentId;
}

function insertLink(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  linkType = "blocks",
) {
  const linkId = ulid();
  db.prepare(
    `INSERT INTO task_links (id, source_task_id, target_task_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(linkId, sourceId, targetId, linkType, new Date().toISOString());
  return linkId;
}

function insertHistory(
  db: Database.Database,
  taskId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  changedBy = "testuser",
) {
  const histId = ulid();
  db.prepare(
    `INSERT INTO task_history (id, task_id, field_changed, old_value, new_value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(histId, taskId, field, oldValue, newValue, new Date().toISOString(), changedBy);
  return histId;
}

describe("gatherTaskData", () => {
  it("should gather tasks with comments, links, and history", () => {
    const db = createTestDb();
    const task1 = insertTask(db, {
      id: "01JTASK1AAAAAAAAAAAAAAAA00",
      title: "Task one",
      tags: '["backend","api"]',
    });
    const task2 = insertTask(db, {
      id: "01JTASK2AAAAAAAAAAAAAAAA00",
      title: "Task two",
    });

    insertComment(db, task1.id, "First comment");
    insertComment(db, task1.id, "Second comment");
    insertLink(db, task1.id, task2.id, "blocks");
    insertHistory(db, task1.id, "status", "open", "in_progress");

    const tasks = gatherTaskData(db);
    expect(tasks).toHaveLength(2);

    const t1 = tasks.find((t) => t.id === task1.id)!;
    expect(t1.title).toBe("Task one");
    expect(t1.tags).toEqual(["backend", "api"]);
    expect(t1.comments).toHaveLength(2);
    expect(t1.links).toHaveLength(1);
    expect(t1.links[0].link_type).toBe("blocks");
    expect(t1.history).toHaveLength(1);
    expect(t1.history[0].field_changed).toBe("status");

    const t2 = tasks.find((t) => t.id === task2.id)!;
    expect(t2.comments).toHaveLength(0);
    // Links are only attached to the source task
    expect(t2.links).toHaveLength(0);

    db.close();
  });
});

describe("tasksToCSV", () => {
  it("should produce valid CSV with headers and escaped content", () => {
    const db = createTestDb();
    const task = insertTask(db, {
      id: "01JTASK1AAAAAAAAAAAAAAAA00",
      title: 'Task with "quotes"',
      description: "Line1\nLine2",
      tags: '["tag1","tag2"]',
      assignee: "alice",
    });
    insertComment(db, task.id, "A comment");

    const tasks = gatherTaskData(db);
    const csv = tasksToCSV(tasks);

    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,title,description,status,type,priority,estimate,actual,tags,assignee,parent_task_id,created_at,updated_at,completed_at,comments",
    );
    // Should contain escaped quotes
    expect(csv).toContain('""quotes""');
    db.close();
  });
});

describe("tasksToJSON", () => {
  it("should produce correct JSON structure", () => {
    const db = createTestDb();
    const task = insertTask(db, {
      id: "01JTASK1AAAAAAAAAAAAAAAA00",
      title: "Test task",
      metadata: '{"key":"value"}',
    });
    insertComment(db, task.id, "A comment");

    const tasks = gatherTaskData(db);
    const json = tasksToJSON(tasks, "test-project");

    expect(json.exportVersion).toBe(1);
    expect(json.project).toBe("test-project");
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].title).toBe("Test task");
    expect(json.tasks[0].metadata).toEqual({ key: "value" });
    expect(json.tasks[0].comments).toHaveLength(1);
    expect(json.tasks[0].comments[0].content).toBe("A comment");
    db.close();
  });
});

describe("importTasksIntoDb", () => {
  it("should import tasks with all related data", () => {
    const db = createTestDb();
    const tasks: ExportTaskJson["tasks"] = [
      {
        id: "01JTASK1AAAAAAAAAAAAAAAA00",
        title: "Imported task",
        description: "Desc",
        status: "in_progress",
        type: "bug",
        priority: "high",
        estimate: "3",
        actual: null,
        tags: ["import", "test"],
        assignee: "alice",
        parent_task_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-02T00:00:00.000Z",
        completed_at: null,
        metadata: { source: "cloud" },
        comments: [
          {
            id: "01JCMT10AAAAAAAAAAAAAA0000",
            content: "A comment",
            created_at: "2025-01-01T12:00:00.000Z",
            created_by: "alice",
          },
        ],
        links: [],
        history: [
          {
            id: "01JHST1AAAAAAAAAAAAAAA0000",
            field_changed: "status",
            old_value: "open",
            new_value: "in_progress",
            changed_at: "2025-01-02T00:00:00.000Z",
            changed_by: "alice",
          },
        ],
      },
    ];

    const { inserted, warnings } = importTasksIntoDb(db, tasks);
    expect(inserted).toBe(1);
    expect(warnings).toHaveLength(0);

    // Verify task
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(tasks[0].id) as Record<string, unknown>;
    expect(row.title).toBe("Imported task");
    expect(row.status).toBe("in_progress");
    expect(row.type).toBe("bug");
    expect(row.priority).toBe("high");
    expect(row.assignee).toBeNull(); // assignee is discarded

    // Verify comment
    const comments = db.prepare("SELECT * FROM task_comments WHERE task_id = ?").all(tasks[0].id) as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe("A comment");

    // Verify history
    const history = db.prepare("SELECT * FROM task_history WHERE task_id = ?").all(tasks[0].id) as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0].field_changed).toBe("status");

    db.close();
  });

  it("should handle parent-child relationships in topological order", () => {
    const db = createTestDb();
    // Put child before parent in array to test topological sorting
    const tasks: ExportTaskJson["tasks"] = [
      {
        id: "01JCH001AAAAAAAAAAAAAAAA00",
        title: "Child task",
        description: "",
        status: "open",
        type: "task",
        priority: "medium",
        estimate: null,
        actual: null,
        tags: [],
        assignee: null,
        parent_task_id: "01JPRNT1AAAAAAAAAAAAAAAA00",
        created_at: "2025-01-02T00:00:00.000Z",
        updated_at: "2025-01-02T00:00:00.000Z",
        completed_at: null,
        metadata: {},
        comments: [],
        links: [],
        history: [],
      },
      {
        id: "01JPRNT1AAAAAAAAAAAAAAAA00",
        title: "Parent task",
        description: "",
        status: "open",
        type: "task",
        priority: "medium",
        estimate: null,
        actual: null,
        tags: [],
        assignee: null,
        parent_task_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
        completed_at: null,
        metadata: {},
        comments: [],
        links: [],
        history: [],
      },
    ];

    const { inserted } = importTasksIntoDb(db, tasks);
    expect(inserted).toBe(2);

    const child = db.prepare("SELECT * FROM tasks WHERE id = ?").get("01JCH001AAAAAAAAAAAAAAAA00") as Record<string, unknown>;
    expect(child.parent_task_id).toBe("01JPRNT1AAAAAAAAAAAAAAAA00");

    db.close();
  });

  it("should handle links between tasks", () => {
    const db = createTestDb();
    const tasks: ExportTaskJson["tasks"] = [
      {
        id: "01JTASK1AAAAAAAAAAAAAAAA00",
        title: "Source",
        description: "",
        status: "open",
        type: "task",
        priority: "medium",
        estimate: null,
        actual: null,
        tags: [],
        assignee: null,
        parent_task_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
        completed_at: null,
        metadata: {},
        comments: [],
        links: [
          {
            id: "01J0NK1AAAAAAAAAAAAAAAA000",
            source_task_id: "01JTASK1AAAAAAAAAAAAAAAA00",
            target_task_id: "01JTASK2AAAAAAAAAAAAAAAA00",
            link_type: "blocks",
            created_at: "2025-01-01T00:00:00.000Z",
          },
        ],
        history: [],
      },
      {
        id: "01JTASK2AAAAAAAAAAAAAAAA00",
        title: "Target",
        description: "",
        status: "open",
        type: "task",
        priority: "medium",
        estimate: null,
        actual: null,
        tags: [],
        assignee: null,
        parent_task_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
        completed_at: null,
        metadata: {},
        comments: [],
        links: [],
        history: [],
      },
    ];

    const { inserted } = importTasksIntoDb(db, tasks);
    expect(inserted).toBe(2);

    const links = db.prepare("SELECT * FROM task_links").all() as Array<Record<string, unknown>>;
    expect(links).toHaveLength(1);
    expect(links[0].source_task_id).toBe("01JTASK1AAAAAAAAAAAAAAAA00");
    expect(links[0].target_task_id).toBe("01JTASK2AAAAAAAAAAAAAAAA00");
    expect(links[0].link_type).toBe("blocks");

    db.close();
  });

  it("should reject invalid ULIDs", () => {
    const db = createTestDb();
    const tasks: ExportTaskJson["tasks"] = [
      {
        id: "not-a-ulid",
        title: "Bad task",
        description: "",
        status: "open",
        type: "task",
        priority: "medium",
        estimate: null,
        actual: null,
        tags: [],
        assignee: null,
        parent_task_id: null,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
        completed_at: null,
        metadata: {},
        comments: [],
        links: [],
        history: [],
      },
    ];

    expect(() => importTasksIntoDb(db, tasks)).toThrow("Invalid task ID");
    db.close();
  });
});

describe("full export/import round-trip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "willet-export-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should preserve all data through export and import", async () => {
    // Create source database with rich data
    const sourceDb = createTestDb();

    const parentTask = insertTask(sourceDb, {
      id: "01JPRNT1AAAAAAAAAAAAAAAA00",
      title: "Epic: Redesign",
      description: "Full UI redesign project",
      status: "in_progress",
      type: "epic",
      priority: "high",
      estimate: "20",
      tags: '["design","frontend"]',
      assignee: "alice",
      metadata: '{"sprint":5}',
    });

    const childTask1 = insertTask(sourceDb, {
      id: "01JCHX1AAAAAAAAAAAAAAAA000",
      title: "Design mockups",
      description: "Create mockups in Figma",
      status: "done",
      type: "task",
      priority: "high",
      estimate: "5",
      actual: "4",
      tags: '["design"]',
      parent_task_id: parentTask.id,
      assignee: "bob",
      completed_at: "2025-01-10T00:00:00.000Z",
    });

    const childTask2 = insertTask(sourceDb, {
      id: "01JCHX2AAAAAAAAAAAAAAAA000",
      title: "Implement components",
      description: "Build React components",
      status: "open",
      type: "feature",
      priority: "medium",
      tags: '["frontend","react"]',
      parent_task_id: parentTask.id,
    });

    const standaloneTask = insertTask(sourceDb, {
      id: "01JSTNX1AAAAAAAAAAAAAAAA00",
      title: "Fix login bug",
      description: "Users can't login with OAuth",
      status: "cancelled",
      type: "bug",
      priority: "urgent",
      metadata: '{"browser":"chrome"}',
    });

    // Add comments
    insertComment(sourceDb, parentTask.id, "Kickoff meeting done", "alice");
    insertComment(sourceDb, parentTask.id, "Deadline moved to Q2", "bob");
    insertComment(sourceDb, childTask1.id, "Mockups approved", "alice");

    // Add links
    insertLink(sourceDb, childTask1.id, childTask2.id, "blocks");
    insertLink(sourceDb, standaloneTask.id, parentTask.id, "relates_to");

    // Add history
    insertHistory(sourceDb, parentTask.id, "status", "open", "in_progress", "alice");
    insertHistory(sourceDb, childTask1.id, "status", "open", "in_progress", "bob");
    insertHistory(sourceDb, childTask1.id, "status", "in_progress", "done", "bob");
    insertHistory(sourceDb, standaloneTask.id, "status", "open", "cancelled", "alice");

    // Export
    const zipPath = join(tmpDir, "export.zip");
    const { taskCount } = await exportProject(sourceDb, "test-project", zipPath);
    expect(taskCount).toBe(4);
    expect(existsSync(zipPath)).toBe(true);

    // Verify zip contents
    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();
    const entryNames = Object.keys(entries);
    expect(entryNames).toContain("README.txt");
    expect(entryNames).toContain("tasks-test-project.csv");
    expect(entryNames).toContain("tasks-test-project.json");

    // Read and verify JSON
    const jsonBuf = await zip.entryData("tasks-test-project.json");
    const taskJson = JSON.parse(jsonBuf.toString("utf-8")) as ExportTaskJson;
    expect(taskJson.exportVersion).toBe(1);
    expect(taskJson.project).toBe("test-project");
    expect(taskJson.tasks).toHaveLength(4);

    // Verify CSV has all tasks
    const csvBuf = await zip.entryData("tasks-test-project.csv");
    const csvLines = csvBuf.toString("utf-8").split("\n");
    // CSV has at least header + 4 tasks; may have more lines due to
    // newlines inside quoted comment fields
    expect(csvLines.length).toBeGreaterThanOrEqual(5);
    await zip.close();

    // Import into a fresh database
    const targetDb = createTestDb();
    const { inserted, warnings } = importTasksIntoDb(targetDb, taskJson.tasks);
    expect(inserted).toBe(4);
    expect(warnings).toHaveLength(0);

    // Verify all tasks were imported
    const importedTasks = targetDb.prepare("SELECT * FROM tasks ORDER BY created_at").all() as Array<Record<string, unknown>>;
    expect(importedTasks).toHaveLength(4);

    // Verify parent task
    const importedParent = importedTasks.find((t) => t.id === parentTask.id)!;
    expect(importedParent.title).toBe("Epic: Redesign");
    expect(importedParent.description).toBe("Full UI redesign project");
    expect(importedParent.status).toBe("in_progress");
    expect(importedParent.type).toBe("epic");
    expect(importedParent.priority).toBe("high");
    expect(importedParent.estimate).toBe("20");
    expect(JSON.parse(importedParent.tags as string)).toEqual(["design", "frontend"]);
    expect(importedParent.assignee).toBeNull(); // discarded
    expect(JSON.parse(importedParent.metadata as string)).toEqual({ sprint: 5 });

    // Verify child with parent reference
    const importedChild1 = importedTasks.find((t) => t.id === childTask1.id)!;
    expect(importedChild1.parent_task_id).toBe(parentTask.id);
    expect(importedChild1.status).toBe("done");
    expect(importedChild1.actual).toBe("4");
    expect(importedChild1.completed_at).toBe("2025-01-10T00:00:00.000Z");

    // Verify child2
    const importedChild2 = importedTasks.find((t) => t.id === childTask2.id)!;
    expect(importedChild2.parent_task_id).toBe(parentTask.id);
    expect(importedChild2.type).toBe("feature");

    // Verify standalone
    const importedStandalone = importedTasks.find((t) => t.id === standaloneTask.id)!;
    expect(importedStandalone.status).toBe("cancelled");
    expect(importedStandalone.type).toBe("bug");
    expect(importedStandalone.priority).toBe("urgent");

    // Verify comments
    const allComments = targetDb.prepare("SELECT * FROM task_comments ORDER BY created_at").all() as Array<Record<string, unknown>>;
    expect(allComments).toHaveLength(3);
    const parentComments = allComments.filter((c) => c.task_id === parentTask.id);
    expect(parentComments).toHaveLength(2);
    expect(parentComments.map((c) => c.content)).toContain("Kickoff meeting done");
    expect(parentComments.map((c) => c.content)).toContain("Deadline moved to Q2");

    // Verify links
    const allLinks = targetDb.prepare("SELECT * FROM task_links ORDER BY created_at").all() as Array<Record<string, unknown>>;
    expect(allLinks).toHaveLength(2);
    const blocksLink = allLinks.find((l) => l.link_type === "blocks")!;
    expect(blocksLink.source_task_id).toBe(childTask1.id);
    expect(blocksLink.target_task_id).toBe(childTask2.id);
    const relatesToLink = allLinks.find((l) => l.link_type === "relates_to")!;
    expect(relatesToLink.source_task_id).toBe(standaloneTask.id);
    expect(relatesToLink.target_task_id).toBe(parentTask.id);

    // Verify history
    const allHistory = targetDb.prepare("SELECT * FROM task_history ORDER BY changed_at").all() as Array<Record<string, unknown>>;
    expect(allHistory).toHaveLength(4);
    const parentHistory = allHistory.filter((h) => h.task_id === parentTask.id);
    expect(parentHistory).toHaveLength(1);
    expect(parentHistory[0].field_changed).toBe("status");
    expect(parentHistory[0].old_value).toBe("open");
    expect(parentHistory[0].new_value).toBe("in_progress");

    sourceDb.close();
    targetDb.close();
  });

  it("should export and re-import via zip file", async () => {
    // Create source database
    const sourceDb = createTestDb();

    insertTask(sourceDb, {
      id: "01JTASK1AAAAAAAAAAAAAAAA00",
      title: "Task A",
      tags: '["tag1"]',
    });
    insertTask(sourceDb, {
      id: "01JTASK2AAAAAAAAAAAAAAAA00",
      title: "Task B",
      priority: "high",
    });
    insertComment(sourceDb, "01JTASK1AAAAAAAAAAAAAAAA00", "Comment on A");
    insertLink(
      sourceDb,
      "01JTASK1AAAAAAAAAAAAAAAA00",
      "01JTASK2AAAAAAAAAAAAAAAA00",
      "relates_to",
    );

    // Export
    const zipPath = join(tmpDir, "roundtrip.zip");
    await exportProject(sourceDb, "round-trip-project", zipPath);

    // Import using the zip import function
    let createdProjectId = "";
    const targetDb = createTestDb();
    const results = await importFromZip(
      zipPath,
      (_projectId: string) => {
        createdProjectId = _projectId;
        return targetDb;
      },
      (name: string) => {
        return { id: ulid(), name };
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0].taskCount).toBe(2);
    expect(results[0].projectName).toBe("round-trip-project");

    // Verify data
    const tasks = targetDb.prepare("SELECT * FROM tasks").all() as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(2);

    const comments = targetDb.prepare("SELECT * FROM task_comments").all() as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe("Comment on A");

    const links = targetDb.prepare("SELECT * FROM task_links").all() as Array<Record<string, unknown>>;
    expect(links).toHaveLength(1);
    expect(links[0].link_type).toBe("relates_to");

    sourceDb.close();
    targetDb.close();
  });

  it("should handle empty project export/import", async () => {
    const sourceDb = createTestDb();
    const zipPath = join(tmpDir, "empty.zip");
    const { taskCount } = await exportProject(sourceDb, "empty-project", zipPath);
    expect(taskCount).toBe(0);

    const targetDb = createTestDb();
    const results = await importFromZip(
      zipPath,
      () => targetDb,
      (name) => ({ id: ulid(), name }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].taskCount).toBe(0);

    sourceDb.close();
    targetDb.close();
  });

  it("should import from cloud export format (with organization field)", async () => {
    // The cloud export has an "organization" field in the JSON; OSS export
    // doesn't. Import should handle both.
    const sourceDb = createTestDb();
    insertTask(sourceDb, {
      id: "01JTASK1AAAAAAAAAAAAAAAA00",
      title: "Cloud task",
    });

    // Export
    const zipPath = join(tmpDir, "cloud-compat.zip");
    await exportProject(sourceDb, "cloud-project", zipPath);

    // Verify there's no "organization" field in OSS export
    const zip = new StreamZip.async({ file: zipPath });
    const buf = await zip.entryData("tasks-cloud-project.json");
    const json = JSON.parse(buf.toString("utf-8"));
    // OSS export should not have organization field
    expect(json).not.toHaveProperty("organization");
    await zip.close();

    // Import should still work
    const targetDb = createTestDb();
    const results = await importFromZip(
      zipPath,
      () => targetDb,
      (name) => ({ id: "01JC00XXXXXAAAAAAAAAAAAA00", name }),
    );
    expect(results[0].taskCount).toBe(1);

    sourceDb.close();
    targetDb.close();
  });

  it("should preserve task IDs exactly through round-trip", async () => {
    const sourceDb = createTestDb();
    const originalIds = [
      "01JTASK1AAAAAAAAAAAAAAAA00",
      "01JTASK2BBBBBBBBBBBBBBBBBB",
      "01JTASK3CCCCCCCCCCCCCCCCCC",
    ];

    for (const id of originalIds) {
      insertTask(sourceDb, { id, title: `Task ${id}` });
    }

    const zipPath = join(tmpDir, "ids.zip");
    await exportProject(sourceDb, "id-project", zipPath);

    const targetDb = createTestDb();
    await importFromZip(
      zipPath,
      () => targetDb,
      (name) => ({ id: "01JPR0XXXXXAAAAAAAAAAAAA00", name }),
    );

    const importedIds = (
      targetDb.prepare("SELECT id FROM tasks ORDER BY id").all() as Array<{ id: string }>
    ).map((r) => r.id);
    expect(importedIds.sort()).toEqual(originalIds.sort());

    sourceDb.close();
    targetDb.close();
  });
});
