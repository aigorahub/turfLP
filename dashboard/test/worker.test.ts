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
});
