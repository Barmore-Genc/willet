// Shared executor for every data/management command. Resolves auth, runs a
// typed openapi-fetch call, prints the result (raw JSON with `--json`, otherwise
// a human summary), maps HTTP failures to a clear stderr message, and returns a
// stable exit code so the CLI is scriptable.
//
// Exit codes: 0 ok · 1 generic/usage/network · 2 auth (401 / no token) ·
// 3 forbidden (403, incl. read-only secret on a write) · 4 not found (404).

import { resolveApiUrl } from "./config.js";
import { resolveToken } from "./commands/whoami.js";
import { makeClient, type WilletClient } from "./client.js";

export const EXIT = { ok: 0, generic: 1, auth: 2, forbidden: 3, notFound: 4 } as const;

export interface RunDeps {
  env?: NodeJS.ProcessEnv;
  /** Inject a client in tests; in production it's built from resolved auth. */
  client?: WilletClient;
}

export interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function exitForStatus(status: number): number {
  if (status === 401) return EXIT.auth;
  if (status === 403) return EXIT.forbidden;
  if (status === 404) return EXIT.notFound;
  return EXIT.generic;
}

function errorMessage(status: number, error: unknown): string {
  const body = error as { error?: unknown } | undefined;
  if (body && typeof body.error === "string") return body.error;
  return `Request failed with status ${status}`;
}

/** The success-payload type of a `call`'s response, per the spec-typed client. */
type ResponseData<C> = Awaited<C> extends { data?: infer D } ? D : never;

/**
 * Run a single API call and render its outcome.
 * @param json   whether `--json` was passed (raw JSON vs human summary)
 * @param call   issues the request against the typed client
 * @param format renders the success payload for humans
 *
 * The data type is taken from `call`'s actual response, so `format` is checked
 * against exactly what the endpoint returns: a `format` written for a different
 * shape fails to type-check, instead of the data type silently widening to
 * satisfy both arguments. The `C extends Promise<unknown>` bound is deliberately
 * loose — bounding it by the response shape imposes a contextual return type on
 * the inline `call` arrow that collapses array responses to `{}` during
 * inference.
 */
export async function run<C extends Promise<unknown>>(
  json: boolean,
  call: (client: WilletClient) => C,
  format: (data: NonNullable<ResponseData<C>>) => string,
  deps: RunDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  let client = deps.client;
  if (!client) {
    const token = resolveToken(env);
    if (!token) {
      console.error("Not logged in. Run `willet login` or set WILLET_API_TOKEN.");
      return EXIT.auth;
    }
    client = makeClient(resolveApiUrl(env), token);
  }

  let result: FetchResult<unknown>;
  try {
    result = (await call(client)) as FetchResult<unknown>;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT.generic;
  }

  if (result.response.ok) {
    console.log(
      json
        ? JSON.stringify(result.data, null, 2)
        : format(result.data as NonNullable<ResponseData<C>>),
    );
    return EXIT.ok;
  }
  console.error(errorMessage(result.response.status, result.error));
  return exitForStatus(result.response.status);
}
