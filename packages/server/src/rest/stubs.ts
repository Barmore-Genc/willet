// Hosted-only endpoints that don't apply to a self-deployed instance. Each
// returns HTTP 501 with a JSON body explaining the self-hosted alternative, so
// a client reading the error knows exactly what to do.

import type { RequestHandler, Router } from "express";
import { sendError } from "./router.js";

function notImplemented(message: string): RequestHandler {
  return (_req, res) => sendError(res, 501, message);
}

export function registerStubRoutes(router: Router, auth: RequestHandler): void {
  // --- Organizations: a single implicit org, not configurable via the API ---

  router.post(
    "/organizations",
    auth,
    notImplemented(
      "Self-deploy has a single implicit organization. Create projects directly with POST /organizations/{orgSlug}/projects.",
    ),
  );
  router.patch(
    "/organizations/:orgSlug",
    auth,
    notImplemented("Organization settings aren't configurable in self-deploy; there is a single implicit organization."),
  );
  router.delete(
    "/organizations/:orgSlug",
    auth,
    notImplemented("Organization deletion isn't supported in self-deploy; there is a single implicit organization."),
  );

  // --- Organization members: managed via the server config file ---

  const memberMessage =
    "Users are managed in the server config file. Add a [users.NAME] section with a secret to your Willet config (see config.example.toml) and reload; invitations and roles aren't used in self-deploy.";
  router.get("/organizations/:orgSlug/members", auth, notImplemented(memberMessage));
  router.post("/organizations/:orgSlug/members", auth, notImplemented(memberMessage));
  router.patch("/organizations/:orgSlug/members/:userId", auth, notImplemented(memberMessage));
  router.delete("/organizations/:orgSlug/members/:userId", auth, notImplemented(memberMessage));

  // --- Project key prefix / deletion / restore ---

  router.patch(
    "/organizations/:orgSlug/projects/:projectSlug",
    auth,
    notImplemented("Self-deploy doesn't use project key prefixes."),
  );
  router.delete(
    "/organizations/:orgSlug/projects/:projectSlug",
    auth,
    notImplemented("Project deletion via the API isn't supported in self-deploy."),
  );
  router.post(
    "/organizations/:orgSlug/projects/:projectSlug/restore",
    auth,
    notImplemented("Project restore via the API isn't supported in self-deploy; projects can't be deleted through the API."),
  );

  // --- Project members: no per-project membership in self-deploy ---

  const projectMemberMessage =
    "Self-deploy has no per-project membership; every user configured in the server config file can access all projects.";
  router.get("/organizations/:orgSlug/projects/:projectSlug/members", auth, notImplemented(projectMemberMessage));
  router.post("/organizations/:orgSlug/projects/:projectSlug/members", auth, notImplemented(projectMemberMessage));
  router.patch(
    "/organizations/:orgSlug/projects/:projectSlug/members/:userId",
    auth,
    notImplemented(projectMemberMessage),
  );
  router.delete(
    "/organizations/:orgSlug/projects/:projectSlug/members/:userId",
    auth,
    notImplemented(projectMemberMessage),
  );

  // --- GitHub integration: a Willet Cloud feature ---

  const githubMessage = "GitHub integration is a Willet Cloud feature and isn't available in self-deploy.";
  router.get("/organizations/:orgSlug/projects/:projectSlug/github-repos", auth, notImplemented(githubMessage));
  router.post("/organizations/:orgSlug/projects/:projectSlug/github-repos", auth, notImplemented(githubMessage));
  router.delete("/organizations/:orgSlug/github-repos/:mappingId", auth, notImplemented(githubMessage));
}
