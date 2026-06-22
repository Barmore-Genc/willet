// Canonical Willet Cloud REST API contract.
//
// `openapi.json` (this directory) is the single source of truth: the cloud-server
// validates requests against it and serves it, and the CLI generates its typed
// client from it. `schema.ts` is generated from `openapi.json` by `pnpm run gen`
// (openapi-typescript) and checked in; a test asserts the two stay in sync.

import openapi from "./openapi.json" with { type: "json" };

export { openapi };
export default openapi;

export type { paths, components, operations } from "./schema.js";
