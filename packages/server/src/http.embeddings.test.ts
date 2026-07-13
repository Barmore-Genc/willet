import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WilletConfig } from "./config.js";

// Spy on initEmbeddings while leaving the rest of @willet/shared real. The
// REST routes call the shared query functions directly and never construct an
// MCP server, so startHttpServer is the only thing that can initialize the
// embedding runtime for them (WD-80).
const initEmbeddings = vi.fn(async () => {});

vi.mock("@willet/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@willet/shared")>();
  return { ...actual, initEmbeddings };
});

const { startHttpServer } = await import("./http.js");
const { closeAll } = await import("@willet/shared");

describe("startHttpServer embeddings initialization", () => {
  let handle: Awaited<ReturnType<typeof startHttpServer>>;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "willet-embed-test-"));
    process.env.WILLET_DATA_DIR = dataDir;

    const port = await new Promise<number>((resolve) => {
      const tempServer = require("node:net").createServer();
      tempServer.listen(0, () => {
        const p = tempServer.address().port;
        tempServer.close(() => resolve(p));
      });
    });

    const config: WilletConfig = {
      server: { port, base_url: `http://localhost:${port}` },
      users: { alice: { secret: "test-secret" } },
    };

    handle = await startHttpServer(
      config,
      // Never invoked: no MCP client connects in this suite.
      () => {
        throw new Error("createServer should not be needed to initialize embeddings");
      },
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

  it("initializes embeddings at startup, without waiting for an MCP connection", () => {
    expect(initEmbeddings).toHaveBeenCalledTimes(1);
  });
});
