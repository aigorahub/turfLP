// Plan B3-A5: the fixed 200 x 20 benchmark solves from a warm solver in under
// 5 seconds, with the exact expected values.
import { describe, expect, it } from "vitest";
import { loadSolver, turf } from "../src/index.js";
import { fixtures, hasConformance, readInput } from "./helpers.js";

describe.skipIf(!hasConformance)("benchmark", () => {
  it("solves gen-bench-200x20 at size 5 in under 5 seconds", async () => {
    await loadSolver();
    const { a, names } = readInput("gen-bench-200x20");
    await turf(a, 5, { names });
    const expected = fixtures("turf").find((c) => c.id === "gen-bench-200x20/k5/frequency+penetration").expected;
    const t = performance.now();
    const p = await turf(a, 5, { names });
    const ms = performance.now() - t;
    console.log(`gen-bench-200x20 size 5 warm solve: ${ms.toFixed(0)} ms`);
    expect([p.reach, p.frequency]).toEqual([expected.reach, expected.frequency]);
    expect(ms).toBeLessThan(5000);
  });
});
