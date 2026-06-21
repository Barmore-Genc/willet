// `willet ticket ...` — the ticket data plane, mirroring the ticket MCP tools.
// Every subcommand targets a project via `--project <projectId>` and talks to
// the REST API through the spec-typed client. Reads use GET, writes POST/PATCH/
// DELETE, so a read-only secret fails writes with a clear message (exit 3).

import { Command } from "commander";
import type { components } from "@willet/api-spec";
import { run, type RunDeps } from "../run.js";
import type { Query } from "../client.js";
import {
  ticketList,
  ticketDetail,
  record,
  commentLine,
  linkLine,
  tagList,
  graph,
} from "../format.js";

type Schemas = components["schemas"];

/** Add the required project selector shared by every ticket subcommand. */
function project(c: Command): Command {
  return c.requiredOption("-p, --project <projectId>", "Project ID (UUID)");
}

const json = (cmd: Command): boolean => Boolean(cmd.optsWithGlobals().json);
const drop = <T extends object>(o: T): T => {
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return o;
};
const int = (v: string | undefined): number | undefined => (v === undefined ? undefined : Number(v));

// Commander yields raw strings; the server validates enum values at runtime, so
// each query builder narrows them to the spec's parameter type here at the
// trust boundary. Typing the literal (rather than casting it `as never` at the
// call site) keeps openapi-fetch checking parameter names and value types.

/** Build the shared ticket filter query from parsed options. */
function filterQuery(o: Record<string, unknown>): Query<"/projects/{projectId}/tickets", "get"> {
  const q: Query<"/projects/{projectId}/tickets", "get"> = {
    status: o.status as Schemas["Status"][] | undefined,
    type: o.type as Schemas["TicketType"][] | undefined,
    priority: o.priority as Schemas["Priority"][] | undefined,
    tags: o.tags as string[] | undefined,
    parent_ticket_id: o.parent as string | undefined,
    assignee: o.assignee as string | undefined,
    sort: o.sort as Schemas["SortField"] | undefined,
    sort_direction: o.sortDirection as Schemas["SortDirection"] | undefined,
    limit: int(o.limit as string | undefined),
    offset: int(o.offset as string | undefined),
    verbosity: o.verbosity as Schemas["Verbosity"] | undefined,
  };
  return drop(q);
}

