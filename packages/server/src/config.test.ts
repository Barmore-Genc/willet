import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, restApiEnabled, type WilletConfig } from "./config.js";

function writeConfig(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "willet-config-test-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, body);
  return path;
}

const dirs: string[] = [];
function tempConfig(body: string): string {
  const path = writeConfig(body);
  dirs.push(path);
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(join(dirs.pop()!, ".."), { recursive: true, force: true });
});

const BASE = `
[server]
port = 3000
base_url = "https://willet.example.com"
[users.alice]
secret = "s3cret"
`;

describe("restApiEnabled", () => {
  it("defaults to true when rest_api is unset", () => {
    const config = { server: { port: 3000, base_url: "x" }, users: {} } as WilletConfig;
    expect(restApiEnabled(config)).toBe(true);
  });

  it("is false only when rest_api is explicitly false", () => {
    const make = (rest_api?: boolean) =>
      ({ server: { port: 3000, base_url: "x", rest_api }, users: {} }) as WilletConfig;
    expect(restApiEnabled(make(true))).toBe(true);
    expect(restApiEnabled(make(false))).toBe(false);
    expect(restApiEnabled(make(undefined))).toBe(true);
  });
});

describe("loadConfig rest_api validation", () => {
  it("accepts rest_api under [server]", () => {
    const path = tempConfig(`
[server]
port = 3000
base_url = "https://willet.example.com"
rest_api = false
[users.alice]
secret = "s3cret"
`);
    const config = loadConfig(path);
    expect(restApiEnabled(config)).toBe(false);
  });

  it("defaults to enabled when omitted", () => {
    const config = loadConfig(tempConfig(BASE));
    expect(restApiEnabled(config)).toBe(true);
  });

  it("rejects a non-boolean rest_api", () => {
    const path = tempConfig(`
[server]
port = 3000
base_url = "https://willet.example.com"
rest_api = "yes"
[users.alice]
secret = "s3cret"
`);
    expect(() => loadConfig(path)).toThrow(/rest_api must be a boolean/);
  });
});
