import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ulid } from "ulid";

// Stand in for the ONNX pipeline. The point of these tests is that the import
// CLI loads *some* model before importing, not which one.
const pipeline = vi.fn(async () => {
  return async (_text: string) => ({ data: new Float32Array(384) });
});
vi.mock("@huggingface/transformers", () => ({ pipeline }));

const { applySchema } = await import("@willet/shared/dist/db/schema.js");
const { exportProject, runImportCli } = await import("@willet/shared");

let dataDir: string;
let workDir: string;
let originalDataDir: string | undefined;

function seedZip(zipPath: string): Promise<{ ticketCount: number }> {
  const db = new Database(":memory:");
  applySchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, type, priority, tags, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'open', 'chore', 'medium', '[]', '{}', ?, ?)`
  ).run(ulid(), "Imported ticket", "body", now, now);
  return exportProject(db, "CLI Import Test", zipPath);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "willet-import-cli-data-"));
  workDir = mkdtempSync(join(tmpdir(), "willet-import-cli-work-"));
  originalDataDir = process.env.WILLET_DATA_DIR;
  process.env.WILLET_DATA_DIR = dataDir;
  pipeline.mockClear();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.WILLET_DATA_DIR;
  else process.env.WILLET_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

describe("runImportCli", () => {
  // Regression: the CLI used to reach importFromZip without loading a model,
  // and every invocation died with "Embeddings not initialized".
  it("initializes embeddings before importing", async () => {
    const zipPath = join(workDir, "export.zip");
    await seedZip(zipPath);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(runImportCli([zipPath])).resolves.toBeUndefined();
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();

    expect(pipeline).toHaveBeenCalled();
    expect(output).toContain("1 ticket(s)");
  });
});
