# Task Manager

A local-first task tracker designed for AI agents. Think Jira or Linear, but operated entirely through [MCP](https://modelcontextprotocol.io/) tools — no browser, no GUI, just your AI assistant managing tasks alongside your code.

## What It Does

Task Manager gives AI coding agents (like Claude Code) full project-management capabilities: creating and tracking tasks, managing workflows, searching, and visualizing progress — all without leaving the terminal.

### Core Features

- **Task tracking** — Create, update, and organize tasks with types (task, bug, feature, epic), priorities, estimates, tags, and custom metadata
- **Workflow management** — Move tasks through statuses (open, in progress, done, cancelled) with full history tracking
- **Subtasks and linking** — Break work into subtasks, and link related tasks with dependency (blocks), relationship, or duplicate links
- **Comments** — Add notes and context to any task
- **Smart search** — Find tasks by keyword or by meaning (semantic similarity), or combine both for best results
- **Dependency graphs** — Explore how tasks relate to each other across multiple hops
- **Visualizations** — Kanban boards, dependency graphs, and project dashboards rendered as interactive UIs in supported clients (with text fallbacks everywhere else)
- **Per-project isolation** — Each project gets its own database, so there's no cross-project interference

## Getting Started

1. Install and configure the server as an MCP tool source for your AI agent
2. In your project directory, initialize a project:
   > "Initialize a task manager project called My App"
3. Start creating and managing tasks through natural conversation:
   > "Create a bug for the login timeout issue, high priority"
   >
   > "Show me all open tasks tagged 'backend'"
   >
   > "What tasks are blocking the auth epic?"

## Design Philosophy

- **Local-first** — All data stays on your machine. No accounts, no cloud, no sync headaches.
- **Agent-native** — Built for AI agents to operate, not humans to click through. Every action is an MCP tool call.
- **Convention over configuration** — Sensible defaults for task types, priorities, and workflows so you can start tracking immediately.
- **Future-ready** — Designed with multi-user and remote access in mind, but optimized for the single-user local experience today.
