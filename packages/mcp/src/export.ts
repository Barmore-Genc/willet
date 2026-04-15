import { runExportCli } from "@willet/shared";

runExportCli(process.argv.slice(2)).catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
