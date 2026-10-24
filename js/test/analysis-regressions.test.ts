// The analysis solves, checked against every
// portfolio of the ice cream data (10 flavors, so every size has at most 252 portfolios).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSolver, turf } from "../src/index.js";
import { baselines, frontier } from "../src/analysis.js";
import { load, type DatasetName } from "../src/datasets.js";

const require = createRequire(import.meta.url);

function exampleMatrix(name: DatasetName, threshold: number) {
  const dataset = load(name);
  const rows = dataset.values.map(row => row.map(value => Number(value >= threshold)));
  return { rows: rows.length, cols: dataset.columns.length, data: Uint8Array.from(rows.flat()), names: dataset.columns };
}
const matrix = exampleMatrix("icecream", 8);
const t = { cols: matrix.cols };
const iceCream = matrix;
type M = typeof matrix;
const rowsOf = (m: M) => Array.from({ length: m.rows }, (_, i) => Array.from(m.data.subarray(i * m.cols, (i + 1) * m.cols)));
const rows = rowsOf(matrix);

function combos(n: number, k: number, start = 0, acc: number[] = []): number[][] {
  if (acc.length === k) return [acc];
  const out: number[][] = [];
  for (let j = start; j < n; j++) out.push(...combos(n, k, j + 1, [...acc, j]));
  return out;
}

function measure(products: number[]) {
  return measureIn(rows, products);
}

function measureIn(rows: number[][], products: number[]) {
  const sums = products.map((j) => rows.reduce((s, r) => s + r[j], 0));
  return {
    products,
    reach: rows.filter((r) => products.some((j) => r[j] === 1)).length,
    frequency: sums.reduce((a, b) => a + b, 0),
    penetration: products.length / sums.reduce((s, x) => s + 1 / x, 0),
  };
}

beforeAll(async () => {
  await loadSolver({ wasmBinary: new Uint8Array(readFileSync(require.resolve("highs/runtime"))) });
});

const chips = exampleMatrix("chips", 4);

type Measured = ReturnType<typeof measureIn>;
/** The frontier by enumeration: [reach, frequency, best penetration of the portfolios with both], most reach first. */
function paretoOf(all: Measured[]): number[][] {
  const pareto = all.filter((p) => !all.some((q) =>
    q.reach >= p.reach && q.frequency >= p.frequency && (q.reach > p.reach || q.frequency > p.frequency)));
  const best = new Map<string, Measured>();
  for (const p of pareto) {
    const key = `${p.reach}|${p.frequency}`;
    if (!best.has(key) || p.penetration > best.get(key)!.penetration) best.set(key, p);
  }
  return [...best.values()].sort((a, b) => b.reach - a.reach).map((p) => [p.reach, p.frequency, p.penetration]);
}
const asPoints = (pts: { reach: number; frequency: number; penetration: number }[]) =>
  pts.map((p) => [p.reach, p.frequency, expect.closeTo(p.penetration, 9)]);

/** Greedy by enumeration of the next product: most added reach, then most individual reach, then first column. */
function greedyOf(rows: number[][], k: number, fixed: readonly number[] = []): number[] {
  const cols = rows[0].length;
  const sel = [...fixed];
  while (sel.length < k) {
    let best = -1;
    let bestKey = [-1, -1];
    for (let j = 0; j < cols; j++) {
      if (sel.includes(j)) continue;
      const m = measureIn(rows, [j]);
      if (m.reach === 0) continue;
      const key = [measureIn(rows, [...sel, j]).reach, m.reach];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) { best = j; bestKey = key; }
    }
    sel.push(best);
  }
  return sel.sort((a, b) => a - b);
}

/** The most popular portfolio by enumeration: the most frequency, then the most reach. */
function mostPopularOf(all: Measured[]): Measured {
  const maxF = Math.max(...all.map((p) => p.frequency));
  return all.filter((p) => p.frequency === maxF).reduce((a, b) => (b.reach > a.reach ? b : a));
}

