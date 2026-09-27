// The shared conformance suite (conformance/README.md), with presolve on and off.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { turf, turfMinCover, turfSizes, type Portfolio } from "../src/index.js";
import { worseOnEarlier } from "../src/core.js";
import { settings } from "../src/solver.js";
import { exactPenetration, fixtures, hasConformance, parseFraction, readInput } from "./helpers.js";

function checkFields(a: number[][], names: string[], p: Portfolio) {
  const sel = [...p.products];
  expect(new Set(sel).size).toBe(sel.length);
  expect(p.size).toBe(sel.length);
  expect(p.names).toEqual(sel.map((j) => names[j]));
  const r = sel.map((j) => a.reduce((s, row) => s + row[j], 0));
  const reached = a.filter((row) => sel.some((j) => row[j] === 1)).length;
  expect(p.reach).toBe(reached);
  expect(p.respondents).toBe(a.length);
  expect(p.reachProp).toBe(reached / a.length);
  expect(p.frequency).toBe(r.reduce((s, x) => s + x, 0));
  const h = sel.length / r.reduce((s, x) => s + 1 / x, 0);
  expect(Math.abs(p.penetration - h)).toBeLessThanOrEqual(1e-12 * h);
}

function checkExpected(a: number[][], p: Portfolio, e: any) {
  expect(p.reach).toBe(e.reach);
  if ("frequency" in e) expect(p.frequency).toBe(e.frequency);
  if ("penetration" in e) {
    expect(exactPenetration(a, p.products)).toEqual(parseFraction(e.penetration.fraction));
  }
}

const presolveSettings = ["on", "off"] as const;
const load = (kind: string) => (hasConformance ? fixtures(kind) : []);

/** Group cases by input, so each test runs a handful of solves (fewer runner messages). */
// Let the test runner's messages through between synchronous solves.
const yieldToRunner = () => new Promise<void>((resolve) => setImmediate(resolve));

function byInput(kind: string): [string, any[]][] {
  const groups = new Map<string, any[]>();
  for (const c of load(kind)) groups.set(c.input, [...(groups.get(c.input) ?? []), c]);
  return [...groups];
}

describe.skipIf(!hasConformance)("conformance", () => {
  describe.each(presolveSettings)("presolve %s", (presolve) => {
    beforeAll(() => { settings.presolve = presolve; });
    afterAll(() => { settings.presolve = "on"; });

    it.each(byInput("turf"))("turf %s", async (input, cases) => {
      const { a, names } = readInput(input);
      for (const c of cases) {
        const p = await turf(a, c.size, { tiebreak: c.tiebreak, names, maxPoolSeconds: Infinity });
        expect(p.warnings, c.id).toEqual([]);
        checkFields(a, names, p);
        checkExpected(a, p, c.expected);
        await yieldToRunner();
      }
    });

    it("min_cover", async () => {
      for (const c of load("min_cover")) {
        const { a, names } = readInput(c.input);
        const p = await turfMinCover(a, { names });
        checkFields(a, names, p);
        expect(p.size, c.id).toBe(c.expected.size);
        expect(p.reach, c.id).toBe(c.expected.reachable);
        await yieldToRunner();
      }
    });

    it.each(load("sizes"))("sizes $id", async (c) => {
      const { a, names } = readInput(c.input);
      const rows = await turfSizes(a, c.sizes, { tiebreak: c.tiebreak, names, maxPoolSeconds: Infinity });
      expect(rows.map((p) => p.size)).toEqual(c.expected.map((e: any) => e.size));
      rows.forEach((p, i) => { checkFields(a, names, p); checkExpected(a, p, c.expected[i]); });
    });

    it.each(load("bounded"))("bounded $id", async (c) => {
      const { a, names } = readInput(c.input);
      const p = await turf(a, c.size, {
        tiebreak: c.tiebreak, names, maxPool: c.max_pool,
        maxPoolSeconds: c.max_pool_seconds ?? Infinity,
      });
      expect(p.warnings).toEqual(c.warnings);
      checkFields(a, names, p);
      checkExpected(a, p, c.expected);
    });
  });

  it("comparator", () => {
    const obj = { name: "x", direction: "min" as const, value: (v: number) => v };
    for (const c of load("comparator")) {
      expect(worseOnEarlier([obj], c.new, c.old, c.size), JSON.stringify(c)).toBe(c.worse);
    }
  });
});
