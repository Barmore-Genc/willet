import { describe, it, expect, beforeEach } from "vitest";
import {
  setEmbedder,
  getEmbeddingDim,
  EMBEDDING_DIM,
} from "@willet/shared";
import { embed } from "@willet/shared/dist/embeddings/local.js";

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