describe("frontier", () => {
  it.each([
    ["ice cream", 2], ["ice cream", 3], ["ice cream", 5], ["chips", 3], ["chips", 4],
  ] as const)("matches every portfolio of %s, size %i", async (data, k) => {
    const matrix = data === "chips" ? chips : iceCream;
    const rows = rowsOf(matrix);
    const measure = (products: number[]) => measureIn(rows, products);
    const all = combos(matrix.cols, k).map(measure);
    // Brute force: no other portfolio has at least the reach and at least the frequency, one of them more.
    const want = paretoOf(all);
    const seen: number[][] = [];
    const res = await frontier(matrix, k, { onPoint: (p) => seen.push([p.reach, p.frequency]) });
    expect(res.stop).toBe("complete");
    expect(asPoints(res.points)).toEqual(want);
    expect(seen).toEqual(want.map((p) => p.slice(0, 2)));
    expect(res.maxFrequency).toBe(Math.max(...all.map((p) => p.frequency)));
    for (const p of res.points) expect(measure(p.products)).toMatchObject({ reach: p.reach, frequency: p.frequency });

    // The deep dive reuses the run's portfolio as the first point and the most popular one as the last.
    const base = await baselines(matrix, k);
    expect(base.stop).toBe("complete");
    const popular = mostPopularOf(all);
    expect([base.mostPopular!.reach, base.mostPopular!.frequency]).toEqual([popular.reach, popular.frequency]);
    expect(base.greedy.products).toEqual(greedyOf(rows, k));
    for (const tiebreak of [["frequency", "penetration"], ["frequency"], ["penetration"]] as const) {
      const chosen = await turf(rows, k, { tiebreak: [...tiebreak] });
      const reused = await frontier(matrix, k, { chosen: { products: chosen.products, tiebreak }, last: base.mostPopular! });
      expect(reused.stop).toBe("complete");
      expect(asPoints(reused.points)).toEqual(want);
    }
  });

  it("takes the best penetration among the portfolios with the same reach and frequency", async () => {
    // {B, D} and {A, C} both reach 6 with frequency 6, the most reach at that frequency.
    // B and D reach 2 and 4 respondents (penetration 2.67); A and C reach 3 each (penetration 3).
    const a = [[0, 0, 1, 1], [0, 0, 0, 0], [0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 1, 1], [1, 0, 0, 1], [1, 0, 0, 1]];
    const m = { rows: a.length, cols: 4, data: Uint8Array.from(a.flat()), names: ["A", "B", "C", "D"] };
    const res = await frontier(m, 2);
    const p = res.points.find((q) => q.reach === 6 && q.frequency === 6)!;
    expect([p.products, p.penetration]).toEqual([[0, 2], 3]);
  });

  it("searches past the solver tolerance for the best penetration", async () => {
    // A and B reach 50,000 each (penetration 50,000); C and D reach 49,999 and 50,001
    // (penetration 49,999.99998). Both pairs reach everyone with frequency 100,000.
    const counts: [number[], number][] = [[[1, 0, 1, 0], 25_000], [[1, 0, 0, 1], 25_000], [[0, 1, 1, 0], 24_999], [[0, 1, 0, 1], 25_001]];
    const a = counts.flatMap(([row, n]) => Array.from({ length: n }, () => row));
    const m = { rows: a.length, cols: 4, data: Uint8Array.from(a.flat()), names: ["A", "B", "C", "D"] };
    const chosen = await turf(a, 2, { tiebreak: ["frequency", "penetration"] });
    expect(chosen.products).toEqual([0, 1]);
    for (const options of [{}, { chosen: { products: chosen.products, tiebreak: ["frequency"] as const } }]) {
      const res = await frontier(m, 2, options);
      expect([res.stop, res.penetrationLimited, res.points[0].products, res.points[0].penetration])
        .toEqual(["complete", false, [0, 1], expect.closeTo(50_000, 6)]);
    }
  });

  it("stops the penetration search when asked", async () => {
    // Every product reaches 19 of 20 respondents, so every portfolio of 10 ties on all three criteria
    // and the search for the best penetration would run to its limit of 1,000 solves.
    const n = 20;
    const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 1)));
    const m = { rows: n, cols: n, data: Uint8Array.from(a.flat()), names: a.map((_, j) => `P${j}`) };
    const products = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let calls = 0;
    const res = await frontier(m, 10, { chosen: { products, tiebreak: ["frequency"] }, between: async () => ++calls < 3 });
    expect([res.stop, res.points.length, calls]).toEqual(["cancelled", 0, 3]);
  });

  it("finds the most popular products that reach the most when products tie on reach at the cut", async () => {
    // A reaches 3; B, C, and D reach 2 each. A and B reach the same respondents, so {A, B} reaches 3 and {A, C} 4.
    const a = [[1, 1, 0, 0], [1, 1, 0, 1], [1, 0, 1, 1], [0, 0, 1, 0]];
    const m = { rows: 4, cols: 4, data: Uint8Array.from(a.flat()), names: ["A", "B", "C", "D"] };
    const base = await baselines(m, 2);
    expect([base.stop, base.mostPopular!.reach, base.mostPopular!.frequency]).toEqual(["complete", 4, 5]);
    expect(base.mostPopular!.products).toEqual([0, 2]);
  });

  it("stops at the point limit", async () => {
    const res = await frontier(matrix, 2, { maxPoints: 2 });
    expect(res.points.length).toBe(2);
    expect(res.stop).toBe("limit");
  });

  it("stops when asked", async () => {
    // Cancel at the first pause after the first point.
    let found = 0;
    const res = await frontier(matrix, 2, { onPoint: () => found++, between: async () => found === 0 });
    expect(res.stop).toBe("cancelled");
    expect(res.points.length).toBe(1);
  });
});

