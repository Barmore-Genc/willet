import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WilletAuthProvider } from "./auth/provider.js";
import { runAsUser } from "@willet/shared";
import type { WilletConfig } from "./config.js";

export interface HttpServerHandle {
  server: ReturnType<import("express").Express["listen"]>;
  provider: WilletAuthProvider;
  close: () => Promise<void>;
}

export async function startHttpServer(
  config: WilletConfig,
  createServer: (serverOptions: { validAssignees: string[] }) => Promise<McpServer>,
  options?: { skipProcessHandlers?: boolean }
): Promise<HttpServerHandle> {
  const provider = new WilletAuthProvider(config);
  const baseUrl = new URL(config.server.base_url);
  const mcpUrl = new URL("/mcp", baseUrl);

  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // OAuth routes (discovery, /authorize, /token, /register)
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: baseUrl,
      baseUrl,
    })
  );

  // Handle the authorize form submission
  app.post(
    "/authorize/submit",
    express.urlencoded({ extended: false }),
    (req, res) => {
      const { client_id, secret, redirect_uri, code_challenge, state, scopes, resource } =
        req.body;

      if (!client_id || !secret || !redirect_uri || !code_challenge) {
        res.status(400).send("Missing required fields");
        return;
      }

      const result = provider.submitAuthorization({
        clientId: client_id,
        secret,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        state,
        scopes,
        resource,
      });

      if ("error" in result) {
        res.status(401).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Willet - Authentication Failed</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 400px; margin: 80px auto; padding: 0 20px; }
    h1 { font-size: 1.5rem; }
    .error { color: #c00; }
  </style>
</head>
<body>
  <h1>Willet</h1>
  <p class="error">${result.error}</p>
  <p><a href="javascript:history.back()">Try again</a></p>
</body>
</html>`);
        return;
      }

      const targetUrl = new URL(result.redirectUri);
      targetUrl.searchParams.set("code", result.code);
      if (result.state) {
        targetUrl.searchParams.set("state", result.state);
      }
      res.redirect(targetUrl.toString());
    }
  );

  // Auth middleware for MCP endpoints
  const authMiddleware = requireBearerAuth({
    verifier: provider,
    requiredScopes: [],
  });

  // Session management
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // MCP POST endpoint
  app.post("/mcp", authMiddleware, async (req, res) => {
    const username = (req.auth?.extra?.username as string) ?? "local";
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) transports.delete(sid);
        };

        const server = await createServer({ validAssignees: Object.keys(provider.config.users) });
        await server.connect(transport);
        await runAsUser(username, () =>
          transport.handleRequest(req, res, req.body)
        );
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
          id: null,
        });
        return;
      }

      await runAsUser(username, () =>
        transport.handleRequest(req, res, req.body)
      );
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // MCP GET endpoint (SSE streams)
  app.get("/mcp", authMiddleware, async (req, res) => {
    const username = (req.auth?.extra?.username as string) ?? "local";
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId)!;
    await runAsUser(username, () => transport.handleRequest(req, res));
  });

  // MCP DELETE endpoint (session termination)
  app.delete("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  const port = config.server.port;
  const httpServer = app.listen(port, () => {
    console.log(`Willet HTTP server listening on port ${port}`);
    console.log(`MCP endpoint: ${mcpUrl}`);
    console.log(
      `Users: ${Object.keys(config.users).join(", ")}`
    );
  });

  const closeServer = async () => {
    for (const [sid, transport] of transports) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`Error closing session ${sid}:`, error);
      }
    }
    transports.clear();
    httpServer.close();
  };

  if (!options?.skipProcessHandlers) {
    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("Shutting down...");
      await closeServer();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("Shutting down...");
      await closeServer();
      process.exit(0);
    });

    // Hot-reload config
    const { watchConfig } = await import("./config.js");
    watchConfig(process.env.WILLET_CONFIG!, (newConfig) => {
      provider.config = newConfig;
      console.log(
        `Config reloaded. Users: ${Object.keys(newConfig.users).join(", ")}`
      );
    });
  }

  return { server: httpServer, provider, close: closeServer };
}
