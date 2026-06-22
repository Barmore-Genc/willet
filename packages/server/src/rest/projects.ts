// Project and organization REST routes. OSS has flat projects and no orgs, so
// these map the spec's org-scoped paths onto a single implicit organization:
// `slug` = project id, `keyPrefix` = null, and GET /organizations returns one
// synthetic "Local" org so org-listing flows work.

import type { RequestHandler, Router } from "express";
import { listProjects, initProject, type Project } from "@willet/shared";
import { z } from "zod";
import { wrap } from "./router.js";
import { parseBody } from "./params.js";

function toProjectBasic(p: Project) {
  return {
    id: p.id,
    name: p.name,
    slug: p.id,
    keyPrefix: null,
    createdAt: p.created_at,
  };
}

const CreateProjectBody = z.object({
  name: z.string().min(1).max(100),
  // OSS has no key prefixes; accepted for spec compatibility but ignored.
  key_prefix: z.string().optional(),
});

export function registerProjectRoutes(router: Router, auth: RequestHandler): void {
  // GET /organizations — one synthetic org representing this self-deploy.
  router.get(
    "/organizations",
    auth,
    wrap(async (_req, res) => {
      res.status(200).json({
        count: 1,
        organizations: [
          {
            id: "local",
            name: "Local",
            slug: "local",
            plan: "free",
            role: "owner",
            createdAt: new Date(0).toISOString(),
            deleteRequestedAt: null,
            subscriptionActive: true,
          },
        ],
      });
    }),
  );

  // GET /organizations/{orgSlug}/projects — list all projects (orgSlug ignored).
  router.get(
    "/organizations/:orgSlug/projects",
    auth,
    wrap(async (_req, res) => {
      const projects = listProjects();
      res.status(200).json({
        count: projects.length,
        projects: projects.map(toProjectBasic),
      });
    }),
  );

  // POST /organizations/{orgSlug}/projects — create a project (orgSlug ignored).
  router.post(
    "/organizations/:orgSlug/projects",
    auth,
    wrap(async (req, res) => {
      const { name } = parseBody(CreateProjectBody, req.body);
      const project = initProject(name);
      res.status(201).json(toProjectBasic(project));
    }),
  );
}
