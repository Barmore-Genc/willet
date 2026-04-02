import { readFileSync, watch } from "node:fs";
import { parse } from "smol-toml";

export interface WilletConfig {
  server: {
    port: number;
    base_url: string;
  };
  users: Record<string, { secret: string }>;
}

export function loadConfig(path: string): WilletConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw) as unknown as WilletConfig;

  if (!parsed.server?.port || !parsed.server?.base_url) {
    throw new Error("Config must include [server] with port and base_url");
  }
  if (!parsed.users || Object.keys(parsed.users).length === 0) {
    throw new Error("Config must include at least one [users.<name>] entry");
  }

  // Validate secrets are unique
  const secrets = Object.values(parsed.users).map((u) => u.secret);
  const uniqueSecrets = new Set(secrets);
  if (uniqueSecrets.size !== secrets.length) {
    throw new Error("Each user must have a unique secret");
  }

  for (const [name, user] of Object.entries(parsed.users)) {
    if (!user.secret) {
      throw new Error(`User "${name}" is missing a secret`);
    }
  }

  return parsed;
}

export function findUserBySecret(
  config: WilletConfig,
  secret: string
): string | null {
  for (const [name, user] of Object.entries(config.users)) {
    if (user.secret === secret) return name;
  }
  return null;
}

export function watchConfig(
  path: string,
  onChange: (config: WilletConfig) => void
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(path, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const config = loadConfig(path);
        onChange(config);
        console.log("Config reloaded successfully");
      } catch (err) {
        console.error("Failed to reload config:", err);
      }
    }, 500);
  });
}
