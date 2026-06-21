// `willet logout`: drop the locally stored credentials.
//
// There is no per-token CLI revoke endpoint. This only clears local state; to
// revoke tokens across all machines the user uses the dashboard.

import { clearCredentials } from "../credentials.js";

export function logoutCommand(): number {
  clearCredentials();
  console.log("Logged out. Local credentials cleared.");
  console.log(
    "To revoke tokens everywhere, manage them in the dashboard.",
  );
  return 0;
}
