// Ports of tests/testthat/test-turf.R. The R simulator and print() tests stay
// R-only; R-seeded matrices come from the frozen conformance inputs. The large
// near-tie and tie-flood cases run in scripts/conformance.mjs.
import { describe, expect, it } from "vitest";
import { turf, turfMinCover, turfSizes } from "../src/index.js";
import { TIE, hasConformance, readInput } from "./helpers.js";

/** Exact lexicographic optimum values by enumeration (small matrices only). */
function brute(a: number[][], k: number, order: string[]) {
  const m = a[0].length;
  const r = Array.from({ length: m }, (_, j) => a.reduce((s, row) => s + row[j], 0));
  const cand = r.map((x, j) => (x > 0 ? j : -1)).filter((j) => j >= 0);
  const combos: number[][] = [];
  const rec = (start: number, cur: number[]) => {
    if (cur.length === k) { combos.push([...cur]); return; }
    for (let i = start; i < cand.length; i++) { cur.push(cand[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  const reachOf = (c: number[]) => a.filter((row) => c.some((j) => row[j] === 1)).length;
  const best = Math.max(...combos.map(reachOf));
  let keep = combos.filter((c) => reachOf(c) === best);
  const out: Record<string, number> = { reach: best };
  for (const crit of order) {
    const v = keep.map((c) => crit === "frequency" ? -c.reduce((s, j) => s + r[j], 0)
                                                   : c.reduce((s, j) => s + 1 / r[j], 0));
    const lo = Math.min(...v);
    keep = keep.filter((_, i) => v[i] <= lo + 1e-12 * Math.abs(lo));
    out[crit] = crit === "frequency" ? -lo : k / lo;
  }
  return out;
}

const conf = describe.skipIf(!hasConformance);

conf("with conformance inputs", () => {
  it("the simulated example gives the brute-force optimum", async () => {
    const { a } = readInput("simulate-1234");
    const p = await turf(a, 5);
    expect(p.products).toEqual([4, 13, 15, 27, 28]);
    expect(p.names).toEqual(["P5", "P14", "P16", "P28", "P29"]);
    expect([p.reach, p.frequency, p.reachProp]).toEqual([948, 2174, 0.948]);
  });

  it.each([16, 62, 361, ...Array.from({ length: 40 }, (_, i) => i + 1)])(
    "matches brute force on random matrix %i", async (seed) => {
      const { a } = readInput(`random-r-${seed}`);
      const m = a[0].length;
      const ncand = Array.from({ length: m }, (_, j) => a.some((row) => row[j] === 1)).filter(Boolean).length;
      const orders = [[], ["frequency"], ["penetration"], ["frequency", "penetration"], ["penetration", "frequency"]];
      for (let k = 1; k <= ncand; k++) {
        for (const order of orders) {
          const b = brute(a, k, order);
          const p = await turf(a, k, { tiebreak: order as any });
          expect(p.reach).toBe(b.reach);
          if (order.includes("frequency")) expect(p.frequency).toBe(b.frequency);
          if (order.includes("penetration")) expect(p.penetration).toBeCloseTo(b.penetration, 9);
        }
      }
    });

  it("turfMinCover finds the smallest full cover", async () => {
    const { a } = readInput("simulate-1234");
    const cover = await turfMinCover(a);
    expect([cover.size, cover.reach]).toEqual([12, 1000]);
    expect((await turf(a, 11)).reach).toBeLessThan(1000);
    for (let seed = 1; seed <= 30; seed++) {
      const { a: b } = readInput(`cover-r-${seed}`);
      const c = await turfMinCover(b);
      const reachable = b.filter((row) => row.some((v) => v === 1)).length;
      expect(c.reach).toBe(reachable);
      if (c.size > 1) expect(brute(b, c.size - 1, []).reach).toBeLessThan(reachable);
    }
  });

  it("turfSizes returns one row per size", async () => {
    const { a } = readInput("simulate-1234-300x12");
    const rows = await turfSizes(a);
    const cover = await turfMinCover(a);
    expect(rows.map((p) => p.size)).toEqual(Array.from({ length: cover.size }, (_, i) => i + 1));
    rows.slice(1).forEach((p, i) => expect(p.reach).toBeGreaterThanOrEqual(rows[i].reach));
    expect(rows[rows.length - 1].reach).toBe(a.filter((row) => row.some((v) => v === 1)).length);
    expect(rows[2].reach).toBe((await turf(a, 3)).reach);
  });

  it("identical products do not flood the penetration stage", async () => {
    const { a } = readInput("identical-300");
    const p = await turf(a, 3);
    expect(p.warnings).toEqual([]);
    const b = brute(a, 3, ["frequency", "penetration"]);
    expect([p.reach, p.frequency]).toEqual([b.reach, b.frequency]);
    expect(p.penetration).toBeCloseTo(b.penetration, 9);
  });
});

describe("without conformance inputs", () => {
  it("tie-breaks apply in order", async () => {
    expect((await turf(TIE, 2, { tiebreak: [] })).reach).toBe(7);
    let p = await turf(TIE, 2, { tiebreak: ["frequency"] });
    expect([p.reach, p.frequency]).toEqual([7, 8]);
    expect([[1, 2], [3, 4]]).toContainEqual([...p.products]);
    p = await turf(TIE, 2);
    expect([...p.products, p.frequency, p.penetration]).toEqual([1, 2, 8, 4]);
  });

  it("respondents and products with no reach are handled", async () => {
    const a = [...TIE.map((row) => [...row, 0]), [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
    const p = await turf(a, 2);
    expect(p.products).toEqual([1, 2]);
    expect([p.respondents, p.reachProp]).toEqual([10, 0.7]);
    await expect(turf(a, 6)).rejects.toThrow(/only 5 products/);
  });

  it("logical matrices give the same result", async () => {
    const p = await turf(TIE, 2);
    expect((await turf(TIE.map((row) => row.map((v) => v === 1)), 2)).products).toEqual(p.products);
    const named = await turf(TIE, 2, { names: ["a", "b", "c", "d", "e"] });
    expect(named.names).toEqual(["b", "c"]);
  });

  it("bad input gives clear errors", async () => {
    await expect(turf([["a", "b"]] as any, 1)).rejects.toThrow(TypeError);
    await expect(turf([] as any, 1)).rejects.toThrow(/at least one row/);
    await expect(turf([[1, null]] as any, 1)).rejects.toThrow(/missing values/);
    await expect(turf([[1, NaN]], 1)).rejects.toThrow(/missing values/);
    await expect(turf([[1, 2]], 1)).rejects.toThrow(/only 0 and 1/);
    await expect(turf(TIE, 1.5)).rejects.toThrow(/single whole number/);
    await expect(turf(TIE, true as any)).rejects.toThrow(/single whole number/);
    await expect(turf(TIE, 2, { tiebreak: ["reach" as any] })).rejects.toThrow(/frequency/);
    await expect(turf([[0, 0], [0, 0]], 1)).rejects.toThrow(/only 0 products/);
    await expect(turfMinCover([[0, 0], [0, 0]])).rejects.toThrow(/No product/);
    await expect(turf(TIE, 2, { names: ["x"] })).rejects.toThrow(/one name per column/);
  });

  it("holes in sparse arrays are missing values", async () => {
    // eslint-disable-next-line no-sparse-arrays
    await expect(turf([[1, , 0], [0, 1, 1]] as any, 1)).rejects.toThrow(/missing values/);
    const sparseRow = [1, 0];
    sparseRow.length = 3;
    await expect(turf([sparseRow, [0, 1, 1]], 1)).rejects.toThrow(/missing values/);
    const sparseOuter: number[][] = [[1, 0]];
    sparseOuter.length = 2;
    await expect(turf(sparseOuter, 1)).rejects.toThrow(TypeError);
    // eslint-disable-next-line no-sparse-arrays
    await expect(turf([[1, 0], , [0, 1]] as any, 1)).rejects.toThrow(/numeric or logical/);
  });

  it("wrong types give TypeError and bad values RangeError", async () => {
    await expect(turf(TIE, "2" as any)).rejects.toThrow(TypeError);
    await expect(turf(TIE, 1.5)).rejects.toThrow(RangeError);
    await expect(turf(TIE, 2, { tiebreak: 3 as any })).rejects.toThrow(TypeError);
    await expect(turf(TIE, 2, { tiebreak: ["reach" as any] })).rejects.toThrow(RangeError);
  });

  it("limits are checked before solving", async () => {
    for (const bad of [NaN, -1, 1.5]) {
      await expect(turf(TIE, 2, { maxPool: bad })).rejects.toThrow(RangeError);
    }
    await expect(turf(TIE, 2, { maxPool: "5" as any })).rejects.toThrow(TypeError);
    for (const bad of [NaN, -0.5]) {
      await expect(turf(TIE, 2, { maxPoolSeconds: bad })).rejects.toThrow(RangeError);
      await expect(turfSizes(TIE, [1], { maxPoolSeconds: bad })).rejects.toThrow(RangeError);
    }
    expect((await turf(TIE, 2, { maxPool: 0, maxPoolSeconds: Infinity })).reach).toBe(7);
  });

  it("the pool time limit gives a warning and a valid portfolio", async () => {
    const p = await turf(TIE, 2, { tiebreak: ["penetration", "frequency"], maxPoolSeconds: 0 });
    expect(p.warnings.length).toBeGreaterThan(0);
    expect(p.warnings.every((w) => w.includes("time limit"))).toBe(true);
    expect(p.reach).toBe(brute(TIE, 2, ["penetration"]).reach);
  });

  it("many tied portfolios give no warning when the pool is complete", async () => {
    const eye = Array.from({ length: 101 }, (_, i) => Array.from({ length: 101 }, (_, j) => (i === j ? 1 : 0)));
    const p = await turf(eye, 1, { tiebreak: ["penetration", "frequency"] });
    expect(p.warnings).toEqual([]);
    expect(p.reach).toBe(1);
  });
});
