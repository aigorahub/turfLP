// The stage and trade-off solves, checked against every portfolio of the ice
// cream data (10 flavors, so every size has at most 252 portfolios).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSolver, turf } from "../../js/src/index.js";
import { readInput } from "../../js/test/helpers.js";
import { baselines, frontier, stageInfo, TIE_CAP } from "../src/analysis.js";
import { addedInOrder, contributions, PRODUCT_COLORS, stackColumns } from "../src/contrib.js";
import { toReach } from "../src/csv.js";
import { exampleTable } from "../src/data.js";

const require = createRequire(new URL("../../js/package.json", import.meta.url));

const t = exampleTable("icecream");
const matrix = { rows: t.rows, cols: t.cols, data: toReach(t, 8), names: t.names };
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

const chipsTable = exampleTable("chips");
const chips = { rows: chipsTable.rows, cols: chipsTable.cols, data: toReach(chipsTable, 4), names: chipsTable.names };

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

describe("stageInfo", () => {
  it.each([3, 5])("gives the ranges and ties of size %i", async (k) => {
    const chosen = await turf(rows, k, { tiebreak: ["frequency", "penetration"] });
    const res = await stageInfo(matrix, [...chosen.products], ["frequency", "penetration"]);
    expect(res.stop).toBe("complete");
    const all = combos(t.cols, k).map(measure);
    const atReach = all.filter((p) => p.reach >= chosen.reach);
    const atFreq = atReach.filter((p) => p.frequency >= chosen.frequency);
    const [s1, s2, s3] = res.stages;
    expect(s1).toMatchObject({ criterion: "reach", value: chosen.reach, worst: null });
    expect(Math.max(...all.map((p) => p.reach))).toBe(chosen.reach);
    expect(s2.value).toBe(Math.max(...atReach.map((p) => p.frequency)));
    expect(s2.worst).toBe(Math.min(...atReach.map((p) => p.frequency)));
    expect(s3.value).toBeCloseTo(Math.max(...atFreq.map((p) => p.penetration)), 9);
    expect(s3.worst).toBeCloseTo(Math.min(...atFreq.map((p) => p.penetration)), 9);
    expect(s1.ties).toBe(Math.min(atReach.length, TIE_CAP));
    expect(s1.tiesAtLeast).toBe(atReach.length >= TIE_CAP);
    expect(s2.ties).toBe(Math.min(atFreq.length, TIE_CAP));
  });

  it("counts each of two identical products", async () => {
    // Columns 0 and 1 reach the same respondents, so {0} and {1} tie on every stage.
    const a = [[1, 1, 0], [1, 1, 0], [0, 0, 1]];
    const m = { rows: 3, cols: 3, data: Uint8Array.from(a.flat()), names: ["A", "B", "C"] };
    const res = await stageInfo(m, [0], ["frequency", "penetration"]);
    expect(res.stages.map((s) => [s.ties, s.tiesAtLeast])).toEqual([[2, false], [2, false], [2, false]]);
  });

  it("counts a penetration tie only within the comparison tolerance", async () => {
    // Two portfolios have the most reach, with penetration values 2e-13 apart: the solver
    // tolerance admits both, the comparison tolerance of the package only one.
    const { a, names } = readInput("near-42000");
    const m = { rows: a.length, cols: names.length, data: Uint8Array.from(a.flat()), names };
    const chosen = await turf(a, 2, { tiebreak: ["penetration", "frequency"] });
    const res = await stageInfo(m, [...chosen.products], ["penetration", "frequency"]);
    expect(res.stop).toBe("complete");
    expect(res.stages.map((s) => [s.ties, s.tiesAtLeast])).toEqual([[2, false], [1, false], [1, false]]);
  });

  it("follows the tie-break order", async () => {
    const chosen = await turf(rows, 4, { tiebreak: [] });
    const res = await stageInfo(matrix, [...chosen.products], []);
    expect(res.stages.map((s) => s.criterion)).toEqual(["reach"]);
    const pf = await stageInfo(matrix, [...(await turf(rows, 4, { tiebreak: ["penetration", "frequency"] })).products],
                               ["penetration", "frequency"]);
    expect(pf.stages.map((s) => s.criterion)).toEqual(["reach", "penetration", "frequency"]);
    expect(pf.stop).toBe("complete");
  });
});

describe("contributions", () => {
  it("adds up to the reach, largest share first", () => {
    for (const k of [1, 3, 6]) {
      const products = combos(t.cols, k)[7 % combos(t.cols, k).length];
      const parts = contributions(matrix, products);
      expect(parts.map((p) => p.product).sort((a, b) => a - b)).toEqual(products);
      expect(parts.reduce((s, p) => s + p.added, 0)).toBe(measure(products).reach);
      expect(parts[0].added).toBe(Math.max(...products.map((j) => measure([j]).reach)));
      for (let i = 1; i < parts.length; i++) expect(parts[i].added).toBeLessThanOrEqual(parts[i - 1].added);
    }
  });
});

