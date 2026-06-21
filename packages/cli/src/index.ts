// Builds the commander program. Kept separate from bin.ts so tests can
// construct the program without driving process.argv / process.exit.

import { Command } from "commander";
import { DEFAULT_API_URL, usingDefaultApiUrl } from "./config.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { registerTicketCommands } from "./commands/ticket.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerOrgCommands } from "./commands/org.js";
import { registerGithubCommands } from "./commands/github.js";
import { registerRenderCommands } from "./commands/render.js";
import type { RunDeps } from "./run.js";

/**
 * Build the CLI. `deps` lets tests inject a stub client into the data/management
 * command groups; production passes nothing and auth is resolved per request.
 */
export function buildProgram(deps: RunDeps = {}): Command {
  const program = new Command();
  program
    .name("willet")
    .description("Willet CLI — targets Willet Cloud by default, or a self-deployed server")
    .option("--json", "Output raw JSON instead of a human-readable summary")
    .option(
      "--api-url <url>",
      "Willet API base URL (overrides WILLET_API_URL and ~/.willet/config.json)",
    )
    .showHelpAfterError();

  // A single resolution path (config.ts) reads the target from the environment,
  // so fold the --api-url flag into the env before any command runs. Then, when
  // we're falling back to the hosted cloud, print a de-emphasized reminder to
  // stderr (never stdout, so JSON/pipes stay clean) that the target is
  // overridable — only for interactive runs, and not under --json.
  program.hook("preAction", () => {
    const opts = program.opts<{ apiUrl?: string; json?: boolean }>();
    const flag = opts.apiUrl?.trim();
    if (flag) process.env.WILLET_API_URL = flag;
    if (!opts.json && process.stderr.isTTY && usingDefaultApiUrl()) {
      const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
      process.stderr.write(
        dim(
          `→ Using Willet Cloud (${DEFAULT_API_URL}). ` +
            `Point elsewhere with --api-url, WILLET_API_URL, or apiUrl in ~/.willet/config.json.\n`,
        ),
      );
    }
  });

  program
    .command("login")
    .description("Authenticate this machine with Willet Cloud")
    .action(async () => {
      process.exitCode = await loginCommand();
    });

  program
    .command("logout")
    .description(
      "Clear locally stored credentials. To revoke tokens everywhere, use the dashboard.",
    )
    .action(() => {
      process.exitCode = logoutCommand();
    });

  program
    .command("whoami")
    .description("Show the identity for the active token")
    .action(async () => {
      process.exitCode = await whoamiCommand();
    });

  registerTicketCommands(program, deps);
  registerProjectCommands(program, deps);
  registerOrgCommands(program, deps);
  registerGithubCommands(program, deps);
  registerRenderCommands(program, deps);

  return program;
}
