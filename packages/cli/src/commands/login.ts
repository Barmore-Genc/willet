// `willet login`: RFC 8628-style device authorization.
//
// Start a request, show the user the verification URL + code (and try to open
// the browser for them), then poll until the token is minted, denied, or the
// request expires. On success the token is persisted and we print who we are.

import { ApiClient } from "../api.js";
import { resolveApiUrl, envApiToken } from "../config.js";
import { saveCredentials } from "../credentials.js";
import { pollForToken } from "../poll.js";
import { openBrowser } from "../browser.js";
import { formatIdentity } from "./whoami.js";

export async function loginCommand(
  deps: {
    env?: NodeJS.ProcessEnv;
    client?: ApiClient;
    openBrowser?: (url: string) => Promise<boolean>;
  } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const open = deps.openBrowser ?? openBrowser;
  if (envApiToken(env)) {
    console.error(
      "WILLET_API_TOKEN is set; that token is used directly. Unset it to run an interactive login.",
    );
    return 1;
  }

  const apiUrl = resolveApiUrl(env);
  const client = deps.client ?? new ApiClient(apiUrl);

  const start = await client.startDeviceAuth();

  console.log("To finish logging in, open:");
  console.log(`  ${start.verificationUri}`);
  console.log(`and enter the code: ${start.userCode}`);

  const opened = await open(start.verificationUriComplete);
  if (opened) {
    console.log("Opened your browser to continue.");
  } else {
    console.log(`If your browser didn't open, visit: ${start.verificationUriComplete}`);
  }
  console.log("Waiting for approval...");

  const outcome = await pollForToken(client, start);
  if (outcome.status === "denied") {
    console.error("Login denied.");
    return 1;
  }
  if (outcome.status === "expired") {
    console.error("Login request expired. Run `willet login` again.");
    return 1;
  }

  saveCredentials({
    token: outcome.token,
    expiresAt: outcome.expiresAt,
    apiUrl,
  });
  const id = await client.whoami(outcome.token);
  console.log(formatIdentity(id));
  return 0;
}
