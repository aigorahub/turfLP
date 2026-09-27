// loadSolver with the bytes of highs.wasm (see load.test.ts).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { loadSolver, turf } from "../src/index.js";

const require = createRequire(import.meta.url);

it("loads from the bytes of highs.wasm and does not read the file", async () => {
  const bytes = readFileSync(require.resolve("highs/runtime"));
  await loadSolver({ wasmBinary: new Uint8Array(bytes), locateFile: () => "/nonexistent/highs.wasm" });
  const p = await turf([[1, 0], [0, 1], [1, 1]], 2);
  expect(p.reach).toBe(3);
});
