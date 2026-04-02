import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  alias: {
    "@willet/shared": "../shared/src/index.ts",
  },
  // Only keep native/binary deps external
  external: [
    "better-sqlite3",
    "onnxruntime-node",
    "@huggingface/transformers",
  ],
});
