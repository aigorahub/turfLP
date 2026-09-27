// loadSolver with the wasm bytes or a compiled module. Each test file runs in
// its own module scope, so this file loads the solver itself.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { loadSolver, turf } from "../src/index.js";

const require = createRequire(import.meta.url);
const bytes = readFileSync(require.resolve("highs/runtime"));
// A path that does not exist: the solver must not read highs.wasm from disk.
const nowhere = () => "/nonexistent/highs.wasm";

describe("loadSolver with a binary", () => {
  it("rejects when the bytes are not WebAssembly", async () => {
    await expect(loadSolver({ wasmBinary: new Uint8Array([1, 2, 3]), locateFile: nowhere }))
      .rejects.toThrow();
  });

  it("loads from a compiled module and does not read highs.wasm", async () => {
    const wasmModule = await WebAssembly.compile(bytes);
    await loadSolver({ wasmModule, locateFile: nowhere });
    const p = await turf([[1, 0], [0, 1], [1, 1]], 1);
    expect(p.reach).toBe(2);
  });
});
