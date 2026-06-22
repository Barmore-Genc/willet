import { describe, it, expect, vi, afterEach } from "vitest";
import { buildProgram } from "./index.js";
import type { FetchResult } from "./run.js";
import type { WilletClient } from "./client.js";

interface Call {
  verb: string;
  path: string;
  opts: { params?: { path?: Record<string, string>; query?: unknown }; body?: unknown };
}

type Impl = (call: Call) => FetchResult<unknown>;

function fakeClient(impl: Impl): { client: WilletClient; calls: Call[] } {
  const calls: Call[] = [];
  const verb = (name: string) => (path: string, opts: Call["opts"] = {}) => {
    const call: Call = { verb: name, path, opts };
    calls.push(call);
    return Promise.resolve(impl(call));
  };
  const client = {
    GET: verb("GET"),
    POST: verb("POST"),
    PATCH: verb("PATCH"),
    DELETE: verb("DELETE"),
  } as unknown as WilletClient;
  return { client, calls };
}

const ok = <T>(data: T, status = 200): FetchResult<T> => ({
  data,
  response: new Response(null, { status }),
});
const fail = (status: number, error: unknown): FetchResult<never> => ({
  error,
  response: new Response(null, { status }),
});

async function runCli(client: WilletClient, argv: string[]): Promise<number | undefined> {
  process.exitCode = undefined;
  await buildProgram({ client }).parseAsync(["node", "willet", ...argv]);
  const code = process.exitCode;
  process.exitCode = undefined;
  return code;
}

afterEach(() => vi.restoreAllMocks());

describe("command surface", () => {
  it("ticket list issues GET with the project path and prints JSON", async () => {
    const { client, calls } = fakeClient(() => ok({ tickets: [{ id: "t1", title: "A" }], total: 1 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCli(client, ["ticket", "list", "-p", "P1", "--json"]);
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ verb: "GET", path: "/projects/{projectId}/tickets" });
    expect(calls[0].opts.params?.path).toEqual({ projectId: "P1" });
    expect(log.mock.calls[0][0]).toContain('"t1"');
  });

  it("ticket create sends the title and options as the request body", async () => {
    const { client, calls } = fakeClient(() => ok({ id: "t9", key: "P-9", title: "Hello" }, 201));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCli(client, ["ticket", "create", "Hello", "-p", "P1", "--type", "bug", "--priority", "high"]);
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ verb: "POST", path: "/projects/{projectId}/tickets" });
    expect(calls[0].opts.body).toEqual({ title: "Hello", type: "bug", priority: "high" });
  });

  it("maps a read-only 403 on a write to exit code 3", async () => {
    const { client } = fakeClient(() => fail(403, { error: "This API secret is read-only" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runCli(client, ["ticket", "delete", "P-1", "-p", "P1"]);
    expect(code).toBe(3);
    expect(err).toHaveBeenCalledWith("This API secret is read-only");
  });

  it("org list issues GET /organizations and renders an empty collection", async () => {
    const { client, calls } = fakeClient(() => ok({ count: 0, organizations: [] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCli(client, ["org", "list"]);
    expect(code).toBe(0);
    expect(calls[0].path).toBe("/organizations");
    expect(log).toHaveBeenCalledWith("No organizations.");
  });

  it("project members add targets the nested members route with a typed body", async () => {
    const { client, calls } = fakeClient(() => ok({ added: true, userId: "u1", role: "editor" }, 201));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCli(client, [
      "project", "members", "add", "acme", "web", "u1", "--role", "editor",
    ]);
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({
      verb: "POST",
      path: "/organizations/{orgSlug}/projects/{projectSlug}/members",
    });
    expect(calls[0].opts.params?.path).toEqual({ orgSlug: "acme", projectSlug: "web" });
    expect(calls[0].opts.body).toEqual({ user_id: "u1", role: "editor" });
  });
});
