import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHttpServer, type HttpServerHandle } from "../http.js";
import { createServer, closeAll, setEmbedder, EMBEDDING_DIM } from "@willet/shared";
import type { WilletConfig } from "../config.js";

const TEST_SECRET = "test-secret-rest-" + randomBytes(8).toString("hex");

function makeConfig(port: number): WilletConfig {
  return {
    server: { port, base_url: `http://localhost:${port}` },
    users: { alice: { secret: TEST_SECRET } },
  };
}

describe("Willet REST API", () => {
  let handle: HttpServerHandle;
  let baseUrl: string;
  let dataDir: string;

  const authHeaders = { Authorization: `Bearer ${TEST_SECRET}`, "Content-Type": "application/json" };

  beforeAll(async () => {
    setEmbedder(async (text: string) => {
      const hash = createHash("sha256").update(text).digest();
      const embedding = new Float32Array(EMBEDDING_DIM);
      for (let i = 0; i < EMBEDDING_DIM; i++) embedding[i] = (hash[i % hash.length] - 128) / 128;
      return embedding;
    });

    dataDir = mkdtempSync(join(tmpdir(), "willet-rest-test-"));
    process.env.WILLET_DATA_DIR = dataDir;

    const port = await new Promise<number>((resolve) => {
      const tempServer = require("node:net").createServer();
      tempServer.listen(0, () => {
        const p = tempServer.address().port;
        tempServer.close(() => resolve(p));
      });
    });

    baseUrl = `http://localhost:${port}`;
    handle = await startHttpServer(
      makeConfig(port),
      ({ validAssignees }) => createServer({ mode: "selfhosted", validAssignees }),
      { skipProcessHandlers: true },
    );
    await new Promise<void>((resolve) => {
      handle.server.on("listening", resolve);
      if (handle.server.listening) resolve();
    });
  });

  afterAll(async () => {
    await handle.close();
    closeAll();
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.WILLET_DATA_DIR;
  });

  // --- auth ---

  it("rejects requests with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("rejects requests with an invalid secret", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("GET /me returns the authenticated username", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; name: string };
      token: { scope: string; accessLevel: string; projectId: null };
    };
    expect(body.user.id).toBe("alice");
    expect(body.user.name).toBe("alice");
    expect(body.token.scope).toBe("user");
    expect(body.token.accessLevel).toBe("read_write");
    expect(body.token.projectId).toBeNull();
  });

  // --- openapi ---

  it("serves the OpenAPI contract", async () => {
    const res = await fetch(`${baseUrl}/api/v1/openapi.json`);
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/me"]).toBeTruthy();
  });

  // --- organizations (synthetic) ---

  it("GET /organizations returns the synthetic Local org", async () => {
    const res = await fetch(`${baseUrl}/api/v1/organizations`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      organizations: Array<{ id: string; slug: string; role: string }>;
    };
    expect(body.count).toBe(1);
    expect(body.organizations[0].slug).toBe("local");
    expect(body.organizations[0].role).toBe("owner");
  });

  // --- ticket round-trip ---

  it("creates a project and a ticket, then reads it back", async () => {
    // Create a project under the implicit org.
    const projRes = await fetch(`${baseUrl}/api/v1/organizations/local/projects`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "REST Test Project" }),
    });
    expect(projRes.status).toBe(201);
    const proj = (await projRes.json()) as { id: string; slug: string; keyPrefix: null };
    expect(proj.id).toBeTruthy();
    expect(proj.slug).toBe(proj.id);
    expect(proj.keyPrefix).toBeNull();

    // It shows up in the project list.
    const listRes = await fetch(`${baseUrl}/api/v1/organizations/local/projects`, { headers: authHeaders });
    const listBody = (await listRes.json()) as { count: number; projects: Array<{ id: string }> };
    expect(listBody.projects.some((p) => p.id === proj.id)).toBe(true);

    // Create a ticket.
    const createRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/tickets`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ title: "Fix the widget", priority: "high", type: "bug" }),
    });
    expect(createRes.status).toBe(201);
    const ticket = (await createRes.json()) as { id: string; title: string; priority: string };
    expect(ticket.title).toBe("Fix the widget");
    expect(ticket.priority).toBe("high");

    // List tickets.
    const ticketsRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/tickets`, { headers: authHeaders });
    expect(ticketsRes.status).toBe(200);
    const ticketsBody = (await ticketsRes.json()) as { tickets: unknown[]; total: number };
    expect(ticketsBody.total).toBe(1);
    expect(ticketsBody.tickets).toHaveLength(1);

    // Get the ticket with comments + links.
    const getRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/tickets/${ticket.id}`, {
      headers: authHeaders,
    });
    expect(getRes.status).toBe(200);
    const detail = (await getRes.json()) as {
      title: string;
      comments: unknown[];
      links: unknown[];
    };
    expect(detail.title).toBe("Fix the widget");
    expect(Array.isArray(detail.comments)).toBe(true);
    expect(Array.isArray(detail.links)).toBe(true);

    // Complete it.
    const completeRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/tickets/${ticket.id}/complete`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ actual: "1h" }),
    });
    expect(completeRes.status).toBe(200);
    const completed = (await completeRes.json()) as { status: string; actual: string | null };
    expect(completed.status).toBe("done");

    // Stats reflect the ticket.
    const statsRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/stats`, { headers: authHeaders });
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as { total: number; byStatus: Record<string, number> };
    expect(stats.total).toBe(1);
    expect(stats.byStatus.done).toBe(1);

    // Board renders markdown.
    const boardRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/board`, { headers: authHeaders });
    expect(boardRes.status).toBe(200);
    const board = (await boardRes.json()) as { board: string };
    expect(board.board).toContain("Fix the widget");

    // Delete it.
    const delRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/tickets/${ticket.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    expect(delRes.status).toBe(200);
    const del = (await delRes.json()) as { deleted: boolean; id: string };
    expect(del.deleted).toBe(true);
    expect(del.id).toBe(ticket.id);
  });

  it("accepts valid JSON even with a non-JSON Content-Type", async () => {
    const projRes = await fetch(`${baseUrl}/api/v1/organizations/local/projects`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Content-Type Test" }),
    });
    const proj = (await projRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/tickets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}`, "Content-Type": "text/plain" },
      body: JSON.stringify({ title: "Sent as text/plain" }),
    });
    expect(res.status).toBe(201);
    const ticket = (await res.json()) as { title: string };
    expect(ticket.title).toBe("Sent as text/plain");
  });

  it("returns 400 with a clear error for an invalid JSON body", async () => {
    const projRes = await fetch(`${baseUrl}/api/v1/organizations/local/projects`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Invalid JSON Test" }),
    });
    const proj = (await projRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/tickets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}`, "Content-Type": "text/plain" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("valid JSON");
  });

  it("returns 404 for a ticket in a nonexistent project", async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/nonexistent/tickets`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });

  // --- stub endpoints ---

  it("returns 501 with an error body for hosted-only endpoints", async () => {
    const createOrg = await fetch(`${baseUrl}/api/v1/organizations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(createOrg.status).toBe(501);
    const body = (await createOrg.json()) as { error: string };
    expect(body.error).toContain("implicit organization");

    const members = await fetch(`${baseUrl}/api/v1/organizations/local/members`, { headers: authHeaders });
    expect(members.status).toBe(501);
    const membersBody = (await members.json()) as { error: string };
    expect(membersBody.error).toContain("config file");

    const github = await fetch(`${baseUrl}/api/v1/organizations/local/projects/x/github-repos`, {
      headers: authHeaders,
    });
    expect(github.status).toBe(501);
    const githubBody = (await github.json()) as { error: string };
    expect(githubBody.error).toContain("Willet Cloud");
  });

  it("requires auth on stub endpoints too", async () => {
    const res = await fetch(`${baseUrl}/api/v1/organizations`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});
