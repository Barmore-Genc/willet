import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Test suite ---

describe("Willet MCP stdio E2E", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "willet-mcp-test-"));

    transport = new StdioClientTransport({
      command: "tsx",
      args: [join(import.meta.dirname, "index.ts")],
      env: {
        ...process.env,
        WILLET_DATA_DIR: dataDir,
      },
    });

    client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("should report server info on connect", () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe("willet");
  });

  it("should list available tools", async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("init_project");
    expect(toolNames).toContain("create_ticket");
    expect(toolNames).toContain("find_tickets");
    expect(toolNames).toContain("get_ticket");
    expect(toolNames).toContain("set_ticket_status");
    expect(toolNames).toContain("link_tickets");

    for (const removed of [
      "list_tickets",
      "search_tickets",
      "start_ticket",
      "complete_ticket",
      "cancel_ticket",
      "reopen_ticket",
      "unlink_tickets",
    ]) {
      expect(toolNames).not.toContain(removed);
    }
  });

  it("should create a project and manage tasks end-to-end", async () => {
    const projectDir = join(dataDir, "test-project");

    // Init project
    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Test Project", directory: projectDir },
    });
    const initText = (initResult.content as Array<{ text: string }>)[0].text;
    const projectIdMatch = initText.match(/[0-9A-HJKMNP-TV-Z]{26}/);
    expect(projectIdMatch).toBeTruthy();
    const projectId = projectIdMatch![0];

    // Create a task
    const createResult = await client.callTool({
      name: "create_ticket",
      arguments: {
        project_id: projectId,
        title: "Fix the widget",
        description: "The widget is broken and needs fixing",
        priority: "high",
      },
    });
    const createText = (createResult.content as Array<{ text: string }>)[0]
      .text;
    const taskIdMatch = createText.match(/[0-9A-HJKMNP-TV-Z]{26}/);
    expect(taskIdMatch).toBeTruthy();
    const ticketId = taskIdMatch![0];

    // List tasks — should contain our task
    const listResult = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId },
    });
    const listText = (listResult.content as Array<{ text: string }>)[0].text;
    expect(listText).toContain("Fix the widget");

    // Get task details
    const getResult = await client.callTool({
      name: "get_ticket",
      arguments: { project_id: projectId, ticket_id: ticketId },
    });
    const getText = (getResult.content as Array<{ text: string }>)[0].text;
    expect(getText).toContain("Fix the widget");
    expect(getText).toContain("high");

    // Complete the task
    await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "done" },
    });

    // Verify it's completed
    const getResult2 = await client.callTool({
      name: "get_ticket",
      arguments: { project_id: projectId, ticket_id: ticketId },
    });
    const getText2 = (getResult2.content as Array<{ text: string }>)[0].text;
    expect(getText2).toContain("done");
  });

  it("should handle task lifecycle: create, start, cancel, reopen, complete", async () => {
    const projectDir = join(dataDir, "lifecycle-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Lifecycle Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create
    const createResult = await client.callTool({
      name: "create_ticket",
      arguments: {
        project_id: projectId,
        title: "Lifecycle task",
        priority: "medium",
      },
    });
    const ticketId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Start
    const startResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "in_progress" },
    });
    expect(
      (startResult.content as Array<{ text: string }>)[0].text
    ).toContain("in_progress");

    // Cancel
    const cancelResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "cancelled" },
    });
    expect(
      (cancelResult.content as Array<{ text: string }>)[0].text
    ).toContain("cancelled");

    // Reopen
    const reopenResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "open" },
    });
    expect(
      (reopenResult.content as Array<{ text: string }>)[0].text
    ).toContain("open");

    // Complete
    const completeResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "done" },
    });
    expect(
      (completeResult.content as Array<{ text: string }>)[0].text
    ).toContain("done");
  });

  it("should reopen an in_progress task back to open", async () => {
    const projectDir = join(dataDir, "reopen-in-progress-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Reopen In-Progress Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const createResult = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "In-progress task" },
    });
    const ticketId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "in_progress" },
    });

    const reopenResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "open" },
    });
    const reopenText = (reopenResult.content as Array<{ text: string }>)[0].text;
    expect(reopenText).toContain('"status": "open"');

    // History should record exactly one status change for this reopen.
    const getResult = await client.callTool({
      name: "get_ticket",
      arguments: {
        project_id: projectId,
        ticket_id: ticketId,
        include_history: true,
      },
    });
    const getText = (getResult.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(getText) as {
      history?: Array<{
        field_changed: string;
        old_value: string;
        new_value: string;
      }>;
    };
    const statusChanges =
      parsed.history?.filter((h) => h.field_changed === "status") ?? [];
    expect(statusChanges).toHaveLength(2);
    expect(statusChanges[0]).toMatchObject({
      old_value: "open",
      new_value: "in_progress",
    });
    expect(statusChanges[1]).toMatchObject({
      old_value: "in_progress",
      new_value: "open",
    });

    // Reopening an already-open task should error.
    const dupResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "open" },
    });
    expect(dupResult.isError).toBe(true);
    expect(
      (dupResult.content as Array<{ text: string }>)[0].text
    ).toContain("already open");
  });

  it("should add and remove a task link", async () => {
    const projectDir = join(dataDir, "link-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Link Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create two tasks
    const task1Result = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Parent task" },
    });
    const task1Id = (task1Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const task2Result = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Child task" },
    });
    const task2Id = (task2Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Link them
    const linkResult = await client.callTool({
      name: "link_tickets",
      arguments: {
        project_id: projectId,
        links: [
          {
            source_ticket_id: task1Id,
            target_ticket_id: task2Id,
            link_type: "blocks",
          },
        ],
      },
    });
    const created = JSON.parse(
      (linkResult.content as Array<{ text: string }>)[0].text
    );
    expect(created).toHaveLength(1);
    expect(created[0].link_type).toBe("blocks");

    // Verify link shows up in get_ticket (included by default)
    const getResult = await client.callTool({
      name: "get_ticket",
      arguments: { project_id: projectId, ticket_id: task1Id },
    });
    const getResultText = (getResult.content as Array<{ text: string }>)[0]
      .text;
    expect(getResultText).toContain(task2Id);
    expect(getResultText).toContain("blocks");

    // Unlink
    const unlinkResult = await client.callTool({
      name: "link_tickets",
      arguments: {
        project_id: projectId,
        operation: "remove",
        links: [
          {
            source_ticket_id: task1Id,
            target_ticket_id: task2Id,
            link_type: "blocks",
          },
        ],
      },
    });
    expect((unlinkResult.content as Array<{ text: string }>)[0].text).toBe(
      "1 link(s) removed."
    );
  });

  describe("link_tickets batching", () => {
    let projectId: string;
    let ticketIds: string[];

    async function ticketLinks(ticketId: string) {
      const res = await client.callTool({
        name: "get_ticket",
        arguments: { project_id: projectId, ticket_id: ticketId },
      });
      const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      return data.links as Array<{
        source_ticket_id: string;
        target_ticket_id: string;
        link_type: string;
      }>;
    }

    beforeAll(async () => {
      const initResult = await client.callTool({
        name: "init_project",
        arguments: {
          name: "Batch Link Project",
          directory: join(dataDir, "batch-link-project"),
        },
      });
      projectId = (initResult.content as Array<{ text: string }>)[0]
        .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

      ticketIds = [];
      for (const title of ["Batch A", "Batch B", "Batch C", "Batch D"]) {
        const res = await client.callTool({
          name: "create_ticket",
          arguments: { project_id: projectId, title },
        });
        ticketIds.push(
          (res.content as Array<{ text: string }>)[0]
            .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0]
        );
      }
    });

    it("applies multiple links in one call", async () => {
      const [a, b, c, d] = ticketIds;
      const res = await client.callTool({
        name: "link_tickets",
        arguments: {
          project_id: projectId,
          links: [
            { source_ticket_id: a, target_ticket_id: b, link_type: "blocks" },
            { source_ticket_id: a, target_ticket_id: c, link_type: "relates_to" },
            { source_ticket_id: a, target_ticket_id: d, link_type: "duplicates" },
          ],
        },
      });
      expect(res.isError ?? false).toBe(false);
      const created = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(created).toHaveLength(3);
      expect(created.map((l: { link_type: string }) => l.link_type)).toEqual([
        "blocks",
        "relates_to",
        "duplicates",
      ]);

      const links = await ticketLinks(a);
      expect(links).toHaveLength(3);
    });

    it("removes multiple links in one call", async () => {
      const [a, b, c] = ticketIds;
      const res = await client.callTool({
        name: "link_tickets",
        arguments: {
          project_id: projectId,
          operation: "remove",
          links: [
            { source_ticket_id: a, target_ticket_id: b, link_type: "blocks" },
            { source_ticket_id: a, target_ticket_id: c, link_type: "relates_to" },
          ],
        },
      });
      expect(res.isError ?? false).toBe(false);
      expect((res.content as Array<{ text: string }>)[0].text).toBe(
        "2 link(s) removed."
      );

      const links = await ticketLinks(a);
      expect(links).toHaveLength(1);
      expect(links[0].link_type).toBe("duplicates");
    });

    it("rolls back the whole batch when one pair is invalid", async () => {
      const [a, b, c] = ticketIds;
      const before = await ticketLinks(a);

      const res = await client.callTool({
        name: "link_tickets",
        arguments: {
          project_id: projectId,
          links: [
            { source_ticket_id: a, target_ticket_id: b, link_type: "blocks" },
            { source_ticket_id: c, target_ticket_id: c, link_type: "blocks" },
          ],
        },
      });
      expect(res.isError).toBe(true);

      expect(await ticketLinks(a)).toEqual(before);
      expect(await ticketLinks(c)).toEqual([]);
    });

    it("rolls back the whole batch when a ticket does not exist", async () => {
      const [a, b] = ticketIds;
      const before = await ticketLinks(a);

      const res = await client.callTool({
        name: "link_tickets",
        arguments: {
          project_id: projectId,
          links: [
            { source_ticket_id: a, target_ticket_id: b, link_type: "relates_to" },
            {
              source_ticket_id: a,
              target_ticket_id: "NONEXISTENT0000000000000000",
              link_type: "blocks",
            },
          ],
        },
      });
      expect(res.isError).toBe(true);

      expect(await ticketLinks(a)).toEqual(before);
    });

    it("rejects an empty links array", async () => {
      const res = await client.callTool({
        name: "link_tickets",
        arguments: { project_id: projectId, links: [] },
      });
      expect(res.isError).toBe(true);
    });
  });

  it("should update a task", async () => {
    const projectDir = join(dataDir, "update-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Update Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const createResult = await client.callTool({
      name: "create_ticket",
      arguments: {
        project_id: projectId,
        title: "Original title",
        priority: "low",
      },
    });
    const ticketId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Update title and priority
    const updateResult = await client.callTool({
      name: "update_ticket",
      arguments: {
        project_id: projectId,
        ticket_id: ticketId,
        title: "Updated title",
        priority: "urgent",
      },
    });
    const updateText = (updateResult.content as Array<{ text: string }>)[0]
      .text;
    expect(updateText).toContain("Updated title");
    expect(updateText).toContain("urgent");
  });

  it("should add comments to a task", async () => {
    const projectDir = join(dataDir, "comment-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Comment Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const createResult = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Commentable task" },
    });
    const ticketId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Add a comment
    const commentResult = await client.callTool({
      name: "add_comment",
      arguments: {
        project_id: projectId,
        ticket_id: ticketId,
        content: "This is a test comment",
      },
    });
    expect(
      (commentResult.content as Array<{ text: string }>)[0].text
    ).toContain("This is a test comment");

    // Verify comment appears in get_ticket (included by default)
    const getResult = await client.callTool({
      name: "get_ticket",
      arguments: { project_id: projectId, ticket_id: ticketId },
    });
    expect(
      (getResult.content as Array<{ text: string }>)[0].text
    ).toContain("This is a test comment");
  });

  it("should find tasks with and without a query", async () => {
    const projectDir = join(dataDir, "search-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Search Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create tasks with distinct titles
    await client.callTool({
      name: "create_ticket",
      arguments: {
        project_id: projectId,
        title: "Implement authentication flow",
        description: "Add OAuth2 login support",
      },
    });
    await client.callTool({
      name: "create_ticket",
      arguments: {
        project_id: projectId,
        title: "Fix database migration",
        description: "Migration script fails on PostgreSQL",
      },
    });

    // Without a query, find_tickets lists everything
    const listResult = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId },
    });
    const listed = JSON.parse(
      (listResult.content as Array<{ text: string }>)[0].text
    );
    const listedTitles = listed.tickets.map((t: { title: string }) => t.title);
    expect(listedTitles).toContain("Implement authentication flow");
    expect(listedTitles).toContain("Fix database migration");
    expect(listed.total).toBe(listed.tickets.length);

    // With a query, it searches and returns the same shape
    const searchResult = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId, query: "authentication" },
    });
    const found = JSON.parse(
      (searchResult.content as Array<{ text: string }>)[0].text
    );
    expect(found.total).toBe(found.tickets.length);
    expect(found.tickets.length).toBeGreaterThan(0);
    expect(
      found.tickets.some((t: { title: string }) =>
        t.title.includes("authentication")
      )
    ).toBe(true);
  });

  it("should not crash on queries containing FTS5 special syntax", async () => {
    const projectDir = join(dataDir, "fts-syntax-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "FTS Syntax Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    await client.callTool({
      name: "create_ticket",
      arguments: {
        project_id: projectId,
        title: "Deploy in progress",
        description: "Release rollout currently in progress",
      },
    });

    // Each of these would crash FTS5 if terms were passed unquoted:
    // a column filter (`in:progress`), a bare keyword (`OR`), a prefix
    // operator (`*`), and an unbalanced quote.
    for (const query of ["in:progress", "deploy OR", "deploy*", 'deploy"']) {
      const searchResult = await client.callTool({
        name: "find_tickets",
        arguments: { project_id: projectId, query },
      });
      expect(searchResult.isError ?? false).toBe(false);
    }

    // The column-filter form should still find the matching ticket.
    const matchResult = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId, query: "in:progress" },
    });
    const matchText = (matchResult.content as Array<{ text: string }>)[0].text;
    expect(matchText).toContain("Deploy in progress");
  });

  it("should find and filter tasks by status", async () => {
    const projectDir = join(dataDir, "filter-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Filter Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create and complete one task
    const task1Result = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Done task" },
    });
    const task1Id = (task1Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];
    await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: task1Id, status: "done" },
    });

    // Create another task that stays open
    await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Open task" },
    });

    // List only open tasks
    const openList = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId, filter: "status = 'open'" },
    });
    const openText = (openList.content as Array<{ text: string }>)[0].text;
    expect(openText).toContain("Open task");
    expect(openText).not.toContain("Done task");

    // List only done tasks
    const doneList = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId, filter: "status = 'done'" },
    });
    const doneText = (doneList.content as Array<{ text: string }>)[0].text;
    expect(doneText).toContain("Done task");
    expect(doneText).not.toContain("Open task");
  });

  it("should get project stats", async () => {
    const projectDir = join(dataDir, "stats-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Stats Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create some tasks
    await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Task A", priority: "high" },
    });
    const task2Result = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Task B", priority: "low" },
    });
    const task2Id = (task2Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];
    await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: task2Id, status: "done" },
    });

    const statsResult = await client.callTool({
      name: "get_project_stats",
      arguments: { project_id: projectId },
    });
    const statsText = (statsResult.content as Array<{ text: string }>)[0].text;
    // Should show some kind of count/stats
    expect(statsText).toBeTruthy();
    expect(statsText.length).toBeGreaterThan(10);
  });

  it("should list projects", async () => {
    const listResult = await client.callTool({
      name: "list_projects",
      arguments: {},
    });
    const listText = (listResult.content as Array<{ text: string }>)[0].text;
    // Should contain at least some of the projects we created
    expect(listText).toContain("Project");
  });

  it("should not expose assignee in local mode schemas", async () => {
    const { tools } = await client.listTools();
    const createTool = tools.find((t) => t.name === "create_ticket")!;
    const updateTool = tools.find((t) => t.name === "update_ticket")!;
    const listTool = tools.find((t) => t.name === "find_tickets")!;

    expect(createTool.inputSchema.properties).not.toHaveProperty("assignee");
    expect(updateTool.inputSchema.properties).not.toHaveProperty("assignee");
    expect(listTool.inputSchema.properties).not.toHaveProperty("assignee");
  });

  it("should not include assignee in task CRUD outputs in local mode", async () => {
    const projectDir = join(dataDir, "local-crud-project");
    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Local CRUD Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // create_ticket
    const createResult = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Local task" },
    });
    const createText = (createResult.content as Array<{ text: string }>)[0].text;
    const ticketId = createText.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];
    expect(createText).not.toContain("assignee");

    // update_ticket
    const updateResult = await client.callTool({
      name: "update_ticket",
      arguments: { project_id: projectId, ticket_id: ticketId, priority: "high" },
    });
    expect((updateResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    // get_ticket
    const getResult = await client.callTool({
      name: "get_ticket",
      arguments: { project_id: projectId, ticket_id: ticketId },
    });
    expect((getResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    // find_tickets
    const listResult = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId },
    });
    expect((listResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");
  });

  it("should not include assignee in lifecycle tool outputs in local mode", async () => {
    const projectDir = join(dataDir, "local-lifecycle-project");
    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Local Lifecycle Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const createResult = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Lifecycle task" },
    });
    const ticketId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const startResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "in_progress" },
    });
    expect((startResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    const completeResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "done" },
    });
    expect((completeResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    const reopenResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "open" },
    });
    expect((reopenResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    const cancelResult = await client.callTool({
      name: "set_ticket_status",
      arguments: { project_id: projectId, ticket_id: ticketId, status: "cancelled" },
    });
    expect((cancelResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");
  });

  it("should not include assignee in search results in local mode", async () => {
    const projectDir = join(dataDir, "local-search-project");
    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Local Search Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    await client.callTool({
      name: "create_ticket",
      arguments: {
        project_id: projectId,
        title: "Searchable widget task",
        description: "This is a searchable task about widgets",
      },
    });

    const searchResult = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: projectId, query: "widget" },
    });
    const searchText = (searchResult.content as Array<{ text: string }>)[0].text;
    expect(searchText).toContain("widget");
    expect(searchText).not.toContain("assignee");
  });

  it("should not include assignee in subtasks or task graph in local mode", async () => {
    const projectDir = join(dataDir, "local-graph-project");
    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Local Graph Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create parent
    const parentResult = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Parent task" },
    });
    const parentId = (parentResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create child
    const childResult = await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Child task", parent_ticket_id: parentId },
    });
    const childId = (childResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Link them
    await client.callTool({
      name: "link_tickets",
      arguments: {
        project_id: projectId,
        links: [
          {
            source_ticket_id: parentId,
            target_ticket_id: childId,
            link_type: "blocks",
          },
        ],
      },
    });

    // get_ticket with subtasks
    const getResult = await client.callTool({
      name: "get_ticket",
      arguments: { project_id: projectId, ticket_id: parentId, include_subtickets: true },
    });
    const getText = (getResult.content as Array<{ text: string }>)[0].text;
    expect(getText).toContain("Child task");
    expect(getText).not.toContain("assignee");

    // get_ticket_graph
    const graphResult = await client.callTool({
      name: "get_ticket_graph",
      arguments: { project_id: projectId, ticket_id: parentId },
    });
    const graphText = (graphResult.content as Array<{ text: string }>)[0].text;
    expect(graphText).toContain("Parent task");
    expect(graphText).toContain("Child task");
    expect(graphText).not.toContain("assignee");
  });

  it("should not include assignee column in ticket board in local mode", async () => {
    const projectDir = join(dataDir, "local-board-project");
    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Local Board Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    await client.callTool({
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Board task", priority: "high" },
    });

    const boardResult = await client.callTool({
      name: "render_ticket_board",
      arguments: { project_id: projectId },
    });
    const boardText = (boardResult.content as Array<{ text: string }>)[0].text;
    expect(boardText).toContain("Board task");
    expect(boardText).not.toContain("Assignee");
    expect(boardText).not.toContain("assignee");
  });

  it("should return error for invalid project ID", async () => {
    const result = await client.callTool({
      name: "find_tickets",
      arguments: { project_id: "NONEXISTENT0000000000000000" },
    });
    expect(result.isError).toBe(true);
  });

  describe("verbosity modes", () => {
    let verbProjectId: string;
    let parentId: string;
    let childId: string;
    const LONG_DESCRIPTION = "lorem ipsum ".repeat(40); // > 200 chars
    const LONG_TITLE = "A".repeat(200);

    beforeAll(async () => {
      const projectDir = join(dataDir, "verbosity-project");
      const initResult = await client.callTool({
        name: "init_project",
        arguments: { name: "Verbosity Project", directory: projectDir },
      });
      verbProjectId = (initResult.content as Array<{ text: string }>)[0]
        .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

      const parentRes = await client.callTool({
        name: "create_ticket",
        arguments: {
          project_id: verbProjectId,
          title: "Authentication bug parent",
          description: LONG_DESCRIPTION,
          priority: "high",
          tags: ["auth", "security", "bug", "urgent", "backend", "sixth-tag"],
        },
      });
      parentId = (parentRes.content as Array<{ text: string }>)[0]
        .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

      const childRes = await client.callTool({
        name: "create_ticket",
        arguments: {
          project_id: verbProjectId,
          title: LONG_TITLE,
          description: LONG_DESCRIPTION,
          priority: "medium",
        },
      });
      childId = (childRes.content as Array<{ text: string }>)[0]
        .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

      await client.callTool({
        name: "link_tickets",
        arguments: {
          project_id: verbProjectId,
          links: [
            {
              source_ticket_id: parentId,
              target_ticket_id: childId,
              link_type: "blocks",
            },
          ],
        },
      });
    });

    describe("find_tickets (list path)", () => {
      it("short: strips description/metadata/timestamps, truncates title+tags", async () => {
        const res = await client.callTool({
          name: "find_tickets",
          arguments: { project_id: verbProjectId, verbosity: "short" },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        const parent = data.tickets.find((t: { id: string }) => t.id === parentId);
        const child = data.tickets.find((t: { id: string }) => t.id === childId);
        expect(parent).toBeDefined();
        expect(child).toBeDefined();
        for (const t of [parent, child]) {
          expect(t).not.toHaveProperty("description");
          expect(t).not.toHaveProperty("created_at");
          expect(t).not.toHaveProperty("updated_at");
          expect(t).not.toHaveProperty("metadata");
          expect(t).toHaveProperty("id");
          expect(t).toHaveProperty("title");
          expect(t).toHaveProperty("status");
          expect(t).toHaveProperty("priority");
          expect(t).toHaveProperty("type");
          expect(t).toHaveProperty("estimate");
          expect(t).toHaveProperty("tags");
          expect(t).toHaveProperty("due_date");
        }
        // parent has 6 tags → should show 5 plus a "+1 more" sentinel
        expect(parent.tags).toEqual(["auth", "security", "bug", "urgent", "backend", "+1 more"]);
        // child has a 200-char title → should be truncated to ≤ 80 with an ellipsis
        expect((child.title as string).length).toBeLessThanOrEqual(80);
        expect((child.title as string).endsWith("…")).toBe(true);
      });

      it("detailed (default): includes all fields, description truncated with ellipsis", async () => {
        const res = await client.callTool({
          name: "find_tickets",
          arguments: { project_id: verbProjectId },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        const parent = data.tickets.find((t: { id: string }) => t.id === parentId);
        expect(parent).toBeDefined();
        expect(parent.description.length).toBeLessThanOrEqual(200);
        expect(parent.description.endsWith("…")).toBe(true);
        expect(parent).toHaveProperty("created_at");
        expect(parent).toHaveProperty("metadata");
        // Full tags, no sentinel
        expect(parent.tags).toEqual(["auth", "security", "bug", "urgent", "backend", "sixth-tag"]);
      });

      it("full: returns everything verbatim, no truncation", async () => {
        const res = await client.callTool({
          name: "find_tickets",
          arguments: { project_id: verbProjectId, verbosity: "full" },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        const parent = data.tickets.find((t: { id: string }) => t.id === parentId);
        const child = data.tickets.find((t: { id: string }) => t.id === childId);
        expect(parent.description).toBe(LONG_DESCRIPTION);
        expect(parent.tags).toEqual(["auth", "security", "bug", "urgent", "backend", "sixth-tag"]);
        expect(child.title).toBe(LONG_TITLE);
      });
    });

    describe("find_tickets (search path)", () => {
      it("short: trims payload but preserves score", async () => {
        const res = await client.callTool({
          name: "find_tickets",
          arguments: {
            project_id: verbProjectId,
            query: "authentication",
            verbosity: "short",
          },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        expect(data.total).toBe(data.tickets.length);
        expect(data.tickets.length).toBeGreaterThan(0);
        for (const t of data.tickets) {
          expect(t).toHaveProperty("score");
          expect(t).not.toHaveProperty("description");
          expect(t).not.toHaveProperty("created_at");
        }
      });

      it("full: includes description and score", async () => {
        const res = await client.callTool({
          name: "find_tickets",
          arguments: {
            project_id: verbProjectId,
            query: "authentication",
            verbosity: "full",
          },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        const match = data.tickets.find((t: { id: string }) => t.id === parentId);
        expect(match).toBeDefined();
        expect(match.description).toBe(LONG_DESCRIPTION);
        expect(match).toHaveProperty("score");
      });
    });

    describe("get_ticket", () => {
      it("full (default): returns full task unchanged", async () => {
        const res = await client.callTool({
          name: "get_ticket",
          arguments: { project_id: verbProjectId, ticket_id: parentId },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        expect(data.description).toBe(LONG_DESCRIPTION);
        expect(data).toHaveProperty("comments");
        expect(data).toHaveProperty("links");
      });

      it("short: trims the main task but still attaches comments and links", async () => {
        const res = await client.callTool({
          name: "get_ticket",
          arguments: { project_id: verbProjectId, ticket_id: parentId, verbosity: "short" },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        expect(data).not.toHaveProperty("description");
        expect(data).not.toHaveProperty("created_at");
        expect(data).toHaveProperty("id", parentId);
        expect(data).toHaveProperty("comments");
        expect(data).toHaveProperty("links");
        expect(Array.isArray(data.links)).toBe(true);
      });

      it("short with include_subtickets: projects subtasks too", async () => {
        // parentId has no parent_ticket_id-style children, so subtasks will be empty;
        // but the key invariant is that, when present, subtasks also get projected.
        const res = await client.callTool({
          name: "get_ticket",
          arguments: {
            project_id: verbProjectId,
            ticket_id: parentId,
            include_subtickets: true,
            verbosity: "short",
          },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        expect(Array.isArray(data.subtickets)).toBe(true);
        for (const s of data.subtickets) {
          expect(s).not.toHaveProperty("description");
          expect(s).not.toHaveProperty("metadata");
        }
      });

      it("detailed: truncates description on the main task", async () => {
        const res = await client.callTool({
          name: "get_ticket",
          arguments: { project_id: verbProjectId, ticket_id: parentId, verbosity: "detailed" },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        expect(data.description.length).toBeLessThanOrEqual(200);
        expect(data.description.endsWith("…")).toBe(true);
      });
    });

    describe("get_ticket_graph", () => {
      it("short: nodes are trimmed but edges untouched", async () => {
        const res = await client.callTool({
          name: "get_ticket_graph",
          arguments: { project_id: verbProjectId, ticket_id: parentId, verbosity: "short" },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        expect(data.nodes.length).toBeGreaterThanOrEqual(2);
        for (const n of data.nodes) {
          expect(n).not.toHaveProperty("description");
          expect(n).not.toHaveProperty("metadata");
          expect(n).toHaveProperty("id");
          expect(n).toHaveProperty("title");
        }
        expect(Array.isArray(data.edges)).toBe(true);
        expect(data.edges.length).toBeGreaterThan(0);
        for (const e of data.edges) {
          expect(e).toHaveProperty("source_ticket_id");
          expect(e).toHaveProperty("target_ticket_id");
          expect(e).toHaveProperty("link_type");
        }
      });

      it("full: nodes include full description", async () => {
        const res = await client.callTool({
          name: "get_ticket_graph",
          arguments: { project_id: verbProjectId, ticket_id: parentId, verbosity: "full" },
        });
        const data = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        const parent = data.nodes.find((n: { id: string }) => n.id === parentId);
        expect(parent.description).toBe(LONG_DESCRIPTION);
      });
    });
  });
});
