import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, setupCleanup } from "@willet/shared";

async function main() {
  const server = await createServer();
  setupCleanup();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
