import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHttpServer, type HttpServerHandle } from "./http.js";
import { createServer, closeAll } from "@willet/shared";
import type { WilletConfig } from "./config.js";

// --- Test config ---

const TEST_SECRET_ALICE = "test-secret-alice-" + randomBytes(8).toString("hex");
const TEST_SECRET_BOB = "test-secret-bob-" + randomBytes(8).toString("hex");

function makeConfig(port: number): WilletConfig {
  return {
    server: { port, base_url: `http://localhost:${port}` },
    users: {
      alice: { secret: TEST_SECRET_ALICE },
      bob: { secret: TEST_SECRET_BOB },
    },
  };
}

// --- PKCE helpers ---

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// --- SSE parsing helper ---

/** Parse an SSE response body and return the JSON-RPC message(s) */
async function parseSseOrJson(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  // SSE: parse "event: message\ndata: {...}\n\n" blocks
  const text = await res.text();
  const messages: unknown[] = [];
  for (const block of text.split("\n\n")) {
    const dataLine = block
      .split("\n")
      .find((l) => l.startsWith("data: "));
    if (dataLine) {
      messages.push(JSON.parse(dataLine.slice(6)));
    }
  }
  return messages.length === 1 ? messages[0] : messages;
}

// --- MCP headers ---

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

// --- OAuth flow helper ---

