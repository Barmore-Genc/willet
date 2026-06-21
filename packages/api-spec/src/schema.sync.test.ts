// Guards the single-source-of-truth invariant: `schema.ts` must be exactly what
// `pnpm run gen` produces from `openapi.json`. If this fails, run
// `pnpm --filter @willet/api-spec run gen` and commit the result.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import openapiTS, { astToString } from "openapi-typescript";

/** Drop the auto-generated banner comment so we compare only the typed output. */
function stripBanner(source: string): string {
  return source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").trim();
}

describe("api-spec codegen", () => {
  it("schema.ts is in sync with openapi.json", async () => {
    const specUrl = new URL("./openapi.json", import.meta.url);
    const regenerated = astToString(await openapiTS(specUrl));
    const checkedIn = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
    expect(stripBanner(checkedIn)).toBe(stripBanner(regenerated));
  });
});
