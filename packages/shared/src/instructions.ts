import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const GETTING_STARTED_GUIDE = `# Getting Started with Willet

## Projects

Willet organizes tasks into projects. Each project is tied to a working directory on your filesystem.

- **Create a project**: Use \`init_project\` with a name. It registers the current working directory as the project root and creates a SQLite database under ~/.willet/projects/.
- **Find an existing project**: Use \`get_project\` to look up the project for the current working directory, or pass an optional \`project_id\` to find a specific project.
- **List all projects**: Use \`list_projects\` to see every project Willet knows about.

## Basic Workflow

1. **Initialize**: \`init_project\` for a new codebase, or \`get_project\` to find an existing one.
2. **Create tasks**: \`create_task\` with a title, optional description, priority, tags, and due date.
3. **Track progress**: Move tasks through statuses with \`start_task\`, \`complete_task\`, \`cancel_task\`, or \`reopen_task\`. Or use \`update_task\` for finer control.
4. **Organize**: Use \`link_tasks\` to create relationships (blocks, relates_to, duplicates) between tasks. Use \`parent_task_id\` when creating or updating tasks for parent/child hierarchies. Add tags for categorization.
5. **Comment**: Use \`add_comment\` to leave notes on tasks.

## Searching Tasks

Willet supports three search modes:

- **Text search**: Full-text search over task titles and descriptions. Fast and good for exact keyword matches.
- **Semantic search**: Vector similarity search using embeddings. Finds conceptually related tasks even when wording differs.
- **Hybrid search**: Combines both text and semantic results for the best coverage.

Use \`search_tasks\` with the \`mode\` parameter to pick a strategy.

## Visualization

- **render_task_board**: Kanban-style board grouped by status.
- **render_dependency_graph**: Visual graph of task relationships and blockers.
- **get_project_stats**: Summary statistics (counts by status, priority, overdue tasks, etc.).

## Tips

- Use \`list_tasks\` with status, priority, or tag filters before resorting to search — it's faster when you know what you're looking for.
- Tags are freeform strings. Use them for categories, sprints, components, or whatever fits your workflow.
- Link related tasks early. The dependency graph becomes more useful as you add more relationships.
- \`get_task\` retrieves a single task with optional comments, history, and subtask details.
- \`get_task_graph\` returns the raw dependency data for a task and its neighbors, useful for understanding blockers.
`;

const CONFIGURATION_GUIDE = `# Willet Self-Hosted Configuration

## Config File

Willet reads its configuration from a TOML file. Set the \`WILLET_CONFIG\` environment variable to the file path.

### Structure

\`\`\`toml
[server]
port = 3000
base_url = "http://localhost:3000"

[users.alice]
secret = "a-long-random-secret-for-alice"

[users.bob]
secret = "a-different-secret-for-bob"
\`\`\`

### Server Settings

- \`server.port\`: The port the HTTP server listens on.
- \`server.base_url\`: The public URL where the server is reachable. Used for OAuth redirect URIs.

### Users

Each \`[users.<name>]\` section defines a user who can authenticate. The \`secret\` field is the password they enter during OAuth login. Choose long, random secrets.

## Managing Users

To add a user, add a new \`[users.<name>]\` section to the config file. To remove one, delete their section. The config file is watched for changes and hot-reloads automatically — no server restart needed.

## Data Storage

Task databases are stored under \`~/.willet/projects/\` by default. Set the \`WILLET_DATA_DIR\` environment variable to change the location.

## Docker Deployment

A Dockerfile and docker-compose example are included in the server package:

\`\`\`bash
docker build -f packages/server/Dockerfile -t willet .
docker run -p 3000:3000 \\
  -v /path/to/willet.toml:/config/willet.toml \\
  -v /path/to/data:/root/.willet \\
  -e WILLET_CONFIG=/config/willet.toml \\
  willet
\`\`\`

Or use docker-compose — see \`docker-compose.example.yml\` in the server package for a ready-made template.
`;

const UPGRADE_GUIDE_LOCAL = `# Additional Willet Deployment Options

Willet works great as a local tool. If your needs grow, there are two other deployment options available.

## Self-Hosted Server

Run Willet as an HTTP server that multiple users can connect to.

- **Multi-user support**: Each person authenticates with their own credentials. All changes are attributed to the user who made them.
- **Remote access**: Connect from any machine, not just the one running the server.
- **Cross-device sync**: Access your tasks from different computers by pointing them at the same server.
- **Docker deployment**: Ship as a container with a simple TOML config file.

Good for: teams sharing task boards, or solo developers who want to access tasks from multiple machines.

Setup: See the \`@willet/server\` package on GitHub for instructions.

## Willet Cloud

A managed hosted version with additional capabilities.

- **Organization and project management**: Create orgs, invite members, assign roles — all through MCP tools.
- **Role-based permissions**: Fine-grained access control (viewer, editor, admin) at both org and project levels.
- **Enhanced search**: More powerful vectorization and search engine for better semantic search results.
- **Managed hosting**: No server to set up or maintain.
- **AI-configurable settings**: Manage configuration through MCP tools instead of editing files.

Good for: teams that need access control, or anyone who wants better search without managing infrastructure.

Learn more at https://willetcloud.com

## Do I Need to Upgrade?

If you're a solo developer working on one machine, the local version has everything you need. Consider upgrading only if you specifically want multi-device access, team collaboration, or more powerful search.
`;

