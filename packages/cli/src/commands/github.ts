// `willet github ...` — link/unlink GitHub repositories to a project so PRs
// auto-complete tickets. Account-level (org admin/owner secret required).

import { Command } from "commander";
import { run, type RunDeps } from "../run.js";
import { collection, record, repoLine } from "../format.js";

const json = (cmd: Command): boolean => Boolean(cmd.optsWithGlobals().json);

export function registerGithubCommands(program: Command, deps: RunDeps = {}): void {
  const github = program.command("github").description("Manage GitHub repository links");

  github
    .command("list")
    .description("List GitHub repositories linked to a project")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .action(async (orgSlug: string, projectSlug: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.GET("/organizations/{orgSlug}/projects/{projectSlug}/github-repos", {
            params: { path: { orgSlug, projectSlug } },
          }),
        collection("repos", repoLine),
        deps,
      );
    });

  github
    .command("link")
    .description("Link a GitHub repository to a project")
    .argument("<orgSlug>", "Organization slug")
    .argument("<projectSlug>", "Project slug")
    .argument("<repo>", "Repository in owner/repo form")
    .action(async (orgSlug: string, projectSlug: string, repo: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.POST("/organizations/{orgSlug}/projects/{projectSlug}/github-repos", {
            params: { path: { orgSlug, projectSlug } },
            body: { repo },
          }),
        record,
        deps,
      );
    });

  github
    .command("unlink")
    .description("Unlink a GitHub repository from a project")
    .argument("<orgSlug>", "Organization slug")
    .argument("<mappingId>", "Repository mapping ID from `github list`")
    .action(async (orgSlug: string, mappingId: string, _o, cmd: Command) => {
      process.exitCode = await run(
        json(cmd),
        (c) =>
          c.DELETE("/organizations/{orgSlug}/github-repos/{mappingId}", {
            params: { path: { orgSlug, mappingId } },
          }),
        record,
        deps,
      );
    });
}
