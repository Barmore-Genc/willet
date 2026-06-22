// Best-effort "open this URL in the default browser" helper.
//
// We avoid a dependency for something this small. Spawning the platform opener
// detached and ignoring its outcome is enough: if it fails the caller still
// prints the URL for the user to open by hand, so this never hard-fails.

import { spawn } from "node:child_process";

function opener(platform: NodeJS.Platform): { cmd: string; args: string[] } {
  switch (platform) {
    case "darwin":
      return { cmd: "open", args: [] };
    case "win32":
      // `start` is a cmd builtin; the empty "" is its window-title argument.
      return { cmd: "cmd", args: ["/c", "start", ""] };
    default:
      return { cmd: "xdg-open", args: [] };
  }
}

/** Try to open `url`; resolves to whether the spawn was launched without error. */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const { cmd, args } = opener(platform);
      const child = spawn(cmd, [...args, url], {
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => resolve(false));
      child.unref();
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}
