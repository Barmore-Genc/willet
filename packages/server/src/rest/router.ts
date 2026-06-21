// REST API for the self-deployed Willet HTTP server, mounted at /api/v1.
//
// Implements the @willet/api-spec OpenAPI contract that the cloud server also
// honors, mapping the data-plane endpoints onto the @willet/shared query
// functions. Account-management endpoints that only make sense in the hosted
// product (orgs, members, GitHub, key prefixes) return 501 with a message
// pointing the operator at the self-hosted alternative — see stubs.ts.
//
// Auth: each request carries `Authorization: Bearer <secret>`, matched against
// the per-user secrets in the (hot-reloaded) server config. An authenticated
// user has full access — self-deploy has no read-only/scope distinction.

import express, { Router, type Request, type Response, type NextFunction } from "express";
import openapi from "@willet/api-spec";
import { runAsUser } from "@willet/shared";
import type { WilletAuthProvider } from "../auth/provider.js";
import { findUserBySecret } from "../config.js";
import { registerTicketRoutes } from "./tickets.js";
import { registerProjectRoutes } from "./projects.js";
import { registerStubRoutes } from "./stubs.js";

// Express 5 augmentation: stash the authenticated username on the request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      willetUser?: string;
    }
  }
}

export interface RestDeps {
  provider: WilletAuthProvider;
}

/** Send a JSON error body matching the spec's Error schema. */
export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/**
 * Wrap an async handler so a thrown error is turned into a JSON error response.
 * `Ticket not found` / `Project not found` map to 404; everything else to 400
 * (the underlying query functions throw plain Errors on bad input).
 */
export function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void runAsUser(req.willetUser ?? "local", () => handler(req, res)).catch((err: unknown) => {
      if (res.headersSent) return next(err);
      const message = err instanceof Error ? err.message : "Internal server error";
      if (/not found/i.test(message)) {
        sendError(res, 404, message);
      } else {
        sendError(res, 400, message);
      }
    });
  };
}

/** Bearer-secret auth middleware reading the current (hot-reloaded) config. */
function makeAuth(provider: WilletAuthProvider) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      sendError(res, 401, "Missing or malformed Authorization header. Send `Authorization: Bearer <secret>`.");
      return;
    }
    const username = findUserBySecret(provider.config, match[1].trim());
    if (!username) {
      sendError(res, 401, "Invalid API secret. Use a secret from a [users.<name>] entry in your Willet config file.");
      return;
    }
    req.willetUser = username;
    next();
  };
}

export function createRestRouter(deps: RestDeps): Router {
  const router = Router();

  // Serve the OpenAPI contract (no auth required).
  router.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });

  router.use(express.json());

  const auth = makeAuth(deps.provider);

  // GET /me — identity synthesized from the authenticated username.
  router.get(
    "/me",
    auth,
    wrap(async (req, res) => {
      const username = req.willetUser!;
      res.status(200).json({
        user: { id: username, email: "", name: username },
        token: { scope: "user", accessLevel: "read_write", projectId: null },
      });
    }),
  );

  // Data-plane routes (tickets, links, stats, tags, board).
  registerTicketRoutes(router, auth);
  // Project / organization routes (mapped onto OSS flat projects).
  registerProjectRoutes(router, auth);
  // Hosted-only endpoints → 501 with a self-deploy message.
  registerStubRoutes(router, auth);

  return router;
}