describe("stackColumns", () => {
  it("keeps one color slot per product and stacks each column by slot", async () => {
    const portfolios: Awaited<ReturnType<typeof turf>>[] = [];
    for (const k of [1, 2, 3, 4, 5]) portfolios.push(await turf(rows, k, { tiebreak: ["frequency", "penetration"] }));
    const { slots, columns } = stackColumns(matrix, portfolios);
    // Slots go to products as they first join, so size 1 has slot 0.
    expect(slots.get(portfolios[0].products[0])).toBe(0);
    columns.forEach((parts, k) => {
      expect(parts.reduce((s, p) => s + p.added, 0)).toBe(portfolios[k].reach);
      const order = parts.map((p) => p.slot);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      for (const p of parts) expect(slots.get(p.products[0])).toBe(p.slot);
    });
  });

  it("puts the products past the last color in one segment on top", () => {
    // Twelve products, each reaching its own respondent: each size adds one new product.
    const n = PRODUCT_COLORS + 4;
    const m = { rows: n, cols: n, data: Uint8Array.from({ length: n * n }, (_, i) => (i % (n + 1) === 0 ? 1 : 0)),
                names: Array.from({ length: n }, (_, j) => `P${j}`) };
    const portfolios = Array.from({ length: n }, (_, k) => ({ products: Array.from({ length: k + 1 }, (_, j) => j) }));
    const last = stackColumns(m, portfolios).columns.at(-1)!;
    expect(last.length).toBe(PRODUCT_COLORS + 1);
    expect(last.at(-1)).toEqual({ products: [8, 9, 10, 11], added: 4, slot: PRODUCT_COLORS, fixed: false });
  });

  it("puts the fixed products in one segment when they would take every color", () => {
    // One more fixed product than colors: without the group, no other product gets a color.
    const n = PRODUCT_COLORS + 4;
    const m = { rows: n, cols: n, data: Uint8Array.from({ length: n * n }, (_, i) => (i % (n + 1) === 0 ? 1 : 0)),
                names: Array.from({ length: n }, (_, j) => `P${j}`) };
    const fixed = Array.from({ length: PRODUCT_COLORS + 1 }, (_, j) => j);
    const portfolios = [fixed, [...fixed, 9], [...fixed, 9, 10]].map((products) => ({ products }));
    const last = stackColumns(m, portfolios, fixed).columns.at(-1)!;
    expect(last).toEqual([
      { products: fixed, added: fixed.length, slot: 0, fixed: true },
      { products: [9], added: 1, slot: 1, fixed: false },
      { products: [10], added: 1, slot: 2, fixed: false },
    ]);
  });

  it("counts what each product adds in the given order", () => {
    expect(addedInOrder(matrix, [0, 1]).reduce((a, b) => a + b, 0)).toBe(measure([0, 1]).reach);
    expect(addedInOrder(matrix, [1, 0])[0]).toBe(measure([1]).reach);
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

  it.each([3, 5])("the stages of size %i count only portfolios with the fixed products", async (k) => {
    const chosen = await turf(rows, k, { tiebreak: ["frequency", "penetration"], fixed });
    const all = withFixed(k);
    expect(chosen.reach).toBe(Math.max(...all.map((p) => p.reach)));
    const res = await stageInfo(matrix, [...chosen.products], ["frequency", "penetration"], { fixed });
    expect(res.stop).toBe("complete");
    const atReach = all.filter((p) => p.reach >= chosen.reach);
    const atFreq = atReach.filter((p) => p.frequency >= chosen.frequency);
    const [s1, s2] = res.stages;
    expect(s2.worst).toBe(Math.min(...atReach.map((p) => p.frequency)));
    expect([s1.ties, s1.tiesAtLeast]).toEqual([Math.min(atReach.length, TIE_CAP), atReach.length >= TIE_CAP]);
    expect(s2.ties).toBe(Math.min(atFreq.length, TIE_CAP));
  });

  it("does not force the twin of a fixed product in", async () => {
    // A and B are identical. With B fixed, {B, C} has the most reach.
    const a = [[1, 1, 0], [1, 1, 0], [0, 0, 1]];
    const m = { rows: 3, cols: 3, data: Uint8Array.from(a.flat()), names: ["A", "B", "C"] };
    const res = await stageInfo(m, [1, 2], ["frequency"], { fixed: [1] });
    expect(res.stop).toBe("complete");
    expect(res.stages.map((s) => [s.ties, s.tiesAtLeast])).toEqual([[1, false], [1, false]]);
    const fr = await frontier(m, 2, { fixed: [1] });
    expect([fr.stop, fr.maxFrequency, fr.points.map((p) => [p.reach, p.frequency])])
      .toEqual(["complete", 4, [[3, 3], [2, 4]]]);
  });

  it("puts the fixed products first in the contributions and at the bottom of each column", () => {
    const parts = contributions(matrix, [0, 1, 6], [6]);
    expect(parts[0]).toEqual({ product: 6, added: measure([6]).reach });
    expect(parts.reduce((s, p) => s + p.added, 0)).toBe(measure([0, 1, 6]).reach);
    const portfolios = [{ products: [6, 8] }, { products: [0, 6, 8] }, { products: [0, 1, 6, 8] }];
    const { slots, columns } = stackColumns(matrix, portfolios, fixed);
    expect([slots.get(6), slots.get(8)].sort()).toEqual([0, 1]);
    for (const parts of columns) {
      expect(parts.slice(0, 2).map((p) => p.products[0]).sort()).toEqual(fixed);
    }
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
    const res = await stageInfo(m, [...chosen.products], ["frequency", "penetration"], { fixed: [...fixed] });
    const atReach = all.filter((p) => p.reach >= chosen.reach);
    const atFreq = atReach.filter((p) => p.frequency >= chosen.frequency);
    const [s1, s2] = res.stages;
    expect([s1.ties, s2.worst, s2.ties]).toEqual([
      Math.min(atReach.length, TIE_CAP), Math.min(...atReach.map((p) => p.frequency)), Math.min(atFreq.length, TIE_CAP)]);
    const parts = contributions(m, [...chosen.products], [...fixed]);
    expect(parts.reduce((s, p) => s + p.added, 0)).toBe(chosen.reach);
  });
});
