import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { WilletConfig } from "../config.js";
import { findUserBySecret } from "../config.js";

// --- Clients store ---

class WilletClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(
    clientId: string
  ): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(
    client: OAuthClientInformationFull
  ): Promise<OAuthClientInformationFull> {
    this.clients.set(client.client_id, client);
    return client;
  }
}

// --- Auth code + token storage ---

interface AuthCodeData {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  username: string;
  state?: string;
  resource?: URL;
  expiresAt: number;
}

interface TokenData {
  clientId: string;
  username: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

// --- Provider ---

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class WilletAuthProvider implements OAuthServerProvider {
  clientsStore = new WilletClientsStore();
  private codes = new Map<string, AuthCodeData>();
  private tokens = new Map<string, TokenData>();
  private refreshTokens = new Map<string, { accessToken: string }>();
  private _config: WilletConfig;

  constructor(config: WilletConfig) {
    this._config = config;
  }

  get config(): WilletConfig {
    return this._config;
  }

  set config(config: WilletConfig) {
    this._config = config;
  }

  /**
   * Renders a minimal HTML form asking the user for their secret key.
   * The form POSTs to /authorize/submit with the OAuth params as hidden fields.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Willet - Authenticate</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 400px; margin: 80px auto; padding: 0 20px; }
    h1 { font-size: 1.5rem; }
    label { display: block; margin-top: 16px; font-weight: 500; }
    input[type="password"] { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; font-size: 1rem; }
    button { margin-top: 20px; padding: 10px 24px; font-size: 1rem; cursor: pointer; }
    .error { color: #c00; }
  </style>
</head>
<body>
  <h1>Willet</h1>
  <p>Enter your secret key to connect.</p>
  <form method="POST" action="/authorize/submit">
    <input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
    ${params.state !== undefined ? `<input type="hidden" name="state" value="${escapeHtml(params.state)}">` : ""}
    ${params.scopes?.length ? `<input type="hidden" name="scopes" value="${escapeHtml(params.scopes.join(" "))}">` : ""}
    ${params.resource ? `<input type="hidden" name="resource" value="${escapeHtml(params.resource.toString())}">` : ""}
    <label for="secret">Secret Key</label>
    <input type="password" id="secret" name="secret" required autofocus>
    <br>
    <button type="submit">Authenticate</button>
  </form>
</body>
</html>`;

    res.type("html").send(html);
  }

  /**
   * Called from the /authorize/submit POST handler.
   * Validates the secret and stores an auth code.
   */
  submitAuthorization(params: {
    clientId: string;
    secret: string;
    redirectUri: string;
    codeChallenge: string;
    state?: string;
    scopes?: string;
    resource?: string;
  }): { code: string; redirectUri: string; state?: string } | { error: string } {
    const username = findUserBySecret(this._config, params.secret);
    if (!username) {
      return { error: "Invalid secret key" };
    }

    const code = randomUUID();
    this.codes.set(code, {
      clientId: params.clientId,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      username,
      state: params.state,
      resource: params.resource ? new URL(params.resource) : undefined,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    return {
      code,
      redirectUri: params.redirectUri,
      state: params.state,
    };
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const data = this.codes.get(authorizationCode);
    if (!data || data.expiresAt < Date.now()) {
      throw new Error("Invalid or expired authorization code");
    }
    return data.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    const data = this.codes.get(authorizationCode);
    if (!data || data.expiresAt < Date.now()) {
      throw new Error("Invalid or expired authorization code");
    }
    if (data.clientId !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }

    this.codes.delete(authorizationCode);

    const accessToken = randomUUID();
    const refreshToken = randomUUID();

    this.tokens.set(accessToken, {
      clientId: client.client_id,
      username: data.username,
      scopes: [],
      expiresAt: Date.now() + TOKEN_TTL_MS,
      resource: data.resource,
    });

    this.refreshTokens.set(refreshToken, { accessToken });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    const refreshData = this.refreshTokens.get(refreshToken);
    if (!refreshData) {
      throw new Error("Invalid refresh token");
    }

    const oldTokenData = this.tokens.get(refreshData.accessToken);
    if (!oldTokenData) {
      throw new Error("Associated access token not found");
    }

    // Revoke old tokens
    this.tokens.delete(refreshData.accessToken);
    this.refreshTokens.delete(refreshToken);

    // Issue new tokens
    const newAccessToken = randomUUID();
    const newRefreshToken = randomUUID();

    this.tokens.set(newAccessToken, {
      clientId: client.client_id,
      username: oldTokenData.username,
      scopes: oldTokenData.scopes,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      resource: oldTokenData.resource,
    });

    this.refreshTokens.set(newRefreshToken, { accessToken: newAccessToken });

    return {
      access_token: newAccessToken,
      token_type: "bearer",
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      refresh_token: newRefreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = this.tokens.get(token);
    if (!data || data.expiresAt < Date.now()) {
      throw new Error("Invalid or expired token");
    }

    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: Math.floor(data.expiresAt / 1000),
      resource: data.resource,
      extra: { username: data.username },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const token = request.token;
    // Try as access token
    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return;
    }
    // Try as refresh token
    if (this.refreshTokens.has(token)) {
      const data = this.refreshTokens.get(token)!;
      this.tokens.delete(data.accessToken);
      this.refreshTokens.delete(token);
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
