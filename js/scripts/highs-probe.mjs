// Checks, by calls, the parts of the pinned highs runtime that model reuse
// needs (docs/plans/bip-speed.md, B1-A3): rows added, changed, and deleted,
// objective changes, option and clock resets, and a MIP start. Each step on
// one reused model must match a fresh model of the same logical state.
//
//   node scripts/highs-probe.mjs

import highsLoader from "highs";

const h = await highsLoader();
const version = JSON.parse(await (await import("node:fs/promises"))
  .readFile(new URL("../node_modules/highs/package.json", import.meta.url), "utf8")).version;

const n = 6;
const value = Float64Array.of(5, 4, 3, 7, 2, 6);
const weight = Float64Array.of(3, 2, 2, 4, 1, 3);
const base = () => ({
  numCols: n, numRows: 1, sense: h.constants.objectiveSense.maximize, colCost: value,
  colLower: new Float64Array(n), colUpper: new Float64Array(n).fill(1),
  rowLower: Float64Array.of(-h.infinity), rowUpper: Float64Array.of(8),
  matrix: { format: "csr", numRows: 1, numCols: n, starts: Int32Array.of(0, n),
            indices: Int32Array.from({ length: n }, (_, j) => j), values: weight },
  integrality: new Int32Array(n).fill(h.constants.variableType.integer),
});
const OPTIONS = { output_flag: false, mip_rel_gap: 0, mip_abs_gap: 0 };

// A fresh model with extra rows [lower, upper, indices, values] and an objective.
function fresh(rows, cost = value, sense = h.constants.objectiveSense.maximize) {
  const b = base();
  const m = h.createModel();
  try {
    const starts = [0, n];
    const idx = [...b.matrix.indices];
    const val = [...b.matrix.values];
    const lo = [...b.rowLower];
    const up = [...b.rowUpper];
    for (const [l, u, ix, vx] of rows) { idx.push(...ix); val.push(...vx); starts.push(idx.length); lo.push(l); up.push(u); }
    m.passModel({ ...b, sense, colCost: cost, numRows: lo.length, rowLower: Float64Array.from(lo),
                  rowUpper: Float64Array.from(up),
                  matrix: { format: "csr", numRows: lo.length, numCols: n, starts: Int32Array.from(starts),
                            indices: Int32Array.from(idx), values: Float64Array.from(val) } });
    m.options.set(OPTIONS);
    m.run();
    return [m.getModelStatus(), m.getObjectiveValue()];
  } finally {
    m.dispose();
  }
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const same = (a, b) => a[0] === b[0] && Math.abs(a[1] - b[1]) < 1e-9;

const m = h.createModel();
try {
  m.passModel(base());
  m.options.set(OPTIONS);
  m.run();
  const s0 = [m.getModelStatus(), m.getObjectiveValue()];
  check("base solve", same(s0, fresh([])), JSON.stringify(s0));

  // A no-good cut on the optimum, as the pool adds them.
  const x = m.getSolution().colValue;
  const sel = [...x.keys()].filter((j) => x[j] > 0.5);
  const cut = [-h.infinity, sel.length - 1, sel, sel.map(() => 1)];
  m.addRow(cut[0], cut[1], { indices: Int32Array.from(cut[2]), values: Float64Array.from(cut[3]) });
  m.run();
  const s1 = [m.getModelStatus(), m.getObjectiveValue()];
  check("addRow then run", same(s1, fresh([cut])), JSON.stringify(s1));

  // A stage bound row, then its bound changed.
  const bound = [s1[1] - 3, h.infinity, [...Array(n).keys()], [...value]];
  m.addRow(bound[0], bound[1], { indices: Int32Array.from(bound[2]), values: Float64Array.from(bound[3]) });
  m.changeColsCost({ kind: "range", from: 0, to: n - 1 }, weight);
  m.changeObjectiveSense(h.constants.objectiveSense.minimize);
  m.run();
  const s2 = [m.getModelStatus(), m.getObjectiveValue()];
  check("objective and sense change", same(s2, fresh([cut, bound], weight, h.constants.objectiveSense.minimize)),
        JSON.stringify(s2));
  m.changeRowBounds(2, s1[1], h.infinity);
  m.run();
  const s3 = [m.getModelStatus(), m.getObjectiveValue()];
  check("changeRowBounds", same(s3, fresh([cut, [s1[1], h.infinity, bound[2], bound[3]]], weight,
                                          h.constants.objectiveSense.minimize)), JSON.stringify(s3));

  // Back to the state without the pool rows, as the penetration fallback needs.
  m.deleteRows({ kind: "set", indices: Int32Array.of(1, 2) });
  m.changeColsCost({ kind: "range", from: 0, to: n - 1 }, value);
  m.changeObjectiveSense(h.constants.objectiveSense.maximize);
  m.run();
  const s4 = [m.getModelStatus(), m.getObjectiveValue()];
  check("deleteRows restores the base", same(s4, s0), JSON.stringify(s4));

  // time_limit: a finite value, then back to unlimited. Omitting it keeps the old
  // value, and set() rejects infinity, so a reused model needs reset() and then
  // every option again.
  m.options.set({ time_limit: 0.5 });
  const finite = m.options.get("time_limit");
  let rejected = false;
  try { m.options.set({ time_limit: h.infinity }); } catch { rejected = true; }
  m.options.reset();
  m.options.set(OPTIONS);
  const unlimited = m.options.get("time_limit");
  check("time_limit: set(infinity) throws, reset() restores unlimited",
        finite === 0.5 && rejected && unlimited === h.infinity && m.options.get("mip_rel_gap") === 0,
        `${finite}, rejected ${rejected}, then ${unlimited}`);

  // Clocks: run time accumulates across runs until zeroAllClocks().
  m.run();
  m.run();
  const before = m.getRunTime();
  m.zeroAllClocks();
  const after = m.getRunTime();
  check("zeroAllClocks resets the run time", before > 0 && after === 0, `${before} then ${after}`);

  // A MIP start: a feasible point, then the solver still proves the optimum.
  m.clearSolver();
  const start = new Float64Array(n);
  start[4] = 1;
  m.setSolution({ colValue: start });
  m.run();
  const s5 = [m.getModelStatus(), m.getObjectiveValue()];
  check("setSolution as a MIP start", same(s5, s0), JSON.stringify(s5));
  // An infeasible start must not be taken as a solution.
  m.clearSolver();
  m.setSolution({ colValue: new Float64Array(n).fill(1) });
  m.run();
  const s6 = [m.getModelStatus(), m.getObjectiveValue()];
  check("an infeasible start is ignored", same(s6, s0), JSON.stringify(s6));
} finally {
  m.dispose();
}

// An empty row is a constant 0: a bound that 0 meets keeps the optimum, one
// that 0 misses makes the model infeasible (the reduced model's reach bound
// when no coverage row is left).
{
  const e = h.createModel();
  try {
    e.passModel(base());
    e.options.set(OPTIONS);
    e.addRow(-h.infinity, 0, { indices: new Int32Array(0), values: new Float64Array(0) });
    e.run();
    const held = [e.getModelStatus(), e.getObjectiveValue()];
    e.addRow(1, h.infinity, { indices: new Int32Array(0), values: new Float64Array(0) });
    e.run();
    check("empty row: a true bound keeps the optimum, a false one is infeasible",
          same(held, fresh([])) && e.getModelStatus() === h.constants.modelStatus.infeasible,
          `${JSON.stringify(held)}, then status ${e.getModelStatus()}`);
  } finally {
    e.dispose();
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`highs ${version}: ${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
