import { runImportCli } from "@willet/shared";

runImportCli(process.argv.slice(2)).catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
