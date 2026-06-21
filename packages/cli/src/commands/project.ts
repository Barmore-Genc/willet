// `willet project ...` — project and project-member management. Mostly
// account-level (addressed by org + project slug); `stats` is the one data-plane
// command here and is keyed by `--project <projectId>` to match the REST API.

import { Command } from "commander";
import type { components } from "@willet/api-spec";
import { run, type RunDeps } from "../run.js";
import { collection, record, memberLine, projectLine, stats } from "../format.js";

type Schemas = components["schemas"];
const json = (cmd: Command): boolean => Boolean(cmd.optsWithGlobals().json);

export function registerProjectCommands(program: Command, deps: RunDeps = {}): void {
  const project = program.command("project").description("Manage projects");

  project
    .command("list")
    .description("List projects in an organization")
    .argument("<orgSlug>", "Organization slug")
    .action(async (orgSlug: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) => c.GET("/organizations/{orgSlug}/projects", { params: { path: { orgSlug } } }),
        collection("projects", projectLine),
        deps,
      );
    });

  project
    .command("create")
    .description("Create a project in an organization")
    .argument("<orgSlug>", "Organization slug")
    .argument("<name>", "Project name")
    .option("--key-prefix <prefix>", "Ticket key prefix (e.g. WD)")
    .action(async (orgSlug: string, name: string, o, cmd: Command) => {
      const body: Schemas["CreateProjectBody"] = { name };
      if (o.keyPrefix !== undefined) body.key_prefix = o.keyPrefix;
      process.exitCode = await run(
        json(cmd),
        (c) => c.POST("/organizations/{orgSlug}/projects", { params: { path: { orgSlug } }, body }),
        record,
        deps,
      );
    });

  project
    .command("delete")
    .description("Schedule a project for deletion (30-day retention)")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .action(async (orgSlug: string, projectSlug: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.DELETE("/organizations/{orgSlug}/projects/{projectSlug}", {
            params: { path: { orgSlug, projectSlug } },
          }),
        record,
        deps,
      );
    });

  project
    .command("restore")
    .description("Cancel a pending project deletion")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .action(async (orgSlug: string, projectSlug: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.POST("/organizations/{orgSlug}/projects/{projectSlug}/restore", {
            params: { path: { orgSlug, projectSlug } },
          }),
        record,
        deps,
      );
    });

  project
    .command("set-key-prefix")
    .description("Change a project's ticket key prefix")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .argument("<keyPrefix>", "New key prefix")
    .action(async (orgSlug: string, projectSlug: string, keyPrefix: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.PATCH("/organizations/{orgSlug}/projects/{projectSlug}", {
            params: { path: { orgSlug, projectSlug } },
            body: { key_prefix: keyPrefix },
          }),
        record,
        deps,
      );
    });

  project
    .command("stats")
    .description("Ticket counts grouped by status, type, and priority")
    .requiredOption("-p, --project <projectId>", "Project ID (UUID)")
    .action(async (o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) => c.GET("/projects/{projectId}/stats", { params: { path: { projectId: o.project } } }),
        stats,
        deps,
      );
    });

  const members = project.command("members").description("Manage project members");

  members
    .command("list")
    .description("List members assigned to a project")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .action(async (orgSlug: string, projectSlug: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/organizations/{orgSlug}/projects/{projectSlug}/members", {
            params: { path: { orgSlug, projectSlug } },
          }),
        collection("members", memberLine),
        deps,
      );
    });

  members
    .command("add")
    .description("Add an organization member to a project")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .argument("<userId>", "Member user ID (UUID)")
    .requiredOption("--role <role>", "admin | editor | viewer")
    .action(async (orgSlug: string, projectSlug: string, userId: string, o, cmd: Command) => {
      const body = { user_id: userId, role: o.role } as Schemas["AddProjectMemberBody"];
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.POST("/organizations/{orgSlug}/projects/{projectSlug}/members", {
            params: { path: { orgSlug, projectSlug } },
            body,
          }),
        record,
        deps,
      );
    });

  members
    .command("role")
    .description("Change a member's role on a project")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .argument("<userId>", "Member user ID")
    .requiredOption("--role <role>", "admin | editor | viewer")
    .action(async (orgSlug: string, projectSlug: string, userId: string, o, cmd: Command) => {
      const body = { role: o.role } as Schemas["ProjectMemberRoleBody"];
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.PATCH("/organizations/{orgSlug}/projects/{projectSlug}/members/{userId}", {
            params: { path: { orgSlug, projectSlug, userId } },
            body,
          }),
        record,
        deps,
      );
    });

  members
    .command("remove")
    .description("Remove a member from a project")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .argument("<userId>", "Member user ID")
    .action(async (orgSlug: string, projectSlug: string, userId: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.DELETE("/organizations/{orgSlug}/projects/{projectSlug}/members/{userId}", {
            params: { path: { orgSlug, projectSlug, userId } },
          }),
        record,
        deps,
      );
    });
}
