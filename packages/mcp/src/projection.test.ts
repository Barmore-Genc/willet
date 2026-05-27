import { describe, it, expect } from "vitest";
import {
  projectTicket,
  projectTickets,
  type Ticket,
  type ToolOptions,
} from "@willet/shared/dist/models/types.js";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "01HTEST0000000000000000000",
    title: "Short title",
    description: "A short description.",
    status: "open",
    type: "chore",
    priority: "medium",
    estimate: null,
    actual: null,
    tags: [],
    parent_ticket_id: null,
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

describe("projectTicket — short", () => {
  it("returns only the short-mode fields", () => {
    const task = makeTicket({
      assignee: "alice",
      tags: ["a", "b"],
      estimate: "2h",
      due_date: "2026-05-01",
    });
    const out = projectTicket(task, "short", selfhosted);
    expect(Object.keys(out).sort()).toEqual(
      ["assignee", "due_date", "estimate", "id", "priority", "status", "tags", "title", "type"].sort(),
    );
    expect(out.assignee).toBe("alice");
    expect(out.estimate).toBe("2h");
  });

  it("omits assignee in local mode", () => {
    const task = makeTicket({ assignee: "alice" });
    const out = projectTicket(task, "short", local);
    expect(out).not.toHaveProperty("assignee");
  });

  it("truncates long titles with an ellipsis indicator", () => {
    const long = "A".repeat(200);
    const out = projectTicket(makeTicket({ title: long }), "short", selfhosted).title as string;
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
  });

  it("marks multi-line titles with an ellipsis even when the first line fits", () => {
    const multi = `first line\nsecond line`;
    expect(projectTicket(makeTicket({ title: multi }), "short", selfhosted).title).toBe("first line…");
  });

  it("leaves short single-line titles untouched", () => {
    expect(projectTicket(makeTicket({ title: "just a title" }), "short", selfhosted).title).toBe("just a title");
  });

  it("truncates tags to 5 with a '+N more' sentinel", () => {
    const tags = ["a", "b", "c", "d", "e", "f", "g"];
    expect(projectTicket(makeTicket({ tags }), "short", selfhosted).tags).toEqual([
      "a", "b", "c", "d", "e", "+2 more",
    ]);
  });

  it("leaves tags untouched when 5 or fewer", () => {
    const tags = ["a", "b", "c"];
    expect(projectTicket(makeTicket({ tags }), "short", selfhosted).tags).toEqual(["a", "b", "c"]);
  });

  it("excludes description, metadata, timestamps", () => {
    const out = projectTicket(makeTicket({ description: "body", metadata: { k: 1 } }), "short", selfhosted);
    expect(out).not.toHaveProperty("description");
    expect(out).not.toHaveProperty("metadata");
    expect(out).not.toHaveProperty("created_at");
    expect(out).not.toHaveProperty("updated_at");
  });
});

describe("projectTicket — detailed", () => {
  it("returns all fields with description truncated", () => {
    const longDesc = "x".repeat(500);
    const out = projectTicket(makeTicket({ description: longDesc }), "detailed", selfhosted);
    expect((out.description as string).length).toBeLessThanOrEqual(200);
    expect((out.description as string).endsWith("…")).toBe(true);
    expect(out).toHaveProperty("created_at");
    expect(out).toHaveProperty("metadata");
  });

  it("leaves short descriptions untouched", () => {
    const out = projectTicket(makeTicket({ description: "short desc" }), "detailed", selfhosted);
    expect(out.description).toBe("short desc");
  });

  it("strips assignee in local mode", () => {
    const out = projectTicket(makeTicket({ assignee: "alice" }), "detailed", local);
    expect(out).not.toHaveProperty("assignee");
  });
});

describe("projectTicket — full", () => {
  it("returns the task unchanged in selfhosted mode", () => {
    const task = makeTicket({ description: "y".repeat(500), title: "z".repeat(200) });
    const out = projectTicket(task, "full", selfhosted);
    expect(out.description).toBe(task.description);
    expect(out.title).toBe(task.title);
  });

  it("strips assignee in local mode", () => {
    const out = projectTicket(makeTicket({ assignee: "alice" }), "full", local);
    expect(out).not.toHaveProperty("assignee");
  });
});

describe("projectTickets", () => {
  it("preserves score from search results", () => {
    const withScore = { ...makeTicket(), score: 0.87 };
    const out = projectTickets([withScore], "short", selfhosted);
    expect(out[0].score).toBe(0.87);
  });

  it("omits score when not present", () => {
    const out = projectTickets([makeTicket()], "short", selfhosted);
    expect(out[0]).not.toHaveProperty("score");
  });
});
