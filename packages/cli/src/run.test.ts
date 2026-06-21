import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, EXIT, type FetchResult } from "./run.js";
import type { WilletClient } from "./client.js";

afterEach(() => vi.restoreAllMocks());

const stubClient = {} as WilletClient;
const ok = <T>(data: T, status = 200): FetchResult<T> => ({
  data,
  response: new Response(null, { status }),
});
const fail = (status: number, error: unknown): FetchResult<never> => ({
  error,
  response: new Response(null, { status }),
});

describe("run", () => {
  it("prints a human summary on success and returns 0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await run(
      false,
      async () => ok({ total: 1 }),
      () => "human",
      { client: stubClient },
    );
    expect(code).toBe(EXIT.ok);
    expect(log).toHaveBeenCalledWith("human");
  });

  it("prints raw JSON with --json", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await run(
      true,
      async () => ok({ a: 1 }),
      () => "human",
      { client: stubClient },
    );
    expect(code).toBe(EXIT.ok);
    expect(log.mock.calls[0][0]).toContain('"a": 1');
  });

  it.each([
    [401, EXIT.auth],
    [403, EXIT.forbidden],
    [404, EXIT.notFound],
    [500, EXIT.generic],
  ])("maps HTTP %i to exit code %i and prints the server error", async (status, expected) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await run(
      false,
      async () => fail(status, { error: "boom" }),
      () => "human",
      { client: stubClient },
    );
    expect(code).toBe(expected);
    expect(err).toHaveBeenCalledWith("boom");
  });

  it("returns 1 and prints the message when the request throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await run(
      false,
      async () => {
        throw new Error("network down");
      },
      () => "human",
      { client: stubClient },
    );
    expect(code).toBe(EXIT.generic);
    expect(err).toHaveBeenCalledWith("network down");
  });

  it("returns 2 with a login hint when no token resolves", async () => {
    const home = mkdtempSync(join(tmpdir(), "willet-cli-run-"));
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const code = await run(false, async () => ok({}), () => "human", {
        env: { WILLET_API_TOKEN: "" },
      });
      expect(code).toBe(EXIT.auth);
      expect(err.mock.calls.flat().join(" ")).toContain("Not logged in");
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
