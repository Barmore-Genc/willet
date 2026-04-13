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
  });

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
    expect(toolNames).toContain("create_task");
    expect(toolNames).toContain("list_tasks");
    expect(toolNames).toContain("search_tasks");
    expect(toolNames).toContain("get_task");
    expect(toolNames).toContain("complete_task");
    expect(toolNames).toContain("link_tasks");
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
      name: "create_task",
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
    const taskId = taskIdMatch![0];

    // List tasks — should contain our task
    const listResult = await client.callTool({
      name: "list_tasks",
      arguments: { project_id: projectId },
    });
    const listText = (listResult.content as Array<{ text: string }>)[0].text;
    expect(listText).toContain("Fix the widget");

    // Get task details
    const getResult = await client.callTool({
      name: "get_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    const getText = (getResult.content as Array<{ text: string }>)[0].text;
    expect(getText).toContain("Fix the widget");
    expect(getText).toContain("high");

    // Complete the task
    await client.callTool({
      name: "complete_task",
      arguments: { project_id: projectId, task_id: taskId },
    });

    // Verify it's completed
    const getResult2 = await client.callTool({
      name: "get_task",
      arguments: { project_id: projectId, task_id: taskId },
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
      name: "create_task",
      arguments: {
        project_id: projectId,
        title: "Lifecycle task",
        priority: "medium",
      },
    });
    const taskId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Start
    const startResult = await client.callTool({
      name: "start_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect(
      (startResult.content as Array<{ text: string }>)[0].text
    ).toContain("in_progress");

    // Cancel
    const cancelResult = await client.callTool({
      name: "cancel_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect(
      (cancelResult.content as Array<{ text: string }>)[0].text
    ).toContain("cancelled");

    // Reopen
    const reopenResult = await client.callTool({
      name: "reopen_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect(
      (reopenResult.content as Array<{ text: string }>)[0].text
    ).toContain("open");

    // Complete
    const completeResult = await client.callTool({
      name: "complete_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect(
      (completeResult.content as Array<{ text: string }>)[0].text
    ).toContain("done");
  });

  it("should link and unlink tasks", async () => {
    const projectDir = join(dataDir, "link-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Link Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create two tasks
    const task1Result = await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Parent task" },
    });
    const task1Id = (task1Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const task2Result = await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Child task" },
    });
    const task2Id = (task2Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Link them
    const linkResult = await client.callTool({
      name: "link_tasks",
      arguments: {
        project_id: projectId,
        source_task_id: task1Id,
        target_task_id: task2Id,
        link_type: "blocks",
      },
    });
    expect((linkResult.content as Array<{ text: string }>)[0].text).toContain(
      "blocks"
    );

    // Verify link shows up in get_task (included by default)
    const getResult = await client.callTool({
      name: "get_task",
      arguments: { project_id: projectId, task_id: task1Id },
    });
    const getResultText = (getResult.content as Array<{ text: string }>)[0]
      .text;
    expect(getResultText).toContain(task2Id);
    expect(getResultText).toContain("blocks");

    // Unlink
    const unlinkResult = await client.callTool({
      name: "unlink_tasks",
      arguments: {
        project_id: projectId,
        source_task_id: task1Id,
        target_task_id: task2Id,
        link_type: "blocks",
      },
    });
    expect(unlinkResult.content).toBeTruthy();
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
      name: "create_task",
      arguments: {
        project_id: projectId,
        title: "Original title",
        priority: "low",
      },
    });
    const taskId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Update title and priority
    const updateResult = await client.callTool({
      name: "update_task",
      arguments: {
        project_id: projectId,
        task_id: taskId,
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
      name: "create_task",
      arguments: { project_id: projectId, title: "Commentable task" },
    });
    const taskId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Add a comment
    const commentResult = await client.callTool({
      name: "add_comment",
      arguments: {
        project_id: projectId,
        task_id: taskId,
        content: "This is a test comment",
      },
    });
    expect(
      (commentResult.content as Array<{ text: string }>)[0].text
    ).toContain("This is a test comment");

    // Verify comment appears in get_task (included by default)
    const getResult = await client.callTool({
      name: "get_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect(
      (getResult.content as Array<{ text: string }>)[0].text
    ).toContain("This is a test comment");
  });

  it("should search tasks", async () => {
    const projectDir = join(dataDir, "search-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Search Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create tasks with distinct titles
    await client.callTool({
      name: "create_task",
      arguments: {
        project_id: projectId,
        title: "Implement authentication flow",
        description: "Add OAuth2 login support",
      },
    });
    await client.callTool({
      name: "create_task",
      arguments: {
        project_id: projectId,
        title: "Fix database migration",
        description: "Migration script fails on PostgreSQL",
      },
    });

    // Search for auth-related tasks
    const searchResult = await client.callTool({
      name: "search_tasks",
      arguments: { project_id: projectId, query: "authentication" },
    });
    const searchText = (searchResult.content as Array<{ text: string }>)[0]
      .text;
    expect(searchText).toContain("authentication");
  });

  it("should list and filter tasks by status", async () => {
    const projectDir = join(dataDir, "filter-project");

    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Filter Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create and complete one task
    const task1Result = await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Done task" },
    });
    const task1Id = (task1Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];
    await client.callTool({
      name: "complete_task",
      arguments: { project_id: projectId, task_id: task1Id },
    });

    // Create another task that stays open
    await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Open task" },
    });

    // List only open tasks
    const openList = await client.callTool({
      name: "list_tasks",
      arguments: { project_id: projectId, status: "open" },
    });
    const openText = (openList.content as Array<{ text: string }>)[0].text;
    expect(openText).toContain("Open task");
    expect(openText).not.toContain("Done task");

    // List only done tasks
    const doneList = await client.callTool({
      name: "list_tasks",
      arguments: { project_id: projectId, status: "done" },
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
      name: "create_task",
      arguments: { project_id: projectId, title: "Task A", priority: "high" },
    });
    const task2Result = await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Task B", priority: "low" },
    });
    const task2Id = (task2Result.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];
    await client.callTool({
      name: "complete_task",
      arguments: { project_id: projectId, task_id: task2Id },
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
    const createTool = tools.find((t) => t.name === "create_task")!;
    const updateTool = tools.find((t) => t.name === "update_task")!;
    const listTool = tools.find((t) => t.name === "list_tasks")!;

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

    // create_task
    const createResult = await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Local task" },
    });
    const createText = (createResult.content as Array<{ text: string }>)[0].text;
    const taskId = createText.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];
    expect(createText).not.toContain("assignee");

    // update_task
    const updateResult = await client.callTool({
      name: "update_task",
      arguments: { project_id: projectId, task_id: taskId, priority: "high" },
    });
    expect((updateResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    // get_task
    const getResult = await client.callTool({
      name: "get_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect((getResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    // list_tasks
    const listResult = await client.callTool({
      name: "list_tasks",
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
      name: "create_task",
      arguments: { project_id: projectId, title: "Lifecycle task" },
    });
    const taskId = (createResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // start_task
    const startResult = await client.callTool({
      name: "start_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect((startResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    // complete_task
    const completeResult = await client.callTool({
      name: "complete_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect((completeResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    // reopen_task
    const reopenResult = await client.callTool({
      name: "reopen_task",
      arguments: { project_id: projectId, task_id: taskId },
    });
    expect((reopenResult.content as Array<{ text: string }>)[0].text).not.toContain("assignee");

    // cancel_task
    const cancelResult = await client.callTool({
      name: "cancel_task",
      arguments: { project_id: projectId, task_id: taskId },
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
      name: "create_task",
      arguments: {
        project_id: projectId,
        title: "Searchable widget task",
        description: "This is a searchable task about widgets",
      },
    });

    const searchResult = await client.callTool({
      name: "search_tasks",
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
      name: "create_task",
      arguments: { project_id: projectId, title: "Parent task" },
    });
    const parentId = (parentResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Create child
    const childResult = await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Child task", parent_task_id: parentId },
    });
    const childId = (childResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    // Link them
    await client.callTool({
      name: "link_tasks",
      arguments: {
        project_id: projectId,
        source_task_id: parentId,
        target_task_id: childId,
        link_type: "blocks",
      },
    });

    // get_task with subtasks
    const getResult = await client.callTool({
      name: "get_task",
      arguments: { project_id: projectId, task_id: parentId, include_subtasks: true },
    });
    const getText = (getResult.content as Array<{ text: string }>)[0].text;
    expect(getText).toContain("Child task");
    expect(getText).not.toContain("assignee");

    // get_task_graph
    const graphResult = await client.callTool({
      name: "get_task_graph",
      arguments: { project_id: projectId, task_id: parentId },
    });
    const graphText = (graphResult.content as Array<{ text: string }>)[0].text;
    expect(graphText).toContain("Parent task");
    expect(graphText).toContain("Child task");
    expect(graphText).not.toContain("assignee");
  });

  it("should not include assignee column in task board in local mode", async () => {
    const projectDir = join(dataDir, "local-board-project");
    const initResult = await client.callTool({
      name: "init_project",
      arguments: { name: "Local Board Project", directory: projectDir },
    });
    const projectId = (initResult.content as Array<{ text: string }>)[0]
      .text.match(/[0-9A-HJKMNP-TV-Z]{26}/)![0];

    await client.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: "Board task", priority: "high" },
    });

    const boardResult = await client.callTool({
      name: "render_task_board",
      arguments: { project_id: projectId },
    });
    const boardText = (boardResult.content as Array<{ text: string }>)[0].text;
    expect(boardText).toContain("Board task");
    expect(boardText).not.toContain("Assignee");
    expect(boardText).not.toContain("assignee");
  });

  it("should return error for invalid project ID", async () => {
    const result = await client.callTool({
      name: "list_tasks",
      arguments: { project_id: "NONEXISTENT0000000000000000" },
    });
    expect(result.isError).toBe(true);
  });
});
