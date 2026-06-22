// `willet org ...` — organization and org-member management. Account-level
// (addressed by org slug), so it needs a user-scoped secret whose owner has the
// required org role; project-scoped secrets are rejected by the server.

import { Command } from "commander";
import type { components } from "@willet/api-spec";
import { run, type RunDeps } from "../run.js";
import { collection, record, memberLine, orgLine } from "../format.js";

type Schemas = components["schemas"];
const json = (cmd: Command): boolean => Boolean(cmd.optsWithGlobals().json);

export function registerOrgCommands(program: Command, deps: RunDeps = {}): void {
  const org = program.command("org").description("Manage organizations");

  org
    .command("list")
    .description("List organizations you belong to")
    .option("--include-inactive", "Include organizations pending deletion")
    .action(async (o, cmd: Command) => {
      const query = o.includeInactive ? { include_inactive: true } : {};
      process.exitCode = await run(
        json(cmd),
        (c) => c.GET("/organizations", { params: { query } }),
        collection("organizations", orgLine),
        deps,
      );
    });

  org
    .command("create")
    .description("Create an organization")
    .argument("<name>", "Organization name")
    .action(async (name: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) => c.POST("/organizations", { body: { name } }),
        record,
        deps,
      );
    });

  org
    .command("update")
    .description("Update an organization's name or slug")
    .argument("<orgSlug>", "Organization slug")
    .option("--name <name>")
    .option("--slug <slug>")
    .action(async (orgSlug: string, o, cmd: Command) => {
      const body: Schemas["UpdateOrgBody"] = {};
      if (o.name !== undefined) body.name = o.name;
      if (o.slug !== undefined) body.slug = o.slug;
      process.exitCode = await run(
        json(cmd),
        (c) => c.PATCH("/organizations/{orgSlug}", { params: { path: { orgSlug } }, body }),
        record,
        deps,
      );
    });

  org
    .command("delete")
    .description("Permanently delete an organization and all its projects")
    .argument("<orgSlug>", "Organization slug")
    .action(async (orgSlug: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) => c.DELETE("/organizations/{orgSlug}", { params: { path: { orgSlug } } }),
        record,
        deps,
      );
    });

  const members = org.command("members").description("Manage organization members");

  members
    .command("list")
    .description("List members and pending invitations")
    .argument("<orgSlug>", "Organization slug")
    .action(async (orgSlug: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) => c.GET("/organizations/{orgSlug}/members", { params: { path: { orgSlug } } }),
        collection("members", memberLine),
        deps,
      );
    });

  members
    .command("invite")
    .description("Create an invitation link to the organization")
    .argument("<orgSlug>", "Organization slug")
    .argument("<email>", "Invitee email")
    .requiredOption("--role <role>", "admin | member")
    .action(async (orgSlug: string, email: string, o, cmd: Command) => {
      const body = { email, role: o.role } as Schemas["InviteMemberBody"];
      process.exitCode = await run(
        json(cmd),
        (c) => c.POST("/organizations/{orgSlug}/members", { params: { path: { orgSlug } }, body }),
        record,
        deps,
      );
    });

  members
    .command("role")
    .description("Change a member's role")
    .argument("<orgSlug>", "Organization slug")
    .argument("<userId>", "Member user ID")
    .requiredOption("--role <role>", "admin | member")
    .action(async (orgSlug: string, userId: string, o, cmd: Command) => {
      const body = { role: o.role } as Schemas["OrgMemberRoleBody"];
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.PATCH("/organizations/{orgSlug}/members/{userId}", {
            params: { path: { orgSlug, userId } },
            body,
          }),
        record,
        deps,
      );
    });

  members
    .command("remove")
    .description("Remove a member from the organization")
    .argument("<orgSlug>", "Organization slug")
    .argument("<userId>", "Member user ID")
    .action(async (orgSlug: string, userId: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.DELETE("/organizations/{orgSlug}/members/{userId}", {
            params: { path: { orgSlug, userId } },
          }),
        record,
        deps,
      );
    });
}
