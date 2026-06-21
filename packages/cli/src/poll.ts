// The device-authorization poll loop, extracted so it can be unit-tested with
// an injected client and sleep (no wall-clock waits).

import type { ApiClient, DeviceAuthStart, TokenPollResult } from "./api.js";

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Client-side ceiling on how long the poll loop will wait, regardless of the
 * server-supplied `expiresAt`. Used as the deadline when `expiresAt` is
 * unparseable (so the loop can't hang forever), and as an upper bound when the
 * server sends a far-future expiry (so the loop still stops on its own).
 */
export const CLIENT_MAX_WAIT_MS = 15 * 60 * 1000;

/** Terminal outcomes of a poll loop; `pending` is never returned. */
export type PollOutcome = Exclude<TokenPollResult, { status: "pending" }>;

/**
 * Poll the token endpoint every `start.interval` seconds until the server
 * returns a terminal status or the request's `expiresAt` passes. A pending
 * response past the deadline resolves to `{ status: "expired" }`.
 */
export async function pollForToken(
  client: ApiClient,
  start: DeviceAuthStart,
  options: { sleep?: Sleep; now?: () => number } = {},
): Promise<PollOutcome> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? (() => Date.now());
  const cap = now() + CLIENT_MAX_WAIT_MS;
  const parsed = Date.parse(start.expiresAt);
  // Fall back to the client cap when the server's expiry is unparseable (NaN),
  // and never wait past it even if the server hands back a far-future expiry.
  const deadline = Number.isNaN(parsed) ? cap : Math.min(parsed, cap);
  const intervalMs = Math.max(0, start.interval) * 1000;

  for (;;) {
    if (now() >= deadline) {
      return { status: "expired" };
    }
    const result = await client.pollToken(start.deviceCode);
    if (result.status !== "pending") {
      return result;
    }
    await sleep(intervalMs);
  }
}
