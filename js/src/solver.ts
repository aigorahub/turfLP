// HiGHS through the npm package `highs` (WebAssembly). Mirrors solve_lp() in
// R/turf.R with the settings of docs/algorithm.md section 13.

import highsImport from "highs";
import type { Highs, InitOptions } from "highs";

type Loader = (options?: InitOptions) => Promise<Highs>;
// `highs` ships an ES module at run time, but TypeScript reads its types as
// CommonJS under NodeNext, so take the loader from either shape.
const highsLoader: Loader = ((highsImport as unknown as { default?: Loader }).default ??
  highsImport) as unknown as Loader;

export interface LoadOptions {
  locateFile?: (file: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer | Uint8Array;
}

let loading: Promise<Highs> | null = null;
let loadedOptions: LoadOptions | undefined;
let highs: Highs | null = null;

/**
 * Load the WebAssembly solver. Later calls reuse it; concurrent first calls
 * share one load; a failed load is not cached. Calling it again with other
 * options after a successful load throws.
 */
export async function loadSolver(options?: LoadOptions): Promise<void> {
  await getSolver(options);
}

export async function getSolver(options?: LoadOptions): Promise<Highs> {
  if (loading) {
    if (options !== undefined && !sameOptions(options, loadedOptions)) {
      throw new Error("turflp: the solver is already loaded with other options.");
    }
    return loading;
  }
  loadedOptions = options;
  const promise = highsLoader(options as InitOptions | undefined);
  loading = promise;
  try {
    highs = await promise;
    return highs;
  } catch (e) {
    if (loading === promise) {
      loading = null;
      loadedOptions = undefined;
    }
    throw e;
  }
}

function sameOptions(a: LoadOptions, b: LoadOptions | undefined): boolean {
  return a.locateFile === b?.locateFile && a.wasmBinary === b?.wasmBinary;
}

/** The loaded solver, for code that runs after getSolver(). */
export function loadedSolver(): Highs {
  if (!highs) throw new Error("turflp: the solver is not loaded.");
  return highs;
}

// Presolve is the one named difference from R. Tests switch it off to run the
// conformance suite a second time.
export const settings = { presolve: "on" as "on" | "off" };
// Options of the most recent solve, read back from HiGHS. Tests check them.
export const lastOptions: Record<string, unknown> = {};
const OPTION_NAMES = [
  "presolve", "mip_rel_gap", "mip_abs_gap", "primal_feasibility_tolerance",
  "mip_feasibility_tolerance", "time_limit",
] as const;

export type Row = { index: Int32Array; value: Float64Array; lower: number; upper: number };

/** Rows of a linear model. Adding a row copies only the list of extra rows. */
export class Model {
  constructor(
    readonly nVars: number,
    readonly base: { starts: Int32Array; indices: Int32Array; values: Float64Array;
                     lower: Float64Array; upper: Float64Array },
    readonly extra: readonly Row[] = [],
  ) {}

  addRow(index: ArrayLike<number>, value: ArrayLike<number>, lower: number, upper: number): Model {
    const row = { index: Int32Array.from(index), value: Float64Array.from(value), lower, upper };
    return new Model(this.nVars, this.base, [...this.extra, row]);
  }

  csr() {
    const b = this.base;
    if (this.extra.length === 0) return b;
    const nBase = b.lower.length;
    const nnzBase = b.starts[nBase];
    const nnz = nnzBase + this.extra.reduce((s, r) => s + r.index.length, 0);
    const starts = new Int32Array(nBase + this.extra.length + 1);
    starts.set(b.starts);
    const indices = new Int32Array(nnz);
    indices.set(b.indices);
    const values = new Float64Array(nnz);
    values.set(b.values);
    const lower = new Float64Array(nBase + this.extra.length);
    lower.set(b.lower);
    const upper = new Float64Array(nBase + this.extra.length);
    upper.set(b.upper);
    let pos = nnzBase;
    this.extra.forEach((r, k) => {
      indices.set(r.index, pos);
      values.set(r.value, pos);
      pos += r.index.length;
      starts[nBase + k + 1] = pos;
      lower[nBase + k] = r.lower;
      upper[nBase + k] = r.upper;
    });
    return { starts, indices, values, lower, upper };
  }
}

export type SolveResult = Float64Array | null | "time" | "invalid";

/**
 * Solve one stage. Returns the column values. With `soft`, an infeasible
 * model gives null, the time limit gives "time", and any other failure gives
 * "invalid"; without `soft`, all of these throw.
 */
export function solve(
  direction: "min" | "max", objective: Float64Array, model: Model, binary: Int32Array,
  stage: string, soft = false, timeLimit = Infinity,
): SolveResult {
  const h = loadedSolver();
  const n = model.nVars;
  const { starts, indices, values, lower, upper } = model.csr();
  const colUpper = new Float64Array(n).fill(h.infinity);
  const integrality = new Int32Array(n);
  for (const j of binary) {
    colUpper[j] = 1;
    integrality[j] = h.constants.variableType.integer;
  }
  const status = h.constants.modelStatus;
  const m = h.createModel();
  try {
    m.passModel({
      numCols: n,
      numRows: lower.length,
      sense: direction === "max" ? h.constants.objectiveSense.maximize
                                 : h.constants.objectiveSense.minimize,
      colCost: objective,
      colLower: new Float64Array(n),
      colUpper,
      rowLower: lower,
      rowUpper: upper,
      matrix: { format: "csr", numRows: lower.length, numCols: n, starts, indices, values },
      integrality: integrality as unknown as Int32Array,
    });
    // The WebAssembly build is single-threaded and rejects thread options.
    const options: Record<string, number | string | boolean> = {
      output_flag: false,
      presolve: settings.presolve,
      mip_rel_gap: 0,
      mip_abs_gap: 0,
      primal_feasibility_tolerance: 1e-9,
      mip_feasibility_tolerance: 1e-9,
    };
    if (Number.isFinite(timeLimit)) options.time_limit = timeLimit;
    m.options.set(options);
    const result = m.run().modelStatus;
    for (const name of OPTION_NAMES) lastOptions[name] = m.options.get(name);
    if (result === status.optimal) return Float64Array.from(m.getSolution().colValue);
    // No model here is unbounded, so "unbounded or infeasible" means infeasible.
    const infeasible = result === status.infeasible || result === status.unboundedOrInfeasible;
    if (soft) {
      if (infeasible) return null;
      if (result === status.timeLimit) return "time";
      return "invalid";
    }
    throw new Error(`HiGHS did not find a solution in the ${stage} stage (status ${result}).`);
  } finally {
    m.dispose();
  }
}

// Tests replace `hooks.solve` to reach the failure paths of docs/algorithm.md section 6.
export const hooks = { solve };
