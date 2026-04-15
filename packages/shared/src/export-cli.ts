import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import {
  getProjectDb,
  getProject,
  listProjects,
  initProject,
  closeAll,
} from "./db/queries.js";
import { exportProject, importFromZip } from "./export.js";

function printExportUsage(): void {
  console.log(`Usage: willet-export [options]

Export a Willet project to a zip archive.

Options:
  --project <id>    Project ID to export (auto-detects if only one exists)
  --output <path>   Output file path (default: willet-export-<project>.zip)
  --help            Show this help message`);
}

function printImportUsage(): void {
  console.log(`Usage: willet-import <file.zip> [options]

Import tasks from a Willet export archive.

Options:
  --project <id>    Import into an existing project (creates new project if omitted)
  --help            Show this help message`);
}

function parseArgs(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      result.set("help", "true");
    } else if (args[i].startsWith("--") && i + 1 < args.length) {
      result.set(args[i].slice(2), args[i + 1]);
      i++;
    } else if (!args[i].startsWith("--")) {
      positional.push(args[i]);
    }
  }
  if (positional.length > 0) {
    result.set("_positional", positional[0]);
  }
  return result;
}

export async function runExportCli(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (opts.has("help")) {
    printExportUsage();
    return;
  }

  try {
    let project;
    const projectId = opts.get("project");

    if (projectId) {
      project = getProject("", projectId);
    } else {
      // Try to find a single project
      const projects = listProjects();
      if (projects.length === 0) {
        console.error("Error: No projects found. Nothing to export.");
        process.exit(1);
      }
      if (projects.length > 1) {
        console.error(
          "Error: Multiple projects found. Use --project <id> to specify which one to export.",
        );
        console.error("\nAvailable projects:");
        for (const p of projects) {
          console.error(`  ${p.id}  ${p.name}`);
        }
        process.exit(1);
      }
      project = projects[0];
    }

    const outputPath = opts.get("output") ?? `willet-export-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`;
    const resolvedOutput = resolve(outputPath);

    console.log(`Exporting project "${project.name}" (${project.id})...`);

    const projectDb = getProjectDb(project.id);
    const { taskCount } = await exportProject(
      projectDb,
      project.name,
      resolvedOutput,
    );

    console.log(`Exported ${taskCount} task(s) to ${resolvedOutput}`);
  } finally {
    closeAll();
  }
}

export async function runImportCli(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (opts.has("help")) {
    printImportUsage();
    return;
  }

  const zipFile = opts.get("_positional");
  if (!zipFile) {
    console.error("Error: No zip file specified.");
    printImportUsage();
    process.exit(1);
  }

  const resolvedPath = resolve(zipFile);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }

  try {
    const targetProjectId = opts.get("project");

    console.log(`Importing from ${basename(resolvedPath)}...`);

    const results = await importFromZip(
      resolvedPath,
      getProjectDb,
      initProject,
      targetProjectId,
    );

    for (const result of results) {
      console.log(
        `  Project "${result.projectName}" (${result.projectId}): ${result.taskCount} task(s) imported`,
      );
      for (const warning of result.warnings) {
        console.warn(`  Warning: ${warning}`);
      }
    }

    const total = results.reduce((sum, r) => sum + r.taskCount, 0);
    console.log(`Import complete: ${total} task(s) across ${results.length} project(s).`);
  } finally {
    closeAll();
  }
}
