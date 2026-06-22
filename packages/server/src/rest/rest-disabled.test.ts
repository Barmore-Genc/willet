import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHttpServer, type HttpServerHandle } from "../http.js";
import { createServer, closeAll } from "@willet/shared";
import type { WilletConfig } from "../config.js";

const TEST_SECRET = "test-secret-disabled-" + randomBytes(8).toString("hex");

function makeConfig(port: number): WilletConfig {
  return {
    server: { port, base_url: `http://localhost:${port}`, rest_api: false },
    users: { alice: { secret: TEST_SECRET } },
  };
}

describe("REST API disabled (server.rest_api = false)", () => {
  let handle: HttpServerHandle;
  let baseUrl: string;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "willet-rest-disabled-"));
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

  it("does not mount /api/v1 routes", async () => {
    const me = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });
    expect(me.status).toBe(404);

    // The OpenAPI doc (normally served without auth) is gone too.
    const spec = await fetch(`${baseUrl}/api/v1/openapi.json`);
    expect(spec.status).toBe(404);
  });

  it("still serves the MCP OAuth metadata", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
  });
});
