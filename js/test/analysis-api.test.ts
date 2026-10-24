import { describe, expect, it } from "vitest";
import { turfBaselines, turfFrontier } from "../src/index.js";
import { load } from "../src/datasets.js";

function portfolios(a: number[][], size: number, fixed: number[] = []) {
  const out: { products: number[]; reach: number; frequency: number; penetration: number }[] = [];
  function visit(start: number, sel: number[]) {
    if (sel.length === size) {
      if (!fixed.every((j) => sel.includes(j))) return;
      const sums = sel.map((j) => a.reduce((s, row) => s + row[j], 0));
      if (sums.includes(0)) return;
      out.push({ products: sel, reach: a.filter((row) => sel.some((j) => row[j])).length,
        frequency: sums.reduce((s, n) => s + n, 0), penetration: size / sums.reduce((s, n) => s + 1 / n, 0) });
      return;
    }
    for (let j = start; j < a[0].length; j++) visit(j + 1, [...sel, j]);
  }
  visit(0, []);
  return out;
}

describe("public analysis API", () => {
  it.each([{ fixed: [] }, { fixed: [0] }, { fixed: [0, 1] }])("matches all ice cream portfolios with $fixed", async ({ fixed }) => {
    const a = load("icecream").values.map((row) => row.map((v) => Number(v >= 8)));
    const all = portfolios(a, 3, fixed);
    const expected = all.filter((p) => !all.some((q) =>
      q.reach >= p.reach && q.frequency >= p.frequency && (q.reach > p.reach || q.frequency > p.frequency)));
    const unique = new Map<string, typeof all[number]>();
    for (const p of expected) {
      const key = `${p.reach},${p.frequency}`;
      if (!unique.has(key) || unique.get(key)!.penetration < p.penetration) unique.set(key, p);
    }
    const want = [...unique.values()].sort((a, b) => b.reach - a.reach);
    const result = await turfFrontier(a, 3, { fixed, seconds: Infinity });
    expect(result.stop).toBe("complete");
    expect(result.penetrationLimited).toBe(false);
    expect(result.points.map((p) => [p.reach, p.frequency, p.penetration])).toEqual(
      want.map((p) => [p.reach, p.frequency, expect.closeTo(p.penetration, 9)]));
    for (const point of result.points) {
      expect(all.find((p) => p.products.join() === point.products.join())).toMatchObject(point);
    }
    const base = await turfBaselines(a, 3, { fixed, seconds: Infinity });
    const maxFrequency = Math.max(...all.map((p) => p.frequency));
    expect(base.stop).toBe("complete");
    expect(base.mostPopular).toMatchObject({ frequency: maxFrequency,
      reach: Math.max(...all.filter((p) => p.frequency === maxFrequency).map((p) => p.reach)) });
    expect(all.find((p) => p.products.join() === base.greedy.products.join())).toMatchObject(base.greedy);
  });

  it("rejects malformed input and limits before solving", async () => {
    const a = [[1, 0, 0], [0, 1, 0]];
    for (const fn of [turfFrontier, turfBaselines]) {
      await expect(fn([[1, 2]], 1)).rejects.toThrow();
      await expect(fn(a, 1.5)).rejects.toThrow();
      await expect(fn(a, 1, { fixed: [2] })).rejects.toThrow();
      await expect(fn(a, 1, { fixed: [0, 1] })).rejects.toThrow();
      await expect(fn(a, 1, { fixed: [NaN] })).rejects.toThrow();
      for (const seconds of [-1, NaN, "1", null]) {
        await expect(fn(a, 1, { seconds: seconds as number })).rejects.toThrow();
      }
    }
    for (const maxPoints of [0, -1, NaN, Infinity, 1.5, "1", null]) {
      await expect(turfFrontier(a, 1, { maxPoints: maxPoints as number })).rejects.toThrow();
    }
  });

  it("reports deadline and cancellation without claiming a complete frontier", async () => {
    const a = [[1, 0], [0, 1]];
    expect(await turfFrontier(a, 1, { seconds: 0 })).toMatchObject({ points: [], stop: "time" });
    expect(await turfFrontier(a, 1, { between: async () => false })).toMatchObject({ points: [], stop: "cancelled" });
    expect(await turfBaselines(a, 1, { between: async () => false })).toMatchObject({ mostPopular: null, stop: "cancelled" });
  });

  it("ignores forged optimality hints and isolates progress mutation", async () => {
    const a = load("icecream").values.map((row) => row.map((v) => Number(v >= 8)));
    const reference = await turfFrontier(a, 2);
    const options = { chosen: { products: [0], tiebreak: ["frequency", "penetration"] },
      last: { products: [0], reach: 999, frequency: 999, penetration: 999 },
      onPoint: (p: { products: number[]; reach: number }) => { p.reach = 999; p.products.length = 0; } };
    expect(await turfFrontier(a, 2, options)).toEqual(reference);
    const limited = await turfFrontier(a, 2, { maxPoints: 1 });
    expect(limited.stop).toBe("limit");
    expect(limited.points).toEqual(reference.points.slice(0, 1));
  });
});
