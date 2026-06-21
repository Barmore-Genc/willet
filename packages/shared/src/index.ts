import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initEmbeddings, type InitEmbeddingsOptions } from "./embeddings/local.js";
import { closeAll } from "./db/queries.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerTicketTools } from "./tools/tickets.js";
import { registerLinkTools } from "./tools/links.js";
import { registerQueryTools } from "./tools/queries.js";
import { registerVizTools } from "./tools/viz.js";
import { buildInstructions, registerResources } from "./instructions.js";
import type { ToolOptions } from "./models/types.js";

export {
  embed,
  initEmbeddings,
  setEmbedder,
  EMBEDDING_DIM,
  getEmbeddingDim,
} from "./embeddings/local.js";
export type { EmbeddingTransform, InitEmbeddingsOptions } from "./embeddings/local.js";
export { closeAll } from "./db/queries.js";
export { getCurrentUser, runAsUser } from "./context.js";

// Query functions, re-exported as a library so other packages (e.g. the HTTP
// server's REST API) can call them directly instead of reaching into dist paths.
export {
  getProjectDb,
  getProjectById,
  listProjects,
  initProject,
  createTicket,
  getTicketById,
  updateTicket,
  deleteTicket,
  startTicket,
  completeTicket,
  cancelTicket,
  reopenTicket,
  addComment,
  getComments,
  linkTickets,
  unlinkTickets,
  getLinks,
  getHistory,
  listTickets,
  searchTickets,
  getTicketGraph,
  getProjectStats,
  listTags,
} from "./db/queries.js";

export {
  projectTicket,
  projectTickets,
  StatusSchema,
  TicketTypeSchema,
  PrioritySchema,
  LinkTypeSchema,
  SearchModeSchema,
  SortFieldSchema,
  SortDirectionSchema,
  GroupBySchema,
  VerbositySchema,
} from "./models/types.js";
export type {
  Project,
  Ticket,
  TicketHistory,
  TicketLink,
  TicketComment,
  Status,
  TicketType,
  Priority,
  LinkType,
  SearchMode,
  SortField,
  SortDirection,
  GroupBy,
  Verbosity,
} from "./models/types.js";
export type { ToolOptions } from "./models/types.js";
export {
  gatherTicketData,
  ticketsToCSV,
  ticketsToJSON,
  exportProject,
  importTicketsIntoDb,
  importFromZip,
  normalizeExportPayload,
  EXPORT_VERSION,
  SUPPORTED_EXPORT_VERSIONS,
} from "./export.js";
export type { TicketWithExtras, ExportTicketJson, ImportResult } from "./export.js";
export { runExportCli, runImportCli } from "./export-cli.js";

export async function createServer(options?: { embeddingModel?: string | InitEmbeddingsOptions; mode?: "local" | "selfhosted"; validAssignees?: string[] }): Promise<McpServer> {
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
  registerTicketTools(server, toolOptions);
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
