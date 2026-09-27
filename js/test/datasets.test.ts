import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { datasetNames, load } from "../src/datasets.js";
import { turf } from "../src/index.js";
import { CONFORMANCE, hasConformance } from "./helpers.js";

const DIMS: Record<string, [number, number]> = {
  icecream: [120, 10], chips: [600, 24], cafe: [2500, 40], ham: [127, 8],
  coffee: [118, 27], pies: [980, 10], lunchbags: [1175, 14],
};

describe("datasets", () => {
  it("all seven load with the R dimensions", () => {
    expect([...datasetNames].sort()).toEqual(Object.keys(DIMS).sort());
    for (const [name, [rows, cols]] of Object.entries(DIMS)) {
      const d = load(name as any);
      expect([d.values.length, d.values[0].length, d.columns.length]).toEqual([rows, cols, cols]);
    }
  });

  it.skipIf(!hasConformance)("equal the R export", () => {
    for (const name of Object.keys(DIMS)) {
      const lines = readFileSync(join(CONFORMANCE, "data", `${name}.csv`), "utf8").trim().split(/\r?\n/);
      const d = load(name as any);
      expect(d.columns).toEqual(lines[0].split(",").map((c) => JSON.parse(c)));
      expect(d.values).toEqual(lines.slice(1).map((l) => l.split(",").map(Number)));
    }
  });

  it("the documented thresholds give the R example", async () => {
    const ham = load("ham");
    const p = await turf(ham.values.map((row) => row.map((v) => v >= 7)), 2, { names: ham.columns });
    expect(p.names).toEqual(["N4", "S1"]);
    expect(p.reach).toBe(98);
  });

  it("unknown data set", () => {
    expect(() => load("sushi" as any)).toThrow(/Unknown data set/);
  });
});
