import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initEmbeddings } from "./embeddings/local.js";
import { closeAll } from "./db/queries.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerLinkTools } from "./tools/links.js";
import { registerQueryTools } from "./tools/queries.js";
import { registerVizTools } from "./tools/viz.js";

async function main() {
  // Initialize embeddings model (must succeed)
  await initEmbeddings();

  const server = new McpServer({
    name: "task-manager",
    version: "1.0.0",
  });

  registerProjectTools(server);
  registerTaskTools(server);
  registerLinkTools(server);
  registerQueryTools(server);
  registerVizTools(server);

  // Clean up DB connections on exit
  process.on("exit", closeAll);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