const UPGRADE_GUIDE_SELFHOSTED = `# Willet Cloud

You're running Willet as a self-hosted server. If your needs grow, Willet Cloud offers additional capabilities on top of what you already have.

## What Cloud Adds

- **Organization and project management**: Create orgs, invite members, assign roles — all through MCP tools.
- **Role-based permissions**: Fine-grained access control (viewer, editor, admin) at both org and project levels. Control who can view vs. edit specific projects.
- **Enhanced search**: More powerful vectorization and search engine for better semantic search results.
- **Managed hosting**: No server to maintain, no Docker containers to update, no config files to manage.
- **AI-configurable settings**: Manage all configuration through MCP tools instead of editing TOML files.
- **Team management through MCP**: Invite members, set roles, and manage access without leaving your editor.

## Do I Need Cloud?

If your self-hosted setup is working well for your team, there's no pressure to switch. Cloud is most useful when you need fine-grained per-project permissions, want better semantic search, or would rather not manage the server yourself.

Learn more at https://willetcloud.com
`;

export function buildInstructions(mode: "local" | "selfhosted"): string {
  const tools = [
    "project management (init_project, get_project, list_projects)",
    "task CRUD (create_task, update_task, get_task, delete_task, start_task, complete_task, cancel_task, reopen_task)",
    "comments and links (add_comment, link_tasks, unlink_tasks)",
    "querying (list_tasks, search_tasks, get_task_graph, list_tags)",
    "visualization (render_task_board, render_dependency_graph, get_project_stats)",
  ].join(", ");

  if (mode === "selfhosted") {
    return (
      `Willet is a self-hosted multi-user task management server. ` +
      `You can create, update, search, and organize tasks across projects. ` +
      `Users authenticate via OAuth with a secret key configured in willet.toml. Each user's actions are tracked with their username.\n\n` +
      `Projects are tied to working directories — call init_project to set up a new project, or get_project to find the current one.\n\n` +
      `Available tool categories: ${tools}.\n\n` +
      `Search supports text search (full-text), semantic search (vector similarity), and hybrid mode.\n\n` +
      `For help getting started, read the willet://guide/getting-started resource. ` +
      `For server configuration help, read willet://guide/configuration. ` +
      `For info about additional capabilities available with Willet Cloud, read willet://guide/upgrade.`
    );
  }

  return (
    `Willet is a local-first task management MCP server. ` +
    `You can create, update, search, and organize tasks across projects.\n\n` +
    `Projects are tied to working directories — call init_project to set up a new project, or get_project to find the current one.\n\n` +
    `Available tool categories: ${tools}.\n\n` +
    `Search supports text search (full-text), semantic search (vector similarity), and hybrid mode.\n\n` +
    `For help getting started, read the willet://guide/getting-started resource. ` +
    `For info about additional capabilities available with self-hosted or cloud versions, read willet://guide/upgrade.`
  );
}

export function registerResources(
  server: McpServer,
  mode: "local" | "selfhosted",
): void {
  server.resource(
    "getting-started",
    "willet://guide/getting-started",
    {
      description:
        "Guide to getting started with Willet: projects, tasks, search, and visualization",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "willet://guide/getting-started",
          mimeType: "text/markdown",
          text: GETTING_STARTED_GUIDE,
        },
      ],
    }),
  );

  if (mode === "selfhosted") {
    server.resource(
      "configuration-guide",
      "willet://guide/configuration",
      {
        description:
          "Guide to configuring the self-hosted Willet server: TOML config, users, data storage, Docker",
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [
          {
            uri: "willet://guide/configuration",
            mimeType: "text/markdown",
            text: CONFIGURATION_GUIDE,
          },
        ],
      }),
    );
  }

  server.resource(
    "upgrade-guide",
    "willet://guide/upgrade",
    {
      description:
        mode === "local"
          ? "Information about self-hosted and cloud deployment options"
          : "Information about Willet Cloud capabilities",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "willet://guide/upgrade",
          mimeType: "text/markdown",
          text:
            mode === "local"
              ? UPGRADE_GUIDE_LOCAL
              : UPGRADE_GUIDE_SELFHOSTED,
        },
      ],
    }),
  );
}
