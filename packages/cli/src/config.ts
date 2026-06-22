// Resolves the CLI's runtime configuration: which backend to talk to and the
// unattended API secret.
//
// The target deployment can be set three ways, highest precedence first:
//   1. --api-url <url>   a global CLI flag (index.ts writes it into the env
//                        below so a single resolution path covers every command).
//   2. WILLET_API_URL    an environment variable, ideal for CI/unattended runs.
//   3. apiUrl            a "apiUrl" string in ~/.willet/config.json.
// When none are set the CLI targets the hosted Willet Cloud. Self-deployed
// (open-source) Willet users point the CLI at their own server via any of these.
//
// WILLET_API_TOKEN, when set, is a long-lived API secret that takes precedence
// over any stored login token and is never written to disk, so CI secrets stay
// in the environment where they belong.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { configDir } from "./credentials.js";

export const DEFAULT_API_URL = "https://willet.bgenc.dev";

interface CliConfig {
  /** Base URL of the Willet deployment to target. */
  apiUrl?: string;
}

/** Path to ~/.willet/config.json (overridable via $HOME in tests). */
function configFilePath(home: string = homedir()): string {
  return join(configDir(home), "config.json");
}

/** Load ~/.willet/config.json, or null if missing/unreadable/invalid. */
export function loadCliConfig(home: string = homedir()): CliConfig | null {
  let raw: string;
  try {
    raw = readFileSync(configFilePath(home), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CliConfig;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The configured API URL from env or the config file, before defaulting. */
function explicitApiUrl(
  env: NodeJS.ProcessEnv,
  home: string,
): string | undefined {
  const fromEnv = env.WILLET_API_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fromFile = loadCliConfig(home)?.apiUrl?.trim();
  if (fromFile && fromFile.length > 0) return fromFile;
  return undefined;
}

/** Read the base API URL, stripping any trailing slash so we can append paths. */
export function resolveApiUrl(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const url = explicitApiUrl(env, home) ?? DEFAULT_API_URL;
  return url.replace(/\/+$/, "");
}

/** True when the CLI is falling back to the hosted cloud (no explicit target). */
export function usingDefaultApiUrl(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): boolean {
  return explicitApiUrl(env, home) === undefined;
}

/** The unattended API secret, if the user exported one. */
export function envApiToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.WILLET_API_TOKEN?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}
