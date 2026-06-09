import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import {
  embed,
  setEmbedder,
  getEmbeddingDim,
  EMBEDDING_DIM,
} from "@willet/shared";
import { applySchema } from "@willet/shared/dist/db/schema.js";
import { embedTicketContent } from "@willet/shared/dist/db/queries.js";

// Capture the text each embed call actually receives so we can assert the
// caller-supplied transform is applied. A custom embedder also means these
// tests never load an ONNX model.
const seen: string[] = [];

beforeEach(() => {
  seen.length = 0;
});

describe("embedding API", () => {
  it("default dimension matches the default model constant before any override", () => {
    expect(getEmbeddingDim()).toBe(EMBEDDING_DIM);
  });

  it("setEmbedder updates the live dimension", () => {
    setEmbedder(async (text: string) => {
      seen.push(text);
      return new Float32Array(8).fill(0.1);
    }, 8);
    expect(getEmbeddingDim()).toBe(8);
  });

  it("embed applies the caller-supplied transform, and passes text through unchanged when none is given", async () => {
    setEmbedder(async (text: string) => {
      seen.push(text);
      return new Float32Array(8).fill(0.1);
    }, 8);

    await embed("hello", (t) => `passage: ${t}`);
    await embed("hello", (t) => `query: ${t}`);
    await embed("raw");

    expect(seen).toEqual(["passage: hello", "query: hello", "raw"]);
  });
});

describe("embedTicketContent change-detection", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    setEmbedder(async (text: string) => {
      calls.push(text);
      return new Float32Array(8).fill(0.1);
    }, 8);
  });

  function dbWithTicket(id: string) {
    const db = new Database(":memory:");
    applySchema(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tickets (id, title, description, status, type, priority, tags, created_at, updated_at, metadata)
       VALUES (?, 'T', 'D', 'open', 'chore', 'medium', '[]', ?, ?, '{}')`
    ).run(id, now, now);
    return db;
  }

  const fields = { title: "T", description: "D", tags: [], comments: [] };

  it("re-embeds when the transform changes even though raw content is identical", async () => {
    const id = ulid();
    const db = dbWithTicket(id);
    const passage = (t: string) => `passage: ${t}`;
    const query = (t: string) => `query: ${t}`;

    await embedTicketContent(db, id, fields, passage); // first embed
    await embedTicketContent(db, id, fields, passage); // identical → cache hit, skipped
    expect(calls.length).toBe(1);
    expect(calls[0].startsWith("passage: ")).toBe(true);

    await embedTicketContent(db, id, fields, query); // transform changed → must re-embed
    expect(calls.length).toBe(2);
    expect(calls[1].startsWith("query: ")).toBe(true);

    db.close();
  });
});