export function registerTicketCommands(program: Command, deps: RunDeps = {}): void {
  const ticket = program.command("ticket").description("Manage tickets in a project");

  project(ticket.command("list").description("List tickets"))
    .option("--status <status...>", "Filter by status")
    .option("--type <type...>", "Filter by type")
    .option("--priority <priority...>", "Filter by priority")
    .option("--tags <tag...>", "Filter by tags")
    .option("--parent <ticketId>", "Filter by parent ticket")
    .option("--assignee <assignee>", "Filter by assignee")
    .option("--sort <field>", "Sort field")
    .option("--sort-direction <dir>", "asc or desc")
    .option("--limit <n>", "Max results")
    .option("--offset <n>", "Result offset")
    .option("--verbosity <v>", "short | detailed | full")
    .action(async (o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/projects/{projectId}/tickets", {
            params: { path: { projectId: o.project }, query: filterQuery(o) },
          }),
        ticketList,
        deps,
      );
    });

  project(ticket.command("search").description("Search tickets (text, semantic, or hybrid)"))
    .argument("<query>", "Search query")
    .option("--mode <mode>", "text | semantic | hybrid")
    .option("--status <status...>", "Filter by status")
    .option("--type <type...>", "Filter by type")
    .option("--priority <priority...>", "Filter by priority")
    .option("--limit <n>", "Max results")
    .option("--verbosity <v>", "short | detailed | full")
    .action(async (query: string, o, cmd: Command) => {
      const q: Query<"/projects/{projectId}/tickets/search", "get"> = {
        query,
        mode: o.mode as Schemas["SearchMode"] | undefined,
        status: o.status as Schemas["Status"][] | undefined,
        type: o.type as Schemas["TicketType"][] | undefined,
        priority: o.priority as Schemas["Priority"][] | undefined,
        limit: int(o.limit),
        verbosity: o.verbosity as Schemas["Verbosity"] | undefined,
      };
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/projects/{projectId}/tickets/search", {
            params: { path: { projectId: o.project }, query: drop(q) },
          }),
        ticketList,
        deps,
      );
    });

  project(ticket.command("get").description("Get a ticket with comments and links"))
    .argument("<ticketId>", "Ticket ULID or key (e.g. WD-42)")
    .option("--include-history", "Include the change history")
    .option("--include-subtickets", "Include child tickets")
    .option("--verbosity <v>", "short | detailed | full")
    .action(async (ticketId: string, o, cmd: Command) => {
      const query: Query<"/projects/{projectId}/tickets/{ticketId}", "get"> = {
        include_history: o.includeHistory as boolean | undefined,
        include_subtickets: o.includeSubtickets as boolean | undefined,
        verbosity: o.verbosity as Schemas["Verbosity"] | undefined,
      };
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/projects/{projectId}/tickets/{ticketId}", {
            params: { path: { projectId: o.project, ticketId }, query: drop(query) },
          }),
        ticketDetail,
        deps,
      );
    });

  project(ticket.command("create").description("Create a ticket"))
    .argument("<title>", "Ticket title")
    .option("--description <text>")
    .option("--type <type>", "chore | bug | feature | epic")
    .option("--priority <priority>", "low | medium | high | urgent")
    .option("--status <status>")
    .option("--estimate <estimate>")
    .option("--assignee <assignee>")
    .option("--due-date <date>")
    .option("--tags <tag...>")
    .option("--comment <text>", "Add an initial comment")
    .action(async (title: string, o, cmd: Command) => {
      const body = drop({
        title,
        description: o.description,
        type: o.type,
        priority: o.priority,
        status: o.status,
        estimate: o.estimate,
        assignee: o.assignee,
        due_date: o.dueDate,
        tags: o.tags,
        initial_comment: o.comment,
      }) as Schemas["CreateTicketBody"];
      process.exitCode = await run(
        json(cmd),
        (c) => c.POST("/projects/{projectId}/tickets", { params: { path: { projectId: o.project } }, body }),
        ticketDetail,
        deps,
      );
    });

  project(ticket.command("update").description("Update a ticket's fields"))
    .argument("<ticketId>", "Ticket ULID or key")
    .option("--title <title>")
    .option("--description <text>")
    .option("--type <type>")
    .option("--priority <priority>")
    .option("--estimate <estimate>")
    .option("--assignee <assignee>")
    .option("--due-date <date>")
    .option("--tags <tag...>")
    .action(async (ticketId: string, o, cmd: Command) => {
      const body = drop({
        title: o.title,
        description: o.description,
        type: o.type,
        priority: o.priority,
        estimate: o.estimate,
        assignee: o.assignee,
        due_date: o.dueDate,
        tags: o.tags,
      }) as Schemas["UpdateTicketBody"];
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.PATCH("/projects/{projectId}/tickets/{ticketId}", {
            params: { path: { projectId: o.project, ticketId } },
            body,
          }),
        ticketDetail,
        deps,
      );
    });

  project(ticket.command("delete").description("Delete a ticket and all its related data"))
    .argument("<ticketId>", "Ticket ULID or key")
    .action(async (ticketId: string, o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.DELETE("/projects/{projectId}/tickets/{ticketId}", {
            params: { path: { projectId: o.project, ticketId } },
          }),
        record,
        deps,
      );
    });

  // --- workflow transitions ---
  const transition = (
    name: string,
    description: string,
    path: "start" | "cancel" | "reopen",
  ): void => {
    project(ticket.command(name).description(description))
      .argument("<ticketId>", "Ticket ULID or key")
      .action(async (ticketId: string, o, cmd: Command) => {
        process.exitCode = await run(
          json(cmd),
          (c) =>
            c.POST(`/projects/{projectId}/tickets/{ticketId}/${path}` as const, {
              params: { path: { projectId: o.project, ticketId } },
            }),
          ticketDetail,
          deps,
        );
      });
  };
  transition("start", "Set a ticket to in_progress", "start");
  transition("cancel", "Cancel a ticket", "cancel");
  transition("reopen", "Move a ticket back to the open queue", "reopen");

  project(ticket.command("complete").description("Mark a ticket as done"))
    .argument("<ticketId>", "Ticket ULID or key")
    .option("--actual <actual>", "Actual time/effort spent")
    .action(async (ticketId: string, o, cmd: Command) => {
      const body = drop({ actual: o.actual }) as Schemas["CompleteTicketBody"];
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.POST("/projects/{projectId}/tickets/{ticketId}/complete", {
            params: { path: { projectId: o.project, ticketId } },
            body,
          }),
        ticketDetail,
        deps,
      );
    });

  project(ticket.command("comment").description("Add a comment to a ticket"))
    .argument("<ticketId>", "Ticket ULID or key")
    .argument("<content>", "Comment text")
    .action(async (ticketId: string, content: string, o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.POST("/projects/{projectId}/tickets/{ticketId}/comments", {
            params: { path: { projectId: o.project, ticketId } },
            body: { content },
          }),
        commentLine,
        deps,
      );
    });

  project(ticket.command("link").description("Link two tickets"))
    .argument("<source>", "Source ticket")
    .argument("<target>", "Target ticket")
    .requiredOption("--type <linkType>", "blocks | relates_to | duplicates")
    .action(async (source: string, target: string, o, cmd: Command) => {
      const body = {
        source_ticket_id: source,
        target_ticket_id: target,
        link_type: o.type,
      } as Schemas["LinkTicketsBody"];
      process.exitCode = await run(
        json(cmd),
        (c) => c.POST("/projects/{projectId}/links", { params: { path: { projectId: o.project } }, body }),
        linkLine,
        deps,
      );
    });

  project(ticket.command("unlink").description("Remove a link between two tickets"))
    .argument("<source>", "Source ticket")
    .argument("<target>", "Target ticket")
    .requiredOption("--type <linkType>", "blocks | relates_to | duplicates")
    .action(async (source: string, target: string, o, cmd: Command) => {
      const body = {
        source_ticket_id: source,
        target_ticket_id: target,
        link_type: o.type,
      } as Schemas["LinkTicketsBody"];
      process.exitCode = await run(
        json(cmd),
        (c) => c.DELETE("/projects/{projectId}/links", { params: { path: { projectId: o.project } }, body }),
        record,
        deps,
      );
    });

  project(ticket.command("graph").description("Show a ticket's link graph"))
    .argument("<ticketId>", "Ticket ULID or key")
    .option("--depth <n>", "Hops to traverse (1-5)")
    .option("--verbosity <v>", "short | detailed | full")
    .action(async (ticketId: string, o, cmd: Command) => {
      const query: Query<"/projects/{projectId}/tickets/{ticketId}/graph", "get"> = {
        depth: int(o.depth),
        verbosity: o.verbosity as Schemas["Verbosity"] | undefined,
      };
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/projects/{projectId}/tickets/{ticketId}/graph", {
            params: { path: { projectId: o.project, ticketId }, query: drop(query) },
          }),
        graph,
        deps,
      );
    });

  project(ticket.command("tags").description("List tags in use with their counts")).action(
    async (o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) => c.GET("/projects/{projectId}/tags", { params: { path: { projectId: o.project } } }),
        tagList,
        deps,
      );
    },
  );
}
