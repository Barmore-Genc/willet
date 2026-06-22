// Local store for interactive login tokens, keyed by target deployment.
//
// Each deployment the user logs into gets its own file under
// ~/.willet/credentials/<slug>.token, where <slug> is derived from the API URL
// (e.g. willet.bgenc.dev.token, willet.internal.example.token). Keying by target
// means a token minted for one server is never sent to another: pointing the CLI
// at a different deployment loads that deployment's file, or nothing.
//
// The directory is 0700 and each file 0600, since the tokens are bearer
// credentials. An expired token is treated as absent so callers transparently
// fall back to "please log in" instead of sending a dead token.

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
  /** The API URL the token was issued for; also keys the on-disk file. */
  apiUrl: string;
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Path to the ~/.willet config directory (overridable via $HOME in tests). */
export function configDir(home: string = homedir()): string {
  return join(home, ".willet");
}

/** Directory holding the per-target credential files. */
function credentialsDir(home: string = homedir()): string {
  return join(configDir(home), "credentials");
}

/**
 * Derive a safe, stable filename stem from an API URL. The host (and port, and
 * any non-root path) identify the deployment; every character outside a strict
 * safe set is replaced with `_`, and leading dots/dashes are stripped so we can
 * never produce a hidden file or a name that escapes the directory.
 */
export function credentialSlug(apiUrl: string): string {
  let stem: string;
  try {
    const u = new URL(apiUrl);
    stem = u.host + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch {
    stem = apiUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  }
  const safe = stem.replace(/[^A-Za-z0-9.-]/g, "_").replace(/^[.-]+/, "");
  return safe.length > 0 ? safe : "default";
}

function credentialsPath(apiUrl: string, home: string = homedir()): string {
  return join(credentialsDir(home), `${credentialSlug(apiUrl)}.token`);
}

/** Write credentials for their target, ensuring dir/file carry owner-only perms. */
export function saveCredentials(
  creds: StoredCredentials,
  home: string = homedir(),
): void {
  const dir = credentialsDir(home);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // mkdirSync's mode is masked by umask and skipped if a dir already exists, so
  // set both levels explicitly to guarantee 0700.
  chmodSync(configDir(home), DIR_MODE);
  chmodSync(dir, DIR_MODE);
  const path = credentialsPath(creds.apiUrl, home);
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

function isExpired(expiresAt: string, now: Date): boolean {
  const ms = Date.parse(expiresAt);
  // An unparseable expiry is treated as expired rather than trusting a bad row.
  return Number.isNaN(ms) || ms <= now.getTime();
}

/**
 * Load the stored credentials for `apiUrl`, or null if none exist, the file is
 * unreadable, or the token has expired.
 */
export function loadCredentials(
  apiUrl: string,
  home: string = homedir(),
  now: Date = new Date(),
): StoredCredentials | null {
  let raw: string;
  try {
    raw = readFileSync(credentialsPath(apiUrl, home), "utf8");
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

/** Remove the stored credentials for `apiUrl`. Succeeds even if none were stored. */
export function clearCredentials(
  apiUrl: string,
  home: string = homedir(),
): void {
  rmSync(credentialsPath(apiUrl, home), { force: true });
}
