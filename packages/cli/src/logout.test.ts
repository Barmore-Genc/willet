import { describe, it, expect, vi, afterEach } from "vitest";
import { logoutCommand } from "./commands/logout.js";

afterEach(() => vi.restoreAllMocks());

describe("logoutCommand", () => {
  it("clears creds and notes dashboard revocation", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = logoutCommand();
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("Logged out");
    expect(out).toContain("dashboard");
  });
});
