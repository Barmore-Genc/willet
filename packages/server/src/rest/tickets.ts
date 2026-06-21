// Ticket data-plane REST routes under /projects/{projectId}/... — mapped onto
// the @willet/shared query functions. Verbosity projection and response shapes
// mirror the cloud server so both honor the same OpenAPI contract.

import type { RequestHandler, Router } from "express";
import {
  getProjectById,
  getProjectDb,
  listTickets,
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
  getHistory,
  getLinks,
  linkTickets,
  unlinkTickets,
  searchTickets,
  getTicketGraph,
  getProjectStats,
  listTags,
  projectTicket,
  StatusSchema,
  TicketTypeSchema,
  PrioritySchema,
  LinkTypeSchema,
  SearchModeSchema,
  SortFieldSchema,
  SortDirectionSchema,
  GroupBySchema,
  VerbositySchema,
  type Status,
  type TicketType,
  type Priority,
  type Verbosity,
  type Ticket,
  type ToolOptions,
} from "@willet/shared";
import { z } from "zod";
import type { Request } from "express";
import { wrap, sendError } from "./router.js";
import { asArray, asString, asBool, asInt, parseBody } from "./params.js";
import { renderBoard, renderDependencyGraphText } from "./render.js";

type ProjectDb = ReturnType<typeof getProjectDb>;

const TOOL_OPTIONS: ToolOptions = { mode: "selfhosted" };

/** Read a path param as a single string (Express 5 types params as string | string[]). */
function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Resolve a project's DB handle, or `null` if the project does not exist. */
function resolveDb(projectId: string): ProjectDb | null {
  if (!getProjectById(projectId)) return null;
  return getProjectDb(projectId);
}

function project(t: Ticket & { score?: number }, v: Verbosity): Record<string, unknown> {
  const out = projectTicket(t, v, TOOL_OPTIONS);
  if ("score" in t && t.score !== undefined) {
    return { ...out, score: t.score };
  }
  return out;
}

// Parse the shared status/type/priority array filters from the query string.
function arrayFilter<T extends string>(
  value: unknown,
  schema: z.ZodType<T>,
  label: string,
): T[] | undefined {
  const raw = asArray(value);
  if (!raw) return undefined;
  return raw.map((v) => {
    const parsed = schema.safeParse(v);
    if (!parsed.success) throw new Error(`Invalid ${label}: ${v}`);
    return parsed.data;
  });
}

// --- Request body schemas ---

const CreateTicketBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: StatusSchema.optional(),
  type: TicketTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  estimate: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parent_ticket_id: z.string().optional(),
  assignee: z.string().optional(),
  due_date: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  links: z.array(z.object({ target_ticket_id: z.string(), link_type: LinkTypeSchema })).optional(),
  initial_comment: z.string().optional(),
});

const UpdateTicketBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: TicketTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  estimate: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  parent_ticket_id: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CompleteTicketBody = z.object({ actual: z.string().optional() });
const AddCommentBody = z.object({ content: z.string().min(1) });
const LinkBody = z.object({
  source_ticket_id: z.string(),
  target_ticket_id: z.string(),
  link_type: LinkTypeSchema,
});

