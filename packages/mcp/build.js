import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";

await build({
  entryPoints: ["src/index.ts", "src/export.ts", "src/import.ts"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  alias: {
    "@willet/shared": "../shared/src/index.ts",
  },
  // Bundled CJS deps (archiver, node-stream-zip) call `require()` at load time.
  // esbuild's ESM output stubs that out with a throwing shim unless a real
  // `require` is already in scope, so supply one.
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  // Only keep native/binary deps external. sqlite-vec belongs here too: it
  // resolves its platform package (sqlite-vec-darwin-arm64 and friends) by
  // name at runtime, which only works from its own place in node_modules.
  external: [
    "better-sqlite3",
    "onnxruntime-node",
    "@huggingface/transformers",
    "sqlite-vec",
  ],
});

// The app-resource views are HTML, so esbuild never sees them. viz.ts resolves
// them from `<pkg>/views/views` when running as a bundle, so put them there.
await rm("views", { recursive: true, force: true });
await cp("../shared/dist/views", "views", { recursive: true });
