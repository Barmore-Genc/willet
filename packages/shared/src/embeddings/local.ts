import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;

const DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2";

export async function initEmbeddings(model?: string): Promise<void> {
  const modelName = model ?? DEFAULT_MODEL;
  console.error(`Loading ${modelName}...`);
  extractor = await pipeline("feature-extraction", modelName, {
    dtype: "fp32",
  });
  console.error("Model ready.");
}

export async function embed(text: string): Promise<Float32Array> {
  if (!extractor) throw new Error("Embeddings not initialized. Call initEmbeddings() first.");

  const result = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(result.data as Float32Array);
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
