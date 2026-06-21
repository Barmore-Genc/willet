import { describe, it, expect } from "vitest";
import { makeClient } from "./client.js";

describe("makeClient", () => {
  it("attaches the Bearer token and targets the /api/v1 base URL", async () => {
    const seen: Request[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      seen.push(req);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = makeClient("https://api.test", "wlt_secret", fakeFetch);
    const { response } = await client.GET("/me");

    expect(response.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.test/api/v1/me");
    expect(seen[0].headers.get("authorization")).toBe("Bearer wlt_secret");
  });
});