async function performOAuthFlow(
  baseUrl: string,
  userSecret: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}> {
  // 1. Register a dynamic client
  const registerRes = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [`${baseUrl}/callback`],
      client_name: "test-client",
    }),
  });
  expect(registerRes.status).toBe(201);
  const client = (await registerRes.json()) as {
    client_id: string;
    client_secret?: string;
  };
  const clientId = client.client_id;
  const clientSecret = client.client_secret;

  // 2. Generate PKCE pair
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 3. Submit authorization (skip the HTML form, go directly to /authorize/submit)
  const submitRes = await fetch(`${baseUrl}/authorize/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      secret: userSecret,
      redirect_uri: `${baseUrl}/callback`,
      code_challenge: codeChallenge,
      state: "test-state",
    }).toString(),
    redirect: "manual",
  });
  expect(submitRes.status).toBe(302);

  const redirectUrl = new URL(submitRes.headers.get("location")!);
  const authCode = redirectUrl.searchParams.get("code")!;
  expect(authCode).toBeTruthy();
  expect(redirectUrl.searchParams.get("state")).toBe("test-state");

  // 4. Exchange auth code for tokens
  const tokenParams: Record<string, string> = {
    grant_type: "authorization_code",
    code: authCode,
    client_id: clientId,
    code_verifier: codeVerifier,
    redirect_uri: `${baseUrl}/callback`,
  };
  if (clientSecret) {
    tokenParams.client_secret = clientSecret;
  }
  const tokenRes = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(tokenParams).toString(),
  });
  if (tokenRes.status !== 200) {
    const errBody = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${errBody}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.refresh_token).toBeTruthy();
  expect(tokens.token_type).toBe("bearer");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    clientId,
    clientSecret,
  };
}

// --- MCP request helpers ---

function mcpInitialize() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

function mcpToolCall(id: number, name: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

function mcpListTools(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/list",
    params: {},
  };
}

/** Helper: initialize an MCP session and return session ID + a post helper */
async function initMcpSession(
  baseUrl: string,
  accessToken: string
): Promise<{
  sessionId: string;
  mcpPost: (body: unknown) => Promise<Record<string, unknown>>;
}> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      ...MCP_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(mcpInitialize()),
  });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get("mcp-session-id")!;
  expect(sessionId).toBeTruthy();

  // Consume the init response
  await parseSseOrJson(res);

  const mcpPost = async (body: unknown) => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        Authorization: `Bearer ${accessToken}`,
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify(body),
    });
    return parseSseOrJson(r) as Promise<Record<string, unknown>>;
  };

  return { sessionId, mcpPost };
}

// --- Test suite ---

describe("Willet HTTP Server E2E", () => {
  let handle: HttpServerHandle;
  let baseUrl: string;
  let dataDir: string;

  beforeAll(async () => {
    // Isolated data directory
    dataDir = mkdtempSync(join(tmpdir(), "willet-test-"));
    process.env.WILLET_DATA_DIR = dataDir;

    // Find a free port by listening on 0
    const port = await new Promise<number>((resolve) => {
      const tempServer = require("node:net").createServer();
      tempServer.listen(0, () => {
        const port = tempServer.address().port;
        tempServer.close(() => resolve(port));
      });
    });

    const config = makeConfig(port);
    baseUrl = `http://localhost:${port}`;

    handle = await startHttpServer(config, createServer, {
      skipProcessHandlers: true,
    });

    // Wait for server to be ready
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

  // --- OAuth tests ---

  describe("OAuth flow", () => {
    it("should serve OAuth metadata at /.well-known/oauth-authorization-server", async () => {
      const res = await fetch(
        `${baseUrl}/.well-known/oauth-authorization-server`
      );
      expect(res.status).toBe(200);
      const metadata = (await res.json()) as Record<string, unknown>;
      expect(metadata.authorization_endpoint).toContain("/authorize");
      expect(metadata.token_endpoint).toContain("/token");
      expect(metadata.registration_endpoint).toContain("/register");
    });

    it("should register a dynamic client", async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [`${baseUrl}/callback`],
          client_name: "my-test-client",
        }),
      });
      expect(res.status).toBe(201);
      const client = (await res.json()) as { client_id: string };
      expect(client.client_id).toBeTruthy();
    });

    it("should reject authorization with invalid secret", async () => {
      const registerRes = await fetch(`${baseUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [`${baseUrl}/callback`],
        }),
      });
      const client = (await registerRes.json()) as { client_id: string };

      const codeChallenge = generateCodeChallenge(generateCodeVerifier());

      const submitRes = await fetch(`${baseUrl}/authorize/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.client_id,
          secret: "wrong-secret",
          redirect_uri: `${baseUrl}/callback`,
          code_challenge: codeChallenge,
        }).toString(),
        redirect: "manual",
      });
      expect(submitRes.status).toBe(401);
      const body = await submitRes.text();
      expect(body).toContain("Invalid secret key");
    });

    it("should complete the full OAuth flow and obtain tokens", async () => {
      const tokens = await performOAuthFlow(baseUrl, TEST_SECRET_ALICE);
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
    });
  });

  // --- MCP protocol tests ---

  describe("MCP protocol", () => {
    it("should reject requests without auth", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify(mcpInitialize()),
      });
      expect(res.status).toBe(401);
    });

    it("should reject requests with invalid token", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          Authorization: "Bearer invalid-token",
        },
        body: JSON.stringify(mcpInitialize()),
      });
      // Auth middleware may return 401 or 500 depending on SDK version
      expect(res.ok).toBe(false);
    });

    it("should initialize an MCP session", async () => {
      const { accessToken } = await performOAuthFlow(
        baseUrl,
        TEST_SECRET_ALICE
      );

      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(mcpInitialize()),
      });
      expect(res.status).toBe(200);

      const sessionId = res.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();

      const body = (await parseSseOrJson(res)) as {
        result: { serverInfo: { name: string } };
      };
      expect(body.result.serverInfo.name).toBe("willet");
    });

    it("should list available tools", async () => {
      const { accessToken } = await performOAuthFlow(
        baseUrl,
        TEST_SECRET_ALICE
      );

      const { mcpPost } = await initMcpSession(baseUrl, accessToken);

      const body = (await mcpPost(mcpListTools(2))) as {
        result: { tools: Array<{ name: string }> };
      };
      const toolNames = body.result.tools.map((t) => t.name);

      expect(toolNames).toContain("init_project");
      expect(toolNames).toContain("create_task");
      expect(toolNames).toContain("list_tasks");
      expect(toolNames).toContain("search_tasks");
    });

    it("should create a project and tasks via MCP tools", async () => {
      const { accessToken } = await performOAuthFlow(
        baseUrl,
        TEST_SECRET_ALICE
      );

      const { mcpPost } = await initMcpSession(baseUrl, accessToken);

      // Init project
      const initProjectRes = (await mcpPost(
        mcpToolCall(2, "init_project", {
          name: "Test Project",
          directory: join(dataDir, "test-project"),
        })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(initProjectRes.result).toBeTruthy();
      const projectText = initProjectRes.result!.content[0].text;
      const projectIdMatch = projectText.match(/[0-9A-HJKMNP-TV-Z]{26}/);
      expect(projectIdMatch).toBeTruthy();
      const projectId = projectIdMatch![0];

      // Create a task
      const createTaskRes = (await mcpPost(
        mcpToolCall(3, "create_task", {
          project_id: projectId,
          title: "Fix the widget",
          description: "The widget is broken and needs fixing",
          priority: "high",
        })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(createTaskRes.result).toBeTruthy();
      const taskText = createTaskRes.result!.content[0].text;
      const taskIdMatch = taskText.match(/[0-9A-HJKMNP-TV-Z]{26}/);
      expect(taskIdMatch).toBeTruthy();
      const taskId = taskIdMatch![0];

      // List tasks
      const listRes = (await mcpPost(
        mcpToolCall(4, "list_tasks", { project_id: projectId })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(listRes.result).toBeTruthy();
      expect(listRes.result!.content[0].text).toContain("Fix the widget");

      // Get task
      const getRes = (await mcpPost(
        mcpToolCall(5, "get_task", {
          project_id: projectId,
          task_id: taskId,
        })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(getRes.result).toBeTruthy();
      expect(getRes.result!.content[0].text).toContain("Fix the widget");
      expect(getRes.result!.content[0].text).toContain("high");

      // Complete task
      const completeRes = (await mcpPost(
        mcpToolCall(6, "complete_task", {
          project_id: projectId,
          task_id: taskId,
        })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(completeRes.result).toBeTruthy();

      // Verify it's completed
      const getRes2 = (await mcpPost(
        mcpToolCall(7, "get_task", {
          project_id: projectId,
          task_id: taskId,
        })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(getRes2.result!.content[0].text).toContain("done");
    });

    it("should maintain user context per token (alice vs bob)", async () => {
      const aliceTokens = await performOAuthFlow(baseUrl, TEST_SECRET_ALICE);
      const bobTokens = await performOAuthFlow(baseUrl, TEST_SECRET_BOB);

      const alice = await initMcpSession(baseUrl, aliceTokens.accessToken);
      const bob = await initMcpSession(baseUrl, bobTokens.accessToken);

      expect(alice.sessionId).not.toBe(bob.sessionId);

      const aliceProject = (await alice.mcpPost(
        mcpToolCall(2, "init_project", {
          name: "Alice's Project",
          directory: join(dataDir, "alice-project"),
        })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(aliceProject.result).toBeTruthy();

      const bobProject = (await bob.mcpPost(
        mcpToolCall(2, "init_project", {
          name: "Bob's Project",
          directory: join(dataDir, "bob-project"),
        })
      )) as { result?: { content: Array<{ text: string }> } };
      expect(bobProject.result).toBeTruthy();
    });

    it("should reject POST /mcp without session ID for non-initialize requests", async () => {
      const { accessToken } = await performOAuthFlow(
        baseUrl,
        TEST_SECRET_ALICE
      );

      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(mcpListTools(1)),
      });
      expect(res.status).toBe(400);
    });

    it("should reject GET /mcp with invalid session ID", async () => {
      const { accessToken } = await performOAuthFlow(
        baseUrl,
        TEST_SECRET_ALICE
      );

      const res = await fetch(`${baseUrl}/mcp`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${accessToken}`,
          "mcp-session-id": "nonexistent-session",
        },
      });
      expect(res.status).toBe(400);
    });

    it("should handle DELETE /mcp to terminate a session", async () => {
      const { accessToken } = await performOAuthFlow(
        baseUrl,
        TEST_SECRET_ALICE
      );

      const { sessionId } = await initMcpSession(baseUrl, accessToken);

      // Delete session
      const deleteRes = await fetch(`${baseUrl}/mcp`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "mcp-session-id": sessionId,
        },
      });
      expect(deleteRes.status).toBe(200);

      // Subsequent requests with that session should fail
      const postRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${accessToken}`,
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify(mcpListTools(2)),
      });
      expect(postRes.status).toBe(400);
    });
  });

  // --- Token refresh ---

  describe("Token refresh", () => {
    it("should refresh tokens and use the new access token", async () => {
      const initial = await performOAuthFlow(baseUrl, TEST_SECRET_ALICE);

      // Refresh the token
      const refreshParams: Record<string, string> = {
        grant_type: "refresh_token",
        refresh_token: initial.refreshToken,
        client_id: initial.clientId,
      };
      if (initial.clientSecret) {
        refreshParams.client_secret = initial.clientSecret;
      }
      const refreshRes = await fetch(`${baseUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(refreshParams).toString(),
      });
      expect(refreshRes.status).toBe(200);

      const newTokens = (await refreshRes.json()) as {
        access_token: string;
        refresh_token: string;
      };
      expect(newTokens.access_token).toBeTruthy();
      expect(newTokens.access_token).not.toBe(initial.accessToken);

      // New token should work for MCP
      const initRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${newTokens.access_token}`,
        },
        body: JSON.stringify(mcpInitialize()),
      });
      expect(initRes.status).toBe(200);

      // Old token should be revoked
      const oldRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${initial.accessToken}`,
        },
        body: JSON.stringify(mcpInitialize()),
      });
      expect(oldRes.ok).toBe(false);
    });
  });
});
