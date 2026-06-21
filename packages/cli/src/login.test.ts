import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { ApiClient, type FetchLike } from "./api.js";
import { loginCommand } from "./commands/login.js";
import { configDir } from "./credentials.js";

// loginCommand persists via saveCredentials(), which uses homedir(). Redirect
// HOME to a temp dir so the test never writes to the real home.
let home: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "willet-cli-login-"));
  origHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// fetch's first arg is RequestInfo | URL; normalize to a path-comparable string.
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function authHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

describe("loginCommand", () => {
  it("polls to approval, persists the token, and prints identity", async () => {
    // homedir() must resolve to our temp HOME for the assertion below.
    expect(homedir()).toBe(home);

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const start = {
      deviceCode: "dev-code",
      userCode: "ABCD-1234",
      verificationUri: "https://x/activate",
      verificationUriComplete: "https://x/activate?code=ABCD-1234",
      interval: 0,
      expiresAt,
    };

    let meAuth: string | undefined;
    const fetchImpl = vi.fn<FetchLike>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith("/api/cli-auth/device")) return jsonResponse(start);
      if (url.endsWith("/api/cli-auth/token")) {
        return jsonResponse({
          status: "approved",
          token: "minted-token",
          tokenType: "Bearer",
          expiresAt,
        });
      }
      if (url.endsWith("/api/v1/me")) {
        meAuth = authHeader(init);
        return jsonResponse({
          user: { id: "u1", email: "a@b.test", name: "Ada" },
          token: { scope: "user", accessLevel: "write", projectId: null },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const client = new ApiClient("https://x.test", fetchImpl as FetchLike);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await loginCommand({
      env: { WILLET_API_URL: "https://x.test" },
      client,
      openBrowser: async () => false,
    });

    expect(code).toBe(0);
    expect(meAuth).toBe("Bearer minted-token");
    expect(existsSync(join(configDir(home), "credentials.json"))).toBe(true);
    expect(log.mock.calls.flat().join("\n")).toContain("Logged in as Ada");
  });

  it("refuses when WILLET_API_TOKEN is set", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await loginCommand({ env: { WILLET_API_TOKEN: "wlt_env" } });
    expect(code).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("WILLET_API_TOKEN");
  });

  it("reports denied", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input) => {
      const url = urlOf(input);
      if (url.endsWith("/device"))
        return jsonResponse({
          deviceCode: "d",
          userCode: "C",
          verificationUri: "u",
          verificationUriComplete: "uc",
          interval: 0,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      return jsonResponse({ status: "denied" });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new ApiClient("https://x.test", fetchImpl as FetchLike);
    const code = await loginCommand({
      env: {},
      client,
      openBrowser: async () => true,
    });
    expect(code).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("denied");
  });
});
