// The reduced model (fixed-covered rows left out, identical respondents as
// one weighted row) against exhaustive enumeration and the unreduced model.
import { afterEach, describe, expect, it } from "vitest";
import { loadSolver, turf, turfMinCover, turfSizes } from "../src/index.js";
import { GROUP_RATIO } from "../src/prepare.js";
import { settings } from "../src/solver.js";
import type { Criterion } from "../src/input.js";

afterEach(() => { settings.reduce = "on"; settings.groupRatio = GROUP_RATIO; });

type M = number[][];
const colReach = (a: M) => a[0].map((_, j) => a.reduce((s, r) => s + r[j], 0));

function* choose(items: number[], k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) { yield [...acc]; return; }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]);
    yield* choose(items, k, i + 1, acc);
    acc.pop();
  }
}

/** The optimum by enumeration: reach, then each criterion, compared with a relative 1e-9. */
function oracle(a: M, size: number, tiebreak: Criterion[], fixed: number[]) {
  const r = colReach(a);
  const cand = r.map((x, j) => (x > 0 ? j : -1)).filter((j) => j >= 0);
  const free = cand.filter((j) => !fixed.includes(j));
  let best: { reach: number; frequency: number; penetration: number }[] = [];
  for (const rest of choose(free, size - fixed.length)) {
    const s = [...fixed, ...rest];
    best.push({
      reach: a.filter((row) => s.some((j) => row[j] === 1)).length,
      frequency: s.reduce((t, j) => t + r[j], 0),
      penetration: s.length / s.reduce((t, j) => t + 1 / r[j], 0),
    });
  }
  const keepMax = (key: "reach" | "frequency" | "penetration") => {
    const top = Math.max(...best.map((b) => b[key]));
    best = best.filter((b) => b[key] >= top - 1e-9 * Math.max(1, top));
  };
  keepMax("reach");
  for (const c of tiebreak) keepMax(c);
  return best[0];
}

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ORDERS: Criterion[][] = [["frequency", "penetration"], ["penetration", "frequency"], []];

describe("reduced model", () => {
  it("matches enumeration and the unreduced model on random data with duplicate respondents", async () => {
    await loadSolver();
    for (let seed = 1; seed <= 120; seed++) {
      const next = rng(seed);
      const cols = 4 + Math.floor(next() * 4);
      // Few distinct patterns, so groups have unequal weights; some rows reach no product.
      const patterns = Array.from({ length: 3 + Math.floor(next() * 4) },
                                  () => Array.from({ length: cols }, () => (next() < 0.35 ? 1 : 0)));
      const a = Array.from({ length: 10 + Math.floor(next() * 20) }, () => patterns[Math.floor(next() * patterns.length)]);
      const r = colReach(a);
      const cand = r.map((x, j) => (x > 0 ? j : -1)).filter((j) => j >= 0);
      if (cand.length < 2) continue;
      const fixed = cand.filter(() => next() < 0.25).slice(0, 2);
      const size = Math.max(1, fixed.length) + Math.floor(next() * (cand.length - Math.max(1, fixed.length) + 1));
      const tiebreak = ORDERS[seed % 3];
      const want = oracle(a, size, tiebreak, fixed);
      const id = `seed ${seed}: size ${size}, fixed ${fixed}, ${tiebreak}`;
      // Ratio 1 always groups equal rows; ratio 0 never does but still leaves out the fixed-covered rows.
      for (const [reduce, ratio] of [["on", 1], ["on", 0], ["off", 1]] as const) {
        settings.reduce = reduce;
        settings.groupRatio = ratio;
        const p = await turf(a, size, { tiebreak, fixed });
        expect(p.reach, `${id}, reduce ${reduce}, ratio ${ratio}`).toBe(want.reach);
        expect(p.reachProp, id).toBe(want.reach / a.length);
        expect(fixed.every((j) => p.products.includes(j)), id).toBe(true);
        if (tiebreak[0] === "frequency") expect(p.frequency, id).toBe(want.frequency);
        if (tiebreak[0] === "penetration") expect(p.penetration, id).toBeCloseTo(want.penetration, 9);
      }
    }
  });

  it("selects a product that adds no respondent when the fixed products reach everyone", async () => {
    // Product 0 reaches everyone. Products 1 and 2 reach the same respondents
    // after product 0 (none), but 2 reaches more of them in all, so frequency
    // must pick 2: residual twins are not twins.
    const a = [[1, 1, 1], [1, 0, 1], [1, 0, 1], [1, 0, 0]];
    for (const reduce of ["on", "off"] as const) {
      settings.reduce = reduce;
      const p = await turf(a, 2, { fixed: [0] });
      expect([p.products, p.reach, p.frequency]).toEqual([[0, 2], 4, 7]);
      const q = await turf(a, 3, { fixed: [0] });
      expect([q.products, q.reach]).toEqual([[0, 1, 2], 4]);
      // The minimum cover can be the fixed products alone.
      expect((await turfMinCover(a, { fixed: [0] })).products).toEqual([0]);
    }
  });

  it("keeps respondents that no product reaches in the reach proportion", async () => {
    const a = [[1, 0], [1, 0], [0, 1], [0, 0], [0, 0]];
    const p = await turf(a, 1, { fixed: [0] });
    expect([p.reach, p.reachProp, p.respondents]).toEqual([2, 2 / 5, 5]);
  });

  it("gives the same default sizes and minimum cover with and without the reduction", async () => {
    const next = rng(7);
    const a = Array.from({ length: 40 }, () => Array.from({ length: 7 }, () => (next() < 0.3 ? 1 : 0)));
    const results = [];
    for (const reduce of ["on", "off"] as const) {
      settings.reduce = reduce;
      const rows = await turfSizes(a, undefined, { fixed: [1] });
      results.push([rows.map((p) => [p.size, p.reach, p.frequency]), (await turfMinCover(a, { fixed: [1] })).size]);
      expect(await turfSizes(a, [], { fixed: [1] })).toEqual([]);
    }
    expect(results[0]).toEqual(results[1]);
  });
});