export function registerTicketRoutes(router: Router, auth: RequestHandler): void {
  // --- list / search (registered before :ticketId so "search" isn't an id) ---

  router.get(
    "/projects/:projectId/tickets/search",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const query = asString(req.query.query);
      if (!query) return sendError(res, 400, "query is required");
      const mode = req.query.mode ? SearchModeSchema.parse(asString(req.query.mode)) : undefined;
      const results = await searchTickets(db, query, {
        mode,
        status: arrayFilter<Status>(req.query.status, StatusSchema, "status"),
        type: arrayFilter<TicketType>(req.query.type, TicketTypeSchema, "type"),
        priority: arrayFilter<Priority>(req.query.priority, PrioritySchema, "priority"),
        limit: asInt(req.query.limit, "limit"),
      });
      const v = req.query.verbosity ? VerbositySchema.parse(asString(req.query.verbosity)) : "detailed";
      res.status(200).json(results.map((t) => project(t, v)));
    }),
  );

  router.get(
    "/projects/:projectId/tickets",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const result = listTickets(db, {
        status: arrayFilter<Status>(req.query.status, StatusSchema, "status"),
        type: arrayFilter<TicketType>(req.query.type, TicketTypeSchema, "type"),
        priority: arrayFilter<Priority>(req.query.priority, PrioritySchema, "priority"),
        tags: asArray(req.query.tags),
        parent_ticket_id: asString(req.query.parent_ticket_id),
        assignee: asString(req.query.assignee),
        created_after: asString(req.query.created_after),
        created_before: asString(req.query.created_before),
        completed_after: asString(req.query.completed_after),
        completed_before: asString(req.query.completed_before),
        due_after: asString(req.query.due_after),
        due_before: asString(req.query.due_before),
        sort: req.query.sort ? SortFieldSchema.parse(asString(req.query.sort)) : undefined,
        sort_direction: req.query.sort_direction
          ? SortDirectionSchema.parse(asString(req.query.sort_direction))
          : undefined,
        limit: asInt(req.query.limit, "limit"),
        offset: asInt(req.query.offset, "offset"),
      });
      const v = req.query.verbosity ? VerbositySchema.parse(asString(req.query.verbosity)) : "detailed";
      res.status(200).json({ tickets: result.tickets.map((t) => project(t, v)), total: result.total });
    }),
  );

  router.post(
    "/projects/:projectId/tickets",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const body = parseBody(CreateTicketBody, req.body);
      const ticket = await createTicket(db, body);
      res.status(201).json(ticket);
    }),
  );

  // --- single ticket ---

  router.get(
    "/projects/:projectId/tickets/:ticketId",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const ticketId = param(req, "ticketId");
      const ticket = getTicketById(db, ticketId);
      if (!ticket) return sendError(res, 404, `Ticket not found: ${ticketId}`);
      const v = req.query.verbosity ? VerbositySchema.parse(asString(req.query.verbosity)) : "full";
      const result: Record<string, unknown> = project(ticket, v);
      result.comments = getComments(db, ticketId);
      result.links = getLinks(db, ticketId);
      if (asBool(req.query.include_history)) result.history = getHistory(db, ticketId);
      if (asBool(req.query.include_subtickets)) {
        const { tickets } = listTickets(db, { parent_ticket_id: ticketId });
        result.subtickets = tickets.map((t) => project(t, v));
      }
      res.status(200).json(result);
    }),
  );

  router.patch(
    "/projects/:projectId/tickets/:ticketId",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const body = parseBody(UpdateTicketBody, req.body);
      const ticket = await updateTicket(db, { ...body, ticket_id: param(req, "ticketId") });
      res.status(200).json(ticket);
    }),
  );

  router.delete(
    "/projects/:projectId/tickets/:ticketId",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      deleteTicket(db, param(req, "ticketId"));
      res.status(200).json({ deleted: true, id: param(req, "ticketId") });
    }),
  );

  // --- workflow transitions ---

  const transition = (
    op: (db: ProjectDb, ticketId: string) => Promise<Ticket>,
  ): RequestHandler =>
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const ticket = await op(db, param(req, "ticketId"));
      res.status(200).json(ticket);
    });

  router.post("/projects/:projectId/tickets/:ticketId/start", auth, transition(startTicket));
  router.post("/projects/:projectId/tickets/:ticketId/cancel", auth, transition(cancelTicket));
  router.post("/projects/:projectId/tickets/:ticketId/reopen", auth, transition(reopenTicket));
  router.post(
    "/projects/:projectId/tickets/:ticketId/complete",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const { actual } = parseBody(CompleteTicketBody, req.body);
      const ticket = await completeTicket(db, param(req, "ticketId"), actual);
      res.status(200).json(ticket);
    }),
  );

  // --- comments ---

  router.post(
    "/projects/:projectId/tickets/:ticketId/comments",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const { content } = parseBody(AddCommentBody, req.body);
      const comment = await addComment(db, param(req, "ticketId"), content);
      res.status(201).json(comment);
    }),
  );

  // --- links ---

  router.post(
    "/projects/:projectId/links",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const { source_ticket_id, target_ticket_id, link_type } = parseBody(LinkBody, req.body);
      const link = linkTickets(db, source_ticket_id, target_ticket_id, link_type);
      res.status(201).json(link);
    }),
  );

  router.delete(
    "/projects/:projectId/links",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const { source_ticket_id, target_ticket_id, link_type } = parseBody(LinkBody, req.body);
      unlinkTickets(db, source_ticket_id, target_ticket_id, link_type);
      res.status(200).json({ deleted: true });
    }),
  );

  // --- graph / dependency-graph ---

  router.get(
    "/projects/:projectId/tickets/:ticketId/graph",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      if (!getTicketById(db, param(req, "ticketId"))) {
        return sendError(res, 404, `Ticket not found: ${param(req, "ticketId")}`);
      }
      const depth = asInt(req.query.depth, "depth") ?? 1;
      const graph = getTicketGraph(db, param(req, "ticketId"), depth);
      const v = req.query.verbosity ? VerbositySchema.parse(asString(req.query.verbosity)) : "detailed";
      res.status(200).json({ nodes: graph.nodes.map((t) => project(t, v)), edges: graph.edges });
    }),
  );

  router.get(
    "/projects/:projectId/tickets/:ticketId/dependency-graph",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      if (!getTicketById(db, param(req, "ticketId"))) {
        return sendError(res, 404, `Ticket not found: ${param(req, "ticketId")}`);
      }
      const depth = asInt(req.query.depth, "depth") ?? 2;
      const graph = getTicketGraph(db, param(req, "ticketId"), depth);
      const text = renderDependencyGraphText(graph.nodes, graph.edges, param(req, "ticketId"));
      res.status(200).json({ text, nodes: graph.nodes, edges: graph.edges });
    }),
  );

  // --- project-level reads ---

  router.get(
    "/projects/:projectId/stats",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      res.status(200).json(getProjectStats(db));
    }),
  );

  router.get(
    "/projects/:projectId/tags",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      res.status(200).json(listTags(db));
    }),
  );

  router.get(
    "/projects/:projectId/board",
    auth,
    wrap(async (req, res) => {
      const db = resolveDb(param(req, "projectId"));
      if (!db) return sendError(res, 404, `Project not found: ${param(req, "projectId")}`);
      const groupBy = req.query.group_by ? GroupBySchema.parse(asString(req.query.group_by)) : "status";
      const { tickets } = listTickets(db, {
        status: arrayFilter<Status>(req.query.status, StatusSchema, "status"),
        type: arrayFilter<TicketType>(req.query.type, TicketTypeSchema, "type"),
        priority: arrayFilter<Priority>(req.query.priority, PrioritySchema, "priority"),
        tags: asArray(req.query.tags),
        limit: 200,
      });
      res.status(200).json({ board: renderBoard(tickets, groupBy) });
    }),
  );
}
