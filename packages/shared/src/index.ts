import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initEmbeddings } from "./embeddings/local.js";
import { closeAll } from "./db/queries.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerLinkTools } from "./tools/links.js";
import { registerQueryTools } from "./tools/queries.js";
import { registerVizTools } from "./tools/viz.js";
import { buildInstructions, registerResources } from "./instructions.js";
import type { ToolOptions } from "./models/types.js";

export { initEmbeddings, setEmbedder, EMBEDDING_DIM } from "./embeddings/local.js";
export { closeAll } from "./db/queries.js";
export { getCurrentUser, runAsUser } from "./context.js";
export type { ToolOptions } from "./models/types.js";
export {
  gatherTaskData,
  tasksToCSV,
  tasksToJSON,
  exportProject,
  importTasksIntoDb,
  importFromZip,
} from "./export.js";
export type { TaskWithExtras, ExportTaskJson, ImportResult } from "./export.js";
export { runExportCli, runImportCli } from "./export-cli.js";

export async function createServer(options?: { embeddingModel?: string; mode?: "local" | "selfhosted"; validAssignees?: string[] }): Promise<McpServer> {
  await initEmbeddings(options?.embeddingModel);

  const mode = options?.mode ?? "local";
  const toolOptions: ToolOptions = {
    mode,
    validAssignees: options?.validAssignees,
  };
  const server = new McpServer(
    { name: "willet", version: "1.0.0" },
    { instructions: buildInstructions(mode) },
  );

  registerProjectTools(server);
  registerTaskTools(server, toolOptions);
  registerLinkTools(server);
  registerQueryTools(server, toolOptions);
  registerVizTools(server, toolOptions);
  registerResources(server, mode);

  return server;
}

export function setupCleanup(): void {
  process.on("exit", closeAll);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}
