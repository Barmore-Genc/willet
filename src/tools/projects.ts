import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InitProjectInputSchema } from "../models/types.js";
import { initProject, getProject } from "../db/queries.js";

export function registerProjectTools(server: McpServer): void {
  server.tool(
    "init_project",
    "Initialize a project for the current working directory",
    { name: InitProjectInputSchema.shape.name },
    async ({ name }) => {
      const project = initProject(name, process.cwd());
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
      };
    }
  );

  server.tool(
    "get_project",
    "Get the project associated with the current working directory",
    {},
    async () => {
      const project = getProject(process.cwd());
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
      };
    }
  );
}
