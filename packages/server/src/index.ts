import { createServer } from "@willet/shared";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";

const configPath = process.env.WILLET_CONFIG;
if (!configPath) {
  console.error("WILLET_CONFIG environment variable is required");
  process.exit(1);
}

const config = loadConfig(configPath);
await startHttpServer(config, createServer);
