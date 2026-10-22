// The stage and trade-off solves, checked against every portfolio of the ice
// cream data (10 flavors, so every size has at most 252 portfolios).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSolver, turf } from "../../js/src/index.js";
import { readInput } from "../../js/test/helpers.js";
import { frontier, stageInfo, TIE_CAP } from "../src/analysis.js";
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

describe("frontier", () => {
  it.each([
    ["ice cream", 2], ["ice cream", 3], ["ice cream", 5], ["chips", 3], ["chips", 4],
  ] as const)("matches every portfolio of %s, size %i", async (data, k) => {
    const matrix = data === "chips" ? chips : iceCream;
    const rows = rowsOf(matrix);
    const measure = (products: number[]) => measureIn(rows, products);
    const all = combos(matrix.cols, k).map(measure);
    // Brute force: no other portfolio has at least the reach and at least the frequency, one of them more.
    const pareto = all.filter((p) => !all.some((q) =>
      q.reach >= p.reach && q.frequency >= p.frequency && (q.reach > p.reach || q.frequency > p.frequency)));
    const want = [...new Map(pareto.map((p) => [`${p.reach}|${p.frequency}`, p])).values()]
      .sort((a, b) => b.reach - a.reach)
      .map((p) => [p.reach, p.frequency]);
    const seen: number[][] = [];
    const res = await frontier(matrix, k, { onPoint: (p) => seen.push([p.reach, p.frequency]) });
    expect(res.stop).toBe("complete");
    expect(res.points.map((p) => [p.reach, p.frequency])).toEqual(want);
    expect(seen).toEqual(want);
    expect(res.maxFrequency).toBe(Math.max(...all.map((p) => p.frequency)));
    for (const p of res.points) expect(measure(p.products)).toMatchObject({ reach: p.reach, frequency: p.frequency });
  });

  it("stops at the point limit", async () => {
    const res = await frontier(matrix, 2, { maxPoints: 2 });
    expect(res.points.length).toBe(2);
    expect(res.stop).toBe("limit");
  });

  it("stops when asked", async () => {
    let calls = 0;
    const res = await frontier(matrix, 2, { between: async () => ++calls < 3 });
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
    expect(last.at(-1)).toEqual({ products: [8, 9, 10, 11], added: 4, slot: PRODUCT_COLORS });
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
    const pareto = all.filter((p) => !all.some((q) =>
      q.reach >= p.reach && q.frequency >= p.frequency && (q.reach > p.reach || q.frequency > p.frequency)));
    const want = [...new Map(pareto.map((p) => [`${p.reach}|${p.frequency}`, p])).values()]
      .sort((a, b) => b.reach - a.reach)
      .map((p) => [p.reach, p.frequency]);
    const res = await frontier(matrix, k, { fixed });
    // Without the fixed products in the maximum, the search would stop at "limit" or run past the frontier.
    expect(res.stop).toBe("complete");
    expect(res.points.map((p) => [p.reach, p.frequency])).toEqual(want);
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
