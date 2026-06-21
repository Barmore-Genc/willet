import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  credentialSlug,
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
const URL_A = "https://willet.bgenc.dev";
const URL_B = "https://willet.internal.example";

/** The on-disk path for a target's credential file. */
function tokenFile(apiUrl: string): string {
  return join(configDir(home), "credentials", `${credentialSlug(apiUrl)}.token`);
}

describe("credentialSlug", () => {
  it("derives a hostname-based stem", () => {
    expect(credentialSlug("https://willet.bgenc.dev")).toBe("willet.bgenc.dev");
    expect(credentialSlug("https://willet.internal.example")).toBe("willet.internal.example");
  });

  it("includes the port and non-root path", () => {
    expect(credentialSlug("http://localhost:3000")).toBe("localhost_3000");
    expect(credentialSlug("https://example.com/willet")).toBe("example.com_willet");
  });

  it("sanitizes unsafe characters and never escapes the directory", () => {
    const slug = credentialSlug("https://evil/../../etc/passwd");
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("..");
    expect(slug.startsWith(".")).toBe(false);
  });

  it("falls back to a default stem for an unparseable URL", () => {
    expect(credentialSlug("")).toBe("default");
  });
});

describe("credentials store", () => {
  it("round-trips a saved token, keyed by target", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: URL_A }, home);
    expect(loadCredentials(URL_A, home)).toEqual({ token: "tok", expiresAt: future, apiUrl: URL_A });
  });

  it("isolates tokens per target", () => {
    saveCredentials({ token: "a", expiresAt: future, apiUrl: URL_A }, home);
    saveCredentials({ token: "b", expiresAt: future, apiUrl: URL_B }, home);
    expect(loadCredentials(URL_A, home)?.token).toBe("a");
    expect(loadCredentials(URL_B, home)?.token).toBe("b");
  });

  it("returns null for a target with no stored token", () => {
    saveCredentials({ token: "a", expiresAt: future, apiUrl: URL_A }, home);
    expect(loadCredentials(URL_B, home)).toBeNull();
  });

  it("creates dir 0700 and file 0600", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: URL_A }, home);
    const dirMode = statSync(configDir(home)).mode & 0o777;
    const fileMode = statSync(tokenFile(URL_A)).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("returns null when no file exists", () => {
    expect(loadCredentials(URL_A, home)).toBeNull();
  });

  it("treats an expired token as logged out", () => {
    saveCredentials({ token: "tok", expiresAt: past, apiUrl: URL_A }, home);
    expect(loadCredentials(URL_A, home)).toBeNull();
  });

  it("treats an unparseable expiry as expired", () => {
    saveCredentials({ token: "tok", expiresAt: "not-a-date", apiUrl: URL_A }, home);
    expect(loadCredentials(URL_A, home)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: URL_A }, home);
    writeFileSync(tokenFile(URL_A), "{not json");
    expect(loadCredentials(URL_A, home)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    mkdirSync(join(configDir(home), "credentials"), { recursive: true });
    writeFileSync(tokenFile(URL_A), JSON.stringify({ token: "tok" }));
    expect(loadCredentials(URL_A, home)).toBeNull();
  });

  it("respects the now argument for expiry checks", () => {
    saveCredentials({ token: "tok", expiresAt: future, apiUrl: URL_A }, home);
    const wayLater = new Date(Date.now() + 120_000);
    expect(loadCredentials(URL_A, home, wayLater)).toBeNull();
  });

  it("clear removes only the target's file and is idempotent", () => {
    saveCredentials({ token: "a", expiresAt: future, apiUrl: URL_A }, home);
    saveCredentials({ token: "b", expiresAt: future, apiUrl: URL_B }, home);
    clearCredentials(URL_A, home);
    expect(existsSync(tokenFile(URL_A))).toBe(false);
    expect(loadCredentials(URL_B, home)?.token).toBe("b");
    // Second clear must not throw.
    clearCredentials(URL_A, home);
  });

  it("overwriting reapplies 0600 on an existing file", () => {
    saveCredentials({ token: "a", expiresAt: future, apiUrl: URL_A }, home);
    saveCredentials({ token: "b", expiresAt: future, apiUrl: URL_A }, home);
    expect(loadCredentials(URL_A, home)?.token).toBe("b");
    expect(statSync(tokenFile(URL_A)).mode & 0o777).toBe(0o600);
  });
});
