import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiClient, type FetchLike, type Identity } from "./api.js";
import { whoamiCommand, formatIdentity } from "./commands/whoami.js";

afterEach(() => vi.restoreAllMocks());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const identity: Identity = {
  user: { id: "u1", email: "a@b.test", name: "Ada" },
  token: { scope: "project", accessLevel: "read", projectId: "p1" },
};

describe("formatIdentity", () => {
  it("includes project when present", () => {
    expect(formatIdentity(identity)).toContain("project=p1");
  });
  it("omits project when null", () => {
    const out = formatIdentity({
      ...identity,
      token: { ...identity.token, projectId: null },
    });
    expect(out).not.toContain("project=");
  });
});

describe("whoamiCommand", () => {
  it("prints identity using the env token", async () => {
    let auth: string | undefined;
    const fetchImpl = vi.fn<FetchLike>(async (_input, init) => {
      auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      return jsonResponse(identity);
    });
    const client = new ApiClient("https://x.test", fetchImpl as FetchLike);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await whoamiCommand({ env: { WILLET_API_TOKEN: "wlt_env" }, client });
    expect(code).toBe(0);
    expect(auth).toBe("Bearer wlt_env");
    expect(log.mock.calls.flat().join("\n")).toContain("Logged in as Ada");
  });

  it("errors with login hint when no token resolves", async () => {
    // Point HOME at an empty dir so loadCredentials finds nothing.
    const home = mkdtempSync(join(tmpdir(), "willet-cli-whoami-"));
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const code = await whoamiCommand({ env: { WILLET_API_TOKEN: "" } });
      expect(code).toBe(1);
      expect(err.mock.calls.flat().join(" ")).toContain("Not logged in");
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("maps 401 to a login prompt", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, 401));
    const client = new ApiClient("https://x.test", fetchImpl as FetchLike);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await whoamiCommand({ env: { WILLET_API_TOKEN: "bad" }, client });
    expect(code).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("401");
  });

  it("reports other errors", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, 500));
    const client = new ApiClient("https://x.test", fetchImpl as FetchLike);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await whoamiCommand({ env: { WILLET_API_TOKEN: "x" }, client });
    expect(code).toBe(1);
    expect(err).toHaveBeenCalled();
  });
});
