import { describe, it, expect } from "vitest";
import {
  projectTask,
  projectTasks,
  type Task,
  type ToolOptions,
} from "@willet/shared/dist/models/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "01HTEST0000000000000000000",
    title: "Short title",
    description: "A short description.",
    status: "open",
    type: "task",
    priority: "medium",
    estimate: null,
    actual: null,
    tags: [],
    parent_task_id: null,
    assignee: null,
    due_date: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    metadata: {},
    ...overrides,
  };
}

const selfhosted: ToolOptions = { mode: "selfhosted" };
const local: ToolOptions = { mode: "local" };

describe("projectTask — short", () => {
  it("returns only the short-mode fields", () => {
    const task = makeTask({
      assignee: "alice",
      tags: ["a", "b"],
      estimate: "2h",
      due_date: "2026-05-01",
    });
    const out = projectTask(task, "short", selfhosted);
    expect(Object.keys(out).sort()).toEqual(
      ["assignee", "due_date", "estimate", "id", "priority", "status", "tags", "title", "type"].sort(),
    );
    expect(out.assignee).toBe("alice");
    expect(out.estimate).toBe("2h");
  });

  it("omits assignee in local mode", () => {
    const task = makeTask({ assignee: "alice" });
    const out = projectTask(task, "short", local);
    expect(out).not.toHaveProperty("assignee");
  });

  it("truncates long titles and takes only the first line", () => {
    const long = "A".repeat(200);
    const multi = `first line\nsecond line`;
    expect((projectTask(makeTask({ title: long }), "short", selfhosted).title as string).length).toBeLessThanOrEqual(80);
    expect(projectTask(makeTask({ title: multi }), "short", selfhosted).title).toBe("first line");
  });

  it("truncates tags to 5", () => {
    const tags = ["a", "b", "c", "d", "e", "f", "g"];
    expect(projectTask(makeTask({ tags }), "short", selfhosted).tags).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("excludes description, metadata, timestamps", () => {
    const out = projectTask(makeTask({ description: "body", metadata: { k: 1 } }), "short", selfhosted);
    expect(out).not.toHaveProperty("description");
    expect(out).not.toHaveProperty("metadata");
    expect(out).not.toHaveProperty("created_at");
    expect(out).not.toHaveProperty("updated_at");
  });
});

describe("projectTask — detailed", () => {
  it("returns all fields with description truncated", () => {
    const longDesc = "x".repeat(500);
    const out = projectTask(makeTask({ description: longDesc }), "detailed", selfhosted);
    expect((out.description as string).length).toBeLessThanOrEqual(200);
    expect((out.description as string).endsWith("…")).toBe(true);
    expect(out).toHaveProperty("created_at");
    expect(out).toHaveProperty("metadata");
  });

  it("leaves short descriptions untouched", () => {
    const out = projectTask(makeTask({ description: "short desc" }), "detailed", selfhosted);
    expect(out.description).toBe("short desc");
  });

  it("strips assignee in local mode", () => {
    const out = projectTask(makeTask({ assignee: "alice" }), "detailed", local);
    expect(out).not.toHaveProperty("assignee");
  });
});

describe("projectTask — full", () => {
  it("returns the task unchanged in selfhosted mode", () => {
    const task = makeTask({ description: "y".repeat(500), title: "z".repeat(200) });
    const out = projectTask(task, "full", selfhosted);
    expect(out.description).toBe(task.description);
    expect(out.title).toBe(task.title);
  });

  it("strips assignee in local mode", () => {
    const out = projectTask(makeTask({ assignee: "alice" }), "full", local);
    expect(out).not.toHaveProperty("assignee");
  });
});

describe("projectTasks", () => {
  it("preserves score from search results", () => {
    const withScore = { ...makeTask(), score: 0.87 };
    const out = projectTasks([withScore], "short", selfhosted);
    expect(out[0].score).toBe(0.87);
  });

  it("omits score when not present", () => {
    const out = projectTasks([makeTask()], "short", selfhosted);
    expect(out[0]).not.toHaveProperty("score");
  });
});
