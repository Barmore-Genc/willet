import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram } from "./index.js";

afterEach(() => vi.restoreAllMocks());

describe("buildProgram", () => {
  it("registers the auth, data, and management command groups", () => {
    const names = buildProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toEqual([
      "github",
      "login",
      "logout",
      "org",
      "project",
      "render",
      "ticket",
      "whoami",
    ]);
  });

  it("renders help listing the commands", () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain("login");
    expect(help).toContain("logout");
    expect(help).toContain("whoami");
    expect(help).toContain("dashboard"); // logout's revoke-everywhere note
  });

  it("logout action runs end-to-end and sets exit code 0", async () => {
    // Redirect HOME so clearCredentials touches only a temp dir.
    const home = mkdtempSync(join(tmpdir(), "willet-cli-prog-"));
    const origHome = process.env.HOME;
    process.env.HOME = home;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(["node", "willet", "logout"]);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = undefined;
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
