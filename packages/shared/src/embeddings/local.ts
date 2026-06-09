import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;

const DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2";

/** Embedding dimension of the default model. The live dimension in use may
 * differ once a different model or a custom embedder is configured — read it
 * via {@link getEmbeddingDim}. */
export const EMBEDDING_DIM = 384;

/** Decorates text before embedding, passed by the caller at embed time (e.g.
 * the e5 family wants a `query: ` prefix on queries and `passage: ` on
 * documents). The caller decides which decoration applies; this module stays
 * agnostic. */
export type EmbeddingTransform = (text: string) => string;

/** Live embedding dimension. Starts at the default-model dim and is updated by
 * a probe embed at the end of {@link initEmbeddings}, or by {@link setEmbedder}. */
let activeDim = EMBEDDING_DIM;

async function localEmbed(text: string): Promise<Float32Array> {
  if (!extractor) throw new Error("Embeddings not initialized. Call initEmbeddings() first.");
  const result = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(result.data as Float32Array);
}

let embedFn: (text: string) => Promise<Float32Array> = localEmbed;
let customEmbedder = false;

export interface InitEmbeddingsOptions {
  model?: string;
  dtype?: "fp32" | "fp16" | "q8" | "int8" | "uint8" | "q4" | "bnb4" | "q4f16";
}

/**
 * Initialize the local embedding model. Accepts either a bare model name
 * (backward compatible) or an options object selecting the model and
 * quantization dtype. Invariant: call this (or {@link setEmbedder}) before any
 * DB is opened, since the vector table is created at the live dimension.
 */
export async function initEmbeddings(options?: string | InitEmbeddingsOptions): Promise<void> {
  const opts: InitEmbeddingsOptions =
    typeof options === "string" ? { model: options } : options ?? {};

  if (customEmbedder) return; // skip model loading when a custom embedder is set

  const modelName = opts.model ?? DEFAULT_MODEL;
  console.error(`Loading ${modelName}...`);
  extractor = await pipeline("feature-extraction", modelName, {
    dtype: opts.dtype ?? "fp32",
  });
  // Probe once to discover the model's actual output dimension.
  const probe = await localEmbed("probe");
  activeDim = probe.length;
  console.error(`Model ready (dim ${activeDim}).`);
}

export async function embed(
  text: string,
  transform?: EmbeddingTransform
): Promise<Float32Array> {
  return embedFn(transform ? transform(text) : text);
}

/** Override the embedding function (e.g. for testing or remote embedders).
 * Pass `dim` when the override produces a non-default dimension. */
export function setEmbedder(
  fn: (text: string) => Promise<Float32Array>,
  dim?: number
): void {
  embedFn = fn;
  customEmbedder = true;
  if (dim !== undefined) activeDim = dim;
}

/** Pure getter for the live embedding dimension. No side effects. */
export function getEmbeddingDim(): number {
  return activeDim;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  const ab = new ArrayBuffer(buf.byteLength);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.byteLength; i++) view[i] = buf[i];
  return new Float32Array(ab);
}
