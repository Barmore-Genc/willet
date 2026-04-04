import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initEmbeddings } from "./embeddings/local.js";
import { closeAll } from "./db/queries.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerLinkTools } from "./tools/links.js";
import { registerQueryTools } from "./tools/queries.js";
import { registerVizTools } from "./tools/viz.js";

export { initEmbeddings } from "./embeddings/local.js";
export { closeAll } from "./db/queries.js";
export { getCurrentUser, runAsUser } from "./context.js";

export async function createServer(options?: { embeddingModel?: string }): Promise<McpServer> {
  await initEmbeddings(options?.embeddingModel);

  const server = new McpServer({
    name: "willet",
    version: "1.0.0",
  });

  registerProjectTools(server);
  registerTaskTools(server);
  registerLinkTools(server);
  registerQueryTools(server);
  registerVizTools(server);

  return server;
}

export function setupCleanup(): void {
  process.on("exit", closeAll);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}
