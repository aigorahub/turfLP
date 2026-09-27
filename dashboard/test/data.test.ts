import { describe, expect, it } from "vitest";
import { datasetNames } from "../../js/src/datasets.js";
import { EXAMPLES, exampleTable, resultsCsv, summarize } from "../src/data.js";
import { toReach } from "../src/csv.js";
import { count, decimal, list, percent, points, seconds } from "../src/format.js";

describe("examples", () => {
  it("cover every data set once", () => {
    expect(EXAMPLES.map((e) => e.id).sort()).toEqual([...datasetNames].sort());
  });

  it("have the dimensions and value types of the descriptions", () => {
    for (const ex of EXAMPLES) {
      const t = exampleTable(ex.id);
      expect(ex.description).toContain(String(t.cols));
      expect(ex.description).toContain(count(t.rows));
      expect(t.kind).toBe(ex.threshold === null ? "binary" : "ratings");
    }
  });
});

describe("summarize", () => {
  it("counts the reach of each product and the respondents some product reaches", () => {
    const reach = Uint8Array.from([1, 0, 1, 1, 0, 0, 0, 1]);
    expect(summarize(reach, 4, 2)).toEqual({ productReach: [2, 2], reachable: 3 });
  });

  it("matches the ice cream data at the top-2 box", () => {
    const t = exampleTable("icecream");
    const s = summarize(toReach(t, 8), t.rows, t.cols);
    expect(s.productReach).toHaveLength(10);
    expect(s.reachable).toBeLessThanOrEqual(120);
  });
});

describe("resultsCsv", () => {
  it("writes one row per size and quotes names", () => {
    const p = { products: [0, 2], names: ['Mint, "fresh"', "Vanilla"], size: 2, reach: 90, reachProp: 0.75,
                frequency: 120, penetration: 58.5, respondents: 120, warnings: [] };
    expect(resultsCsv([{ portfolio: p, seconds: 0.25 }])).toBe(
      "size,reach,reach_percent,frequency,penetration,products,seconds\n" +
      '2,90,75.00,120,58.5000,"Mint, ""fresh""; Vanilla",0.250\n');
  });
});

describe("format", () => {
  it("formats numbers for the page", () => {
    expect(percent(0.4783)).toBe("47.8%");
    expect(points(0.108)).toBe("+10.8 points");
    expect(seconds(0.03)).toBe("<0.1 s");
    expect(seconds(4.26)).toBe("4.3 s");
    expect(seconds(75)).toBe("75 s");
    expect(seconds(185)).toBe("3 min 5 s");
    expect(seconds(179.6)).toBe("3 min 0 s");
    expect(decimal(1210)).toBe("1,210.0");
    expect(list(["a"])).toBe("a");
    expect(list(["a", "b"])).toBe("a and b");
    expect(list(["a", "b", "c"])).toBe("a, b, and c");
  });
});
