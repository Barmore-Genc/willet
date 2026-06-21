import { describe, it, expect, vi } from "vitest";
import { pollForToken, CLIENT_MAX_WAIT_MS } from "./poll.js";
import type { ApiClient, DeviceAuthStart, TokenPollResult } from "./api.js";

function start(overrides: Partial<DeviceAuthStart> = {}): DeviceAuthStart {
  return {
    deviceCode: "dev-code",
    userCode: "ABCD-1234",
    verificationUri: "https://x/activate",
    verificationUriComplete: "https://x/activate?code=ABCD-1234",
    interval: 2,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

// Build a stub ApiClient whose pollToken returns the scripted results in order.
function clientReturning(results: TokenPollResult[]): {
  client: ApiClient;
  pollToken: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const pollToken = vi.fn<() => Promise<TokenPollResult>>(
    async () => results[Math.min(i++, results.length - 1)],
  );
  return { client: { pollToken } as unknown as ApiClient, pollToken };
}

describe("pollForToken", () => {
  it("drives a sequence of pending responses to an approved token", async () => {
    const approved: TokenPollResult = {
      status: "approved",
      token: "minted",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const { client, pollToken } = clientReturning([
      { status: "pending" },
      { status: "pending" },
      approved,
    ]);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const outcome = await pollForToken(client, start(), { sleep });

    expect(outcome).toEqual(approved);
    expect(pollToken).toHaveBeenCalledTimes(3);
    // Sleeps once between each pending poll (twice), using interval*1000.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("returns immediately on denied without sleeping", async () => {
    const { client } = clientReturning([{ status: "denied" }]);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const outcome = await pollForToken(client, start(), { sleep });
    expect(outcome.status).toBe("denied");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns expired when the server reports it", async () => {
    const { client } = clientReturning([{ status: "expired" }]);
    const outcome = await pollForToken(client, start(), { sleep: async () => {} });
    expect(outcome.status).toBe("expired");
  });

  it("stops with expired once the deadline passes while pending", async () => {
    const { client, pollToken } = clientReturning([{ status: "pending" }]);
    const deadline = Date.parse(start().expiresAt);
    // now() is read once for the client cap, then once per loop check; it jumps
    // past the deadline on the second loop check.
    let calls = 0;
    const now = vi.fn<() => number>(() =>
      calls++ < 2 ? deadline - 1000 : deadline + 1000,
    );
    const outcome = await pollForToken(client, start(), {
      sleep: async () => {},
      now,
    });
    expect(outcome.status).toBe("expired");
    // Polled once (before deadline), then the deadline check ended the loop.
    expect(pollToken).toHaveBeenCalledTimes(1);
  });

  it("falls back to the client cap when expiresAt is unparseable", async () => {
    const { client, pollToken } = clientReturning([{ status: "pending" }]);
    const base = 1_000_000;
    // First now() (cap) sets deadline = base + CLIENT_MAX_WAIT_MS; the loop runs
    // until a later now() crosses that cap rather than looping forever on NaN.
    let calls = 0;
    const now = vi.fn<() => number>(() =>
      calls++ === 0 ? base : base + CLIENT_MAX_WAIT_MS + 1,
    );
    const outcome = await pollForToken(client, start({ expiresAt: "not-a-date" }), {
      sleep: async () => {},
      now,
    });
    expect(outcome.status).toBe("expired");
    expect(pollToken).not.toHaveBeenCalled();
  });

  it("caps the wait when the server expiry is far in the future", async () => {
    const { client, pollToken } = clientReturning([{ status: "pending" }]);
    const base = 1_000_000;
    // expiresAt is years away, but the loop stops once now() passes the cap.
    const farFuture = new Date(base + 10 * 365 * 24 * 3600_000).toISOString();
    let calls = 0;
    const now = vi.fn<() => number>(() =>
      calls++ === 0 ? base : base + CLIENT_MAX_WAIT_MS + 1,
    );
    const outcome = await pollForToken(client, start({ expiresAt: farFuture }), {
      sleep: async () => {},
      now,
    });
    expect(outcome.status).toBe("expired");
    expect(pollToken).not.toHaveBeenCalled();
  });
});
