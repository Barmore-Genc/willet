import { describe, it, expect, beforeEach, vi } from "vitest";

// Stand in for the ONNX pipeline so these tests never load a real model. Each
// call to `pipeline()` is one model load, which is exactly what we're counting.
const pipeline = vi.fn(async () => {
  return async (_text: string) => ({ data: new Float32Array(384) });
});

vi.mock("@huggingface/transformers", () => ({ pipeline }));

// Import after the mock is registered, and from a fresh module registry so the
// module-level pipeline state doesn't leak in from another test file.
const { initEmbeddings } = await import("@willet/shared/dist/embeddings/local.js");

beforeEach(() => {
  pipeline.mockClear();
});

// The loaded pipeline is module-level state that persists across tests, so each
// test uses its own model name rather than assuming it starts unloaded.
describe("initEmbeddings", () => {
  it("loads the model once when called repeatedly with the same options", async () => {
    await initEmbeddings("test/repeat");
    await initEmbeddings("test/repeat");
    await initEmbeddings("test/repeat");

    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("reloads when a different model is requested", async () => {
    await initEmbeddings("test/first");
    await initEmbeddings("test/second");

    expect(pipeline).toHaveBeenCalledTimes(2);
    expect(pipeline).toHaveBeenLastCalledWith(
      "feature-extraction",
      "test/second",
      expect.anything(),
    );
  });

  it("reloads when the same model is requested at a different dtype", async () => {
    await initEmbeddings({ model: "test/dtype", dtype: "fp32" });
    await initEmbeddings({ model: "test/dtype", dtype: "q8" });

    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});
