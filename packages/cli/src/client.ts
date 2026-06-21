// Typed REST client generated from the canonical OpenAPI spec. The CLI never
// hand-writes request/response shapes: `openapi-fetch` is parameterised by the
// `paths` type emitted from `@willet/api-spec`, so paths, params, and
// bodies are checked against the same contract the server validates against.

import createClient, { type Client } from "openapi-fetch";
import type { paths } from "@willet/api-spec";

export type WilletClient = Client<paths>;

/**
 * The query-parameter object the spec declares for a `<path, method>`. Commands
 * type their query builders with this so `openapi-fetch` checks parameter names
 * and value types against the contract instead of receiving an `as never` cast.
 */
export type Query<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  parameters: { query?: infer Q };
}
  ? Q
  : never;

/** Build a Bearer-authenticated client bound to `<apiUrl>/api/v1`. */
export function makeClient(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): WilletClient {
  const client = createClient<paths>({ baseUrl: `${apiUrl}/api/v1`, fetch: fetchImpl });
  client.use({
    onRequest({ request }) {
      request.headers.set("authorization", `Bearer ${token}`);
      return request;
    },
  });
  return client;
}
