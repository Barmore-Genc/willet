// `willet whoami`: resolve the active token and print the identity behind it.

import { ApiClient, ApiError, type Identity } from "../api.js";
import { resolveApiUrl, envApiToken } from "../config.js";
import { loadCredentials } from "../credentials.js";

/** Resolve the bearer token per precedence: env secret wins, else stored login. */
export function resolveToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return envApiToken(env) ?? loadCredentials()?.token ?? null;
}

export function formatIdentity(id: Identity): string {
  const project = id.token.projectId ? ` project=${id.token.projectId}` : "";
  return (
    `Logged in as ${id.user.name} <${id.user.email}> (id ${id.user.id})\n` +
    `Token: scope=${id.token.scope} access=${id.token.accessLevel}${project}`
  );
}

export async function whoamiCommand(
  deps: { env?: NodeJS.ProcessEnv; client?: ApiClient } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const token = resolveToken(env);
  if (!token) {
    console.error("Not logged in. Run `willet login`.");
    return 1;
  }
  const client = deps.client ?? new ApiClient(resolveApiUrl(env));
  try {
    const id = await client.whoami(token);
    console.log(formatIdentity(id));
    return 0;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.error("Token rejected (401). Run `willet login`.");
      return 1;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
