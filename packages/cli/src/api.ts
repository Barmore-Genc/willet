// Thin HTTP client over global fetch for the cloud-server endpoints the CLI
// uses. The fetch implementation is injectable so tests can drive the flows
// without a network or real timers.

export type FetchLike = typeof fetch;

export interface DeviceAuthStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** Suggested seconds between token polls. */
  interval: number;
  /** ISO-8601 instant after which polling is pointless. */
  expiresAt: string;
}

export type TokenPollResult =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | {
      status: "approved";
      token: string;
      tokenType: "Bearer";
      expiresAt: string;
    };

export interface Identity {
  user: { id: string; email: string; name: string };
  token: { scope: string; accessLevel: string; projectId: string | null };
}

/** Raised when the server responds with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new ApiError(res.status, `POST ${path} failed (${res.status})`);
    }
    return (await res.json()) as T;
  }

  /** Begin a device-authorization request. */
  startDeviceAuth(): Promise<DeviceAuthStart> {
    return this.postJson<DeviceAuthStart>("/api/cli-auth/device", {});
  }

  /** Poll once for the token tied to a device code. */
  pollToken(deviceCode: string): Promise<TokenPollResult> {
    return this.postJson<TokenPollResult>("/api/cli-auth/token", { deviceCode });
  }

  /** Resolve the identity behind a bearer token. Throws ApiError(401) if invalid. */
  async whoami(token: string): Promise<Identity> {
    const res = await this.fetchImpl(`${this.apiUrl}/api/v1/me`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new ApiError(res.status, `GET /api/v1/me failed (${res.status})`);
    }
    return (await res.json()) as Identity;
  }
}
