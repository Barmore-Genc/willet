import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveApiUrl,
  usingDefaultApiUrl,
  loadCliConfig,
  envApiToken,
  DEFAULT_API_URL,
} from "./config.js";
import { resolveToken } from "./commands/whoami.js";

// An empty home dir keeps filesystem-reading tests hermetic: with no
// ~/.willet/config.json present, only the env arg influences resolution.
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "willet-cfg-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Write ~/.willet/config.json under the temp home. */
function writeConfig(contents: string): void {
  mkdirSync(join(home, ".willet"), { recursive: true });
  writeFileSync(join(home, ".willet", "config.json"), contents);
}

describe("resolveApiUrl", () => {
  it("defaults to production when unset", () => {
    expect(resolveApiUrl({}, home)).toBe(DEFAULT_API_URL);
  });

  it("strips trailing slashes", () => {
    expect(resolveApiUrl({ WILLET_API_URL: "https://x.test/" }, home)).toBe(
      "https://x.test",
    );
    expect(resolveApiUrl({ WILLET_API_URL: "https://x.test///" }, home)).toBe(
      "https://x.test",
    );
  });

  it("treats blank as unset", () => {
    expect(resolveApiUrl({ WILLET_API_URL: "   " }, home)).toBe(DEFAULT_API_URL);
  });

  it("falls back to the config file when env is unset", () => {
    writeConfig(JSON.stringify({ apiUrl: "https://self.test/" }));
    expect(resolveApiUrl({}, home)).toBe("https://self.test");
  });

  it("prefers the env var over the config file", () => {
    writeConfig(JSON.stringify({ apiUrl: "https://file.test" }));
    expect(resolveApiUrl({ WILLET_API_URL: "https://env.test" }, home)).toBe(
      "https://env.test",
    );
  });
});

describe("usingDefaultApiUrl", () => {
  it("is true when no env or config target is set", () => {
    expect(usingDefaultApiUrl({}, home)).toBe(true);
  });

  it("is false when the env var targets a deployment", () => {
    expect(usingDefaultApiUrl({ WILLET_API_URL: "https://x.test" }, home)).toBe(
      false,
    );
  });

  it("is false when the config file targets a deployment", () => {
    writeConfig(JSON.stringify({ apiUrl: "https://self.test" }));
    expect(usingDefaultApiUrl({}, home)).toBe(false);
  });
});

describe("loadCliConfig", () => {
  it("returns null when no config file exists", () => {
    expect(loadCliConfig(home)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    writeConfig("{ not json");
    expect(loadCliConfig(home)).toBeNull();
  });

  it("parses a valid config file", () => {
    writeConfig(JSON.stringify({ apiUrl: "https://self.test" }));
    expect(loadCliConfig(home)).toEqual({ apiUrl: "https://self.test" });
  });
});

describe("envApiToken", () => {
  it("returns the token when set", () => {
    expect(envApiToken({ WILLET_API_TOKEN: "wlt_abc" })).toBe("wlt_abc");
  });

  it("returns undefined when blank or unset", () => {
    expect(envApiToken({})).toBeUndefined();
    expect(envApiToken({ WILLET_API_TOKEN: "  " })).toBeUndefined();
  });
});

describe("resolveToken precedence", () => {
  it("prefers WILLET_API_TOKEN, so it short-circuits before reading stored creds", () => {
    // The env token wins without ever touching the filesystem.
    expect(resolveToken({ WILLET_API_TOKEN: "wlt_env" })).toBe("wlt_env");
  });
});
