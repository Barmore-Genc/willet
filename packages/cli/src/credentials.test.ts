import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  configDir,
} from "./credentials.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "willet-cli-creds-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

describe("credentials store", () => {
  it("round-trips a saved token", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: "https://x" }, home);
    const loaded = loadCredentials(home);
    expect(loaded).toEqual({ token: "tok", expiresAt: future, apiUrl: "https://x" });
  });

  it("creates dir 0700 and file 0600", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: "https://x" }, home);
    const dirMode = statSync(configDir(home)).mode & 0o777;
    const fileMode = statSync(join(configDir(home), "credentials.json")).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("returns null when no file exists", () => {
    expect(loadCredentials(home)).toBeNull();
  });

  it("treats an expired token as logged out", () => {
    saveCredentials({ token: "tok", expiresAt: past, apiUrl: "https://x" }, home);
    expect(loadCredentials(home)).toBeNull();
  });

  it("treats an unparseable expiry as expired", () => {
    saveCredentials({ token: "tok", expiresAt: "not-a-date", apiUrl: "https://x" }, home);
    expect(loadCredentials(home)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: "https://x" }, home);
    // Corrupt the file in place.
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(configDir(home), "credentials.json"), "{not json");
    expect(loadCredentials(home)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const { writeFileSync } = require("node:fs");
    const { mkdirSync } = require("node:fs");
    mkdirSync(configDir(home), { recursive: true });
    writeFileSync(
      join(configDir(home), "credentials.json"),
      JSON.stringify({ token: "tok" }),
    );
    expect(loadCredentials(home)).toBeNull();
  });

  it("respects the now argument for expiry checks", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: "https://x" }, home);
    const wayLater = new Date(Date.now() + 120_000);
    expect(loadCredentials(home, wayLater)).toBeNull();
  });

  it("clear removes the file and is idempotent", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: "https://x" }, home);
    expect(existsSync(join(configDir(home), "credentials.json"))).toBe(true);
    clearCredentials(home);
    expect(existsSync(join(configDir(home), "credentials.json"))).toBe(false);
    // Second clear must not throw.
    clearCredentials(home);
  });

  it("overwriting reapplies 0600 on an existing file", () => {
    saveCredentials({ token: "a", expiresAt: future, apiUrl: "https://x" }, home);
    saveCredentials({ token: "b", expiresAt: future, apiUrl: "https://y" }, home);
    expect(loadCredentials(home)?.token).toBe("b");
    const fileMode = statSync(join(configDir(home), "credentials.json")).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });
});
