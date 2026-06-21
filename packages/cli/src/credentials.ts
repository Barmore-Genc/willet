// Local store for the interactive login token.
//
// Persisted at ~/.willet/credentials.json with restrictive permissions: the
// directory is 0700 and the file 0600, since the token is a bearer credential.
// An expired token is treated as absent so callers transparently fall back to
// "please log in" instead of sending a dead token.

import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "node:fs";

export interface StoredCredentials {
  token: string;
  /** ISO-8601 expiry returned by the server when the token was minted. */
  expiresAt: string;
  /** The API URL the token was issued for, recorded for diagnostics. */
  apiUrl: string;
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Path to the ~/.willet config directory (overridable via $HOME in tests). */
export function configDir(home: string = homedir()): string {
  return join(home, ".willet");
}

function credentialsPath(home: string = homedir()): string {
  return join(configDir(home), "credentials.json");
}

/** Write credentials, ensuring the dir/file carry owner-only permissions. */
export function saveCredentials(
  creds: StoredCredentials,
  home: string = homedir(),
): void {
  const dir = configDir(home);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // mkdirSync's mode is masked by umask and skipped if the dir already exists,
  // so set it explicitly to guarantee 0700.
  chmodSync(dir, DIR_MODE);
  const path = credentialsPath(home);
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

function isExpired(expiresAt: string, now: Date): boolean {
  const ms = Date.parse(expiresAt);
  // An unparseable expiry is treated as expired rather than trusting a bad row.
  return Number.isNaN(ms) || ms <= now.getTime();
}

/**
 * Load stored credentials, or null if none exist, the file is unreadable, or
 * the token has expired.
 */
export function loadCredentials(
  home: string = homedir(),
  now: Date = new Date(),
): StoredCredentials | null {
  let raw: string;
  try {
    raw = readFileSync(credentialsPath(home), "utf8");
  } catch {
    return null;
  }
  let parsed: Partial<StoredCredentials>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredCredentials>;
  } catch {
    return null;
  }
  if (
    typeof parsed.token !== "string" ||
    typeof parsed.expiresAt !== "string" ||
    typeof parsed.apiUrl !== "string"
  ) {
    return null;
  }
  if (isExpired(parsed.expiresAt, now)) {
    return null;
  }
  return { token: parsed.token, expiresAt: parsed.expiresAt, apiUrl: parsed.apiUrl };
}

/** Remove the stored credentials. Succeeds even if nothing was stored. */
export function clearCredentials(home: string = homedir()): void {
  rmSync(credentialsPath(home), { force: true });
}
