// The worker protocol, run in Node.js with the same code the page uses.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { toReach } from "../src/csv.js";
import { exampleTable } from "../src/data.js";
import { handle, type Reply } from "../src/worker.js";

const require = createRequire(new URL("../../js/package.json", import.meta.url));
const wasm = new Uint8Array(readFileSync(require.resolve("highs/runtime")));

async function ask(msg: Parameters<typeof handle>[0], between?: () => Promise<boolean>): Promise<Reply[]> {
  const replies: Reply[] = [];
  await handle(msg, (r) => replies.push(r), between);
  return replies;
}

describe("worker", () => {
  const t = exampleTable("icecream");
  const matrix = { rows: t.rows, cols: t.cols, data: toReach(t, 8), names: t.names };

  it("loads the solver from bytes", async () => {
    const [r] = await ask({ type: "load", wasm });
    expect(r.type).toBe("ready");
  });

  it("finds the minimum cover", async () => {
    const [r] = await ask({ type: "cover", id: 1, matrix });
    expect(r).toMatchObject({ type: "cover", id: 1 });
    expect(r.type === "cover" && r.portfolio.size).toBe(9);
  });

  it("reports each size in order and then done", async () => {
    const replies = await ask({ type: "run", id: 2, matrix, sizes: [1, 2, 3], tiebreak: ["frequency", "penetration"] });
    expect(replies.map((r) => r.type)).toEqual(["start", "size", "start", "size", "start", "size", "done"]);
    const reach = replies.flatMap((r) => (r.type === "size" ? [r.portfolio.reach] : []));
    // 39.2%, 61.7%, and 72.5% of 120 (the same as the R package).
    expect(reach).toEqual([47, 74, 87]);
    const first = replies.find((r) => r.type === "size");
    expect(first && first.type === "size" && first.portfolio.names.length).toBe(1);
  });

  it("stops before the next size when asked", async () => {
    let calls = 0;
    const replies = await ask({ type: "run", id: 3, matrix, sizes: [1, 2, 3], tiebreak: [] },
                              async () => ++calls <= 1);
    expect(replies.map((r) => r.type)).toEqual(["start", "size"]);
  });

  it("returns errors as replies", async () => {
    const replies = await ask({ type: "run", id: 4, matrix, sizes: [99], tiebreak: [] });
    expect(replies.at(-1)).toMatchObject({ type: "error", id: 4 });
  });

  it("analyzes a portfolio: the simple choices, then each point, then the frontier", async () => {
    // The portfolio of a run: the frontier starts from it.
    const run = await ask({ type: "run", id: 51, matrix, sizes: [3], tiebreak: ["frequency"] });
    const products = run.flatMap((r) => (r.type === "size" ? [...r.portfolio.products] : []));
    const replies = await ask({ type: "analyze", id: 5, matrix, products, tiebreak: ["frequency"], optimal: true });
    const types = replies.map((r) => r.type);
    expect(types[0]).toBe("baselines");
    expect(types.at(-1)).toBe("frontier");
    expect(types.slice(1, -1).every((x) => x === "point")).toBe(true);
    const base = replies[0].type === "baselines" ? replies[0] : null;
    expect(base?.stop).toBe("complete");
    expect(base?.greedy.products.length).toBe(3);
    const fr = replies.at(-1)!;
    expect(fr.type === "frontier" && fr.points.length).toBe(types.length - 2);
    // The last point is the most popular portfolio.
    expect(fr.type === "frontier" && fr.stop === "complete" && fr.points.at(-1)).toEqual(base?.mostPopular);
  });

  it("stops an analysis when asked", async () => {
    const replies = await ask({ type: "analyze", id: 6, matrix, products: [0, 4, 7], tiebreak: ["frequency"] },
                              async () => false);
    expect(replies).toEqual([expect.objectContaining({ type: "baselines", id: 6, stop: "cancelled" })]);
  });

  it("passes the fixed products to the run, the cover, and the analysis", async () => {
    const fixed = [6, 8];
    const run = await ask({ type: "run", id: 7, matrix, sizes: [2, 3], tiebreak: ["frequency"], fixed });
    const ps = run.flatMap((r) => (r.type === "size" ? [r.portfolio] : []));
    expect(ps.map((p) => p.fixed)).toEqual([fixed, fixed]);
    for (const p of ps) expect(fixed.every((j) => p.products.includes(j))).toBe(true);
    const [c] = await ask({ type: "cover", id: 8, matrix, fixed });
    expect(c.type === "cover" && c.portfolio.fixed).toEqual(fixed);
    const an = await ask({ type: "analyze", id: 9, matrix, products: [...ps[1].products], tiebreak: ["frequency"], fixed });
    const fr = an.at(-1)!;
    expect(fr.type === "frontier" && fr.stop).toBe("complete");
    if (fr.type === "frontier") for (const q of fr.points) expect(fixed.every((j) => q.products.includes(j))).toBe(true);
  });

  it("ignores a cancel for no analysis", async () => {
    expect(await ask({ type: "cancel", id: 99 })).toEqual([]);
  });
});
