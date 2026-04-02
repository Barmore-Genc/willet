import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InitProjectInputSchema, ListProjectsInputSchema } from "../models/types.js";
import { initProject, getProject, listProjects } from "../db/queries.js";

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
    "Get the project for the current directory, or by project_id",
    { project_id: z.string().optional() },
    async ({ project_id }) => {
      const project = getProject(process.cwd(), project_id);
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
      };
    }
  );

  server.tool(
    "list_projects",
    "List all projects, optionally filtered by name",
    ListProjectsInputSchema.shape,
    async ({ name }) => {
      const projects = listProjects(name);
      return {
        content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      };
    }
  );
}
