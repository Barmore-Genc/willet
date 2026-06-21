// `willet render ...` — visualization renders for a project (data plane, keyed
// by `--project <projectId>`): a kanban board and a ticket dependency graph.

import { Command } from "commander";
import type { components } from "@willet/api-spec";
import { run, type RunDeps } from "../run.js";
import type { Query } from "../client.js";
import { board, dependencyGraph } from "../format.js";

type Schemas = components["schemas"];

const json = (cmd: Command): boolean => Boolean(cmd.optsWithGlobals().json);
const drop = <T extends object>(o: T): T => {
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return o;
};

export function registerRenderCommands(program: Command, deps: RunDeps = {}): void {
  const render = program.command("render").description("Render project visualizations");

  render
    .command("board")
    .description("Render a kanban board (markdown)")
    .requiredOption("-p, --project <projectId>", "Project ID (UUID)")
    .option("--group-by <field>", "status | priority | type")
    .option("--status <status...>")
    .option("--type <type...>")
    .option("--priority <priority...>")
    .option("--tags <tag...>")
    .action(async (o, cmd: Command) => {
      const query: Query<"/projects/{projectId}/board", "get"> = {
        group_by: o.groupBy as Schemas["GroupBy"] | undefined,
        status: o.status as Schemas["Status"][] | undefined,
        type: o.type as Schemas["TicketType"][] | undefined,
        priority: o.priority as Schemas["Priority"][] | undefined,
        tags: o.tags as string[] | undefined,
      };
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/projects/{projectId}/board", {
            params: { path: { projectId: o.project }, query: drop(query) },
          }),
        board,
        deps,
      );
    });

  render
    .command("dependency-graph")
    .description("Render a ticket dependency graph (text tree)")
    .argument("<ticketId>", "Root ticket ULID or key")
    .requiredOption("-p, --project <projectId>", "Project ID (UUID)")
    .option("--depth <n>", "Hops to traverse (1-5)")
    .action(async (ticketId: string, o, cmd: Command) => {
      const query: Query<"/projects/{projectId}/tickets/{ticketId}/dependency-graph", "get"> = {
        depth: o.depth === undefined ? undefined : Number(o.depth),
      };
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/projects/{projectId}/tickets/{ticketId}/dependency-graph", {
            params: { path: { projectId: o.project, ticketId }, query: drop(query) },
          }),
        dependencyGraph,
        deps,
      );
    });
}