describe("fixed products", () => {
  const fixed = [6, 8];
  const withFixed = (k: number) => combos(t.cols, k).filter((c) => fixed.every((j) => c.includes(j))).map(measure);

  it.each([2, 3, 5])("the trade-off of size %i matches every portfolio with the fixed products", async (k) => {
    const all = withFixed(k);
    const want = paretoOf(all);
    const res = await frontier(matrix, k, { fixed });
    // Without the fixed products in the maximum, the search would stop at "limit" or run past the frontier.
    expect(res.stop).toBe("complete");
    expect(asPoints(res.points)).toEqual(want);
    const base = await baselines(matrix, k, { fixed });
    const popular = mostPopularOf(all);
    expect([base.mostPopular!.reach, base.mostPopular!.frequency]).toEqual([popular.reach, popular.frequency]);
    expect(base.greedy.products).toEqual(greedyOf(rows, k, fixed));
    expect(res.maxFrequency).toBe(Math.max(...all.map((p) => p.frequency)));
    for (const p of res.points) expect(fixed.every((j) => p.products.includes(j))).toBe(true);
  });

  it("does not force the twin of a fixed product in", async () => {
    // A and B are identical. With B fixed, {B, C} has the most reach.
    const a = [[1, 1, 0], [1, 1, 0], [0, 0, 1]];
    const m = { rows: 3, cols: 3, data: Uint8Array.from(a.flat()), names: ["A", "B", "C"] };
    const fr = await frontier(m, 2, { fixed: [1] });
    expect([fr.stop, fr.maxFrequency, fr.points.map((p) => [p.reach, p.frequency])])
      .toEqual(["complete", 4, [[3, 3], [2, 4]]]);
  });


});

describe("duplicate respondents", () => {
  // 90 respondents from 9 response patterns, so the solves run on weighted rows; a
  // weight left out or counted twice changes a reach below.
  const patterns = [[1, 0, 0, 1, 0, 0, 1], [0, 1, 0, 0, 1, 0, 0], [1, 1, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 1, 0],
                    [0, 0, 0, 1, 1, 0, 0], [1, 0, 1, 0, 0, 0, 1], [0, 0, 0, 0, 0, 1, 1], [0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]];
  const a = Array.from({ length: 90 }, (_, i) => patterns[(i * 7 + (i % 4)) % patterns.length]);
  const m = { rows: a.length, cols: 7, data: Uint8Array.from(a.flat()), names: ["A", "B", "C", "D", "E", "F", "G"] };

  it.each([[3, []], [3, [6]], [4, [0, 5]]] as const)("size %i with fixed %j matches every portfolio", async (k, fixed) => {
    const all = combos(m.cols, k).filter((c) => fixed.every((j) => c.includes(j))).map((p) => measureIn(a, p));
    const want = paretoOf(all);
    const fr = await frontier(m, k, { fixed: [...fixed] });
    expect(fr.stop).toBe("complete");
    expect(asPoints(fr.points)).toEqual(want);
    const base = await baselines(m, k, { fixed: [...fixed] });
    const popular = mostPopularOf(all);
    expect([base.mostPopular!.reach, base.mostPopular!.frequency]).toEqual([popular.reach, popular.frequency]);
    expect(base.greedy.products).toEqual(greedyOf(a, k, fixed));

    const chosen = await turf(a, k, { tiebreak: ["frequency", "penetration"], fixed: [...fixed] });
    expect(chosen.reach).toBe(Math.max(...all.map((p) => p.reach)));
  });
});
