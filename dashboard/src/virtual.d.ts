// Modules that build.mjs makes at build time.

declare module "virtual:highs-wasm" {
  /** highs.wasm, gzip-compressed and base64-encoded. */
  const base64: string;
  export default base64;
}

declare module "virtual:worker-source" {
  /** The bundled worker module (src/worker.ts) as source text. */
  const source: string;
  export default source;
}
