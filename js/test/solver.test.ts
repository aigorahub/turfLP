// Solver settings, loading, disposal, and the failure paths of docs/algorithm.md section 6.
import highsImport from "highs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSolver, turf, turfMinCover } from "../src/index.js";
import * as solver from "../src/solver.js";
import { TIE } from "./helpers.js";

const realSolve = solver.hooks.solve;
afterEach(() => { solver.hooks.solve = realSolve; solver.settings.presolve = "on"; });

/** Replace the solver after the first (reach) solve with scripted answers. */
function script(fn: (model: solver.Model, binary: Int32Array) => solver.SolveResult) {
  const calls = { n: 0 };
  solver.hooks.solve = (dir, obj, model, binary, stage, soft, time) => {
    calls.n++;
    if (calls.n === 1) return realSolve(dir, obj, model, binary, stage, soft, time);
    return fn(model, binary);
  };
  return calls;
}

describe("settings", () => {
  it.each(["on", "off"] as const)("every solve uses the documented settings (presolve %s)", async (presolve) => {
    solver.settings.presolve = presolve;
    const seen: Record<string, unknown>[] = [];
    solver.hooks.solve = (...args) => {
      const out = realSolve(...args);
      seen.push({ ...solver.lastOptions });
      return out;
    };
    await turf(TIE, 2, { tiebreak: ["penetration", "frequency"] });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const o of seen) {
      expect(o).toMatchObject({ presolve, mip_rel_gap: 0, mip_abs_gap: 0,
                                primal_feasibility_tolerance: 1e-9, mip_feasibility_tolerance: 1e-9 });
    }
  });

  it("reports the HiGHS version", async () => {
    await loadSolver();
    const v = solver.loadedSolver().version;
    console.log(`highs npm package ${JSON.stringify(v)}`);
    expect(v.major * 100 + v.minor).toBeGreaterThanOrEqual(115);
  });
});

describe("failure paths", () => {
  const text = (reason: string) =>
    `The frequency stage did not finish (${reason}). The portfolio is optimal on the earlier criteria but may not be optimal on frequency.`;

  it("timeout", async () => {
    script(() => "time");
    const p = await turf(TIE, 2, { tiebreak: ["frequency"] });
    expect(p.reach).toBe(7);
    expect(p.warnings).toEqual([text("time limit of 30 seconds")]);
  });

  it("infeasible", async () => {
    script(() => null);
    const p = await turf(TIE, 2, { tiebreak: ["frequency"] });
    expect(p.warnings).toEqual([text("HiGHS found no valid portfolio")]);
  });

  it("invalid vector", async () => {
    script((model, binary) => {
      const x = new Float64Array(model.nVars);
      for (const j of binary.slice(0, 3)) x[j] = 1;
      return x;
    });
    const p = await turf(TIE, 2, { tiebreak: ["frequency"] });
    expect(p.reach).toBe(7);
    expect(p.warnings).toEqual([text("HiGHS returned an invalid solution")]);
  });

  it("an invalid first stage is an error", async () => {
    solver.hooks.solve = () => { throw new Error("HiGHS did not find a solution"); };
    await expect(turf(TIE, 2)).rejects.toThrow(/HiGHS/);
  });

  it("retry limit", async () => {
    // Products 1 and 4 (0-based 0 and 3) reach only 4 respondents.
    const calls = script((model, binary) => {
      const x = new Float64Array(model.nVars);
      x[binary[0]] = 1; x[binary[3]] = 1;
      return x;
    });
    const p = await turf(TIE, 2, { tiebreak: ["frequency"] });
    expect(p.reach).toBe(7);
    expect(calls.n).toBe(101);
    expect(p.warnings).toEqual([text("100 solves")]);
  });
});

describe("loading and reuse", () => {
  it("concurrent calls give independent correct results", async () => {
    const results = await Promise.all([
      turf(TIE, 2), turf(TIE, 2, { tiebreak: [] }), turfMinCover(TIE), turf(TIE, 3),
    ]);
    expect(results[0].products).toEqual([1, 2]);
    expect(results[1].reach).toBe(7);
    expect(results[2].reach).toBe(8);
    expect(results[3].reach).toBe(8);
  });

  it("every model is disposed", async () => {
    const h = solver.loadedSolver();
    const create = h.createModel.bind(h);
    let created = 0;
    const models: { disposed: boolean }[] = [];
    const spy = vi.spyOn(h, "createModel").mockImplementation((...a: any[]) => {
      created++;
      const m = create(...(a as [])) as any;
      models.push(m);
      return m;
    });
    await turf(TIE, 2, { tiebreak: ["penetration", "frequency"] });
    await turfMinCover(TIE);
    spy.mockRestore();
    expect(created).toBeGreaterThan(3);
    expect(models.every((m) => m.disposed)).toBe(true);
  });

  it("loading again with other options throws", async () => {
    await loadSolver();
    await expect(loadSolver({ locateFile: (f) => f })).rejects.toThrow(/already loaded/);
  });

  it("the highs package exports a loader", () => {
    const loader = (highsImport as any).default ?? highsImport;
    expect(typeof loader).toBe("function");
  });
});
