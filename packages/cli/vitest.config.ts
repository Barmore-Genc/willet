import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // bin.ts is the executable wiring (process.argv, exit codes) and
      // browser.ts spawns a real OS process; both are exercised end-to-end
      // rather than unit-tested (spawning would open a real browser in CI).
      exclude: ["src/**/*.test.ts", "src/bin.ts", "src/browser.ts"],
      reportsDirectory: "coverage",
      reporter: ["text", "json-summary"],
    },
  },
});
