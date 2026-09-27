// The turfLP algorithm. Mirrors R/turf.R; docs/algorithm.md is the spec.
// Section numbers in comments refer to docs/algorithm.md.

import { asReach, checkLimits, checkSize, checkTiebreak, type Criterion, type Reach, type ReachMatrix } from "./input.js";
import * as solver from "./solver.js";

const EPS = 2 ** -52;
const MAX_SOLVES = 100;

export interface TurfOptions {
  /** Tie-break criteria after reach, in order. Default ["frequency", "penetration"]. */
  tiebreak?: readonly Criterion[] | null;
  /** Product names, one per column. Default P1, P2, .... */
  names?: readonly string[];
  /** Pool limit of the penetration stage. Default 1000. */
  maxPool?: number;
  /** Seconds for the penetration pool, and again for a later frequency fallback. Default 30. */
  maxPoolSeconds?: number;
}

export interface Portfolio {
  /** 0-based column indices of the selected products, ascending. */
  readonly products: readonly number[];
  readonly names: readonly string[];
  readonly size: number;
  readonly reach: number;
  readonly reachProp: number;
  readonly frequency: number;
  readonly penetration: number;
  readonly respondents: number;
  /** Warnings of docs/algorithm.md section 10, in order. */
  readonly warnings: readonly string[];
}

// Section 5: the comparison rule.
export function tolerance(value: number, size: number): number {
  return 16 * size * EPS * Math.max(1, Math.abs(value));
}

export interface Objective<S> {
  name: string;
  direction: "min" | "max";
  value: (sel: S) => number;
}

function signedValue<S>(obj: Objective<S>, sel: S): number {
  return (obj.direction === "min" ? 1 : -1) * obj.value(sel);
}

export function worseOnEarlier<S>(objectives: readonly Objective<S>[], selected: S, previous: S,
                                  size: number): boolean {
  for (const obj of objectives) {
    const next = signedValue(obj, selected);
    const old = signedValue(obj, previous);
    if (next > old + tolerance(old, size)) return true;
    if (next < old - tolerance(old, size)) return false;
  }
  return false;
}

export function bestOf<S>(pool: readonly S[], objectives: readonly Objective<S>[], size: number): S {
  let keep = pool.map((_, i) => i);
  for (const obj of objectives) {
    const v = keep.map((i) => signedValue(obj, pool[i]));
    const lo = Math.min(...v);
    keep = keep.filter((_, k) => v[k] <= lo + tolerance(lo, size));
  }
  return pool[keep[0]];
}

/** Sum with Neumaier compensation, so the result does not depend much on order. */
function fsum(xs: Iterable<number>): number {
  let sum = 0;
  let c = 0;
  for (const x of xs) {
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? (sum - t) + x : (x - t) + sum;
    sum = t;
  }
  return sum + c;
}

/**
 * C's %g with precision 6, as R's sprintf("%g") and Python's "%g" format the
 * budget: 6 significant digits, round half to even, trailing zeros removed,
 * exponent form when the exponent is below -4 or at least 6.
 */
export function formatG(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Inf" : "-Inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const sign = x < 0 ? "-" : "";
  // Exact enough decimal digits of |x|: 100 significant digits.
  const [mant, expText] = Math.abs(x).toExponential(99).split("e");
  const digits = mant.replace(".", "");
  let exp = Number(expText);
  let head = digits.slice(0, 6);
  const rest = digits.slice(6);
  const tie = /^50*$/.test(rest);
  const up = rest[0] > "5" || (rest[0] === "5" && (!tie || Number(head[5]) % 2 === 1));
  if (up) {
    head = String(Number(head) + 1);
    if (head.length > 6) { head = head.slice(0, 6); exp += 1; }
  }
  if (exp < -4 || exp >= 6) {
    const m = stripZeros(head[0] + "." + head.slice(1));
    const e = Math.abs(exp) < 10 ? `0${Math.abs(exp)}` : String(Math.abs(exp));
    return `${sign}${m}e${exp < 0 ? "-" : "+"}${e}`;
  }
  let s: string;
  if (exp >= 0) {
    s = head.slice(0, exp + 1) + "." + head.slice(exp + 1);
  } else {
    s = "0." + "0".repeat(-exp - 1) + head;
  }
  return sign + stripZeros(s);
}

/** Remove trailing zeros after a decimal point, then a trailing point. */
function stripZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function formatSeconds(x: number): string {
  return formatG(x);
}

function columnSums(r: Reach): Int32Array {
  const s = new Int32Array(r.cols);
  for (let i = 0; i < r.rows; i++) {
    const off = i * r.cols;
    for (let j = 0; j < r.cols; j++) s[j] += r.data[off + j];
  }
  return s;
}

function portfolio(r: Reach, products: number[], warnings: string[]): Portfolio {
  products = [...products].sort((a, b) => a - b);
  const sums = columnSums(r);
  let reached = 0;
  for (let i = 0; i < r.rows; i++) {
    const off = i * r.cols;
    if (products.some((j) => r.data[off + j] === 1)) reached++;
  }
  const k = products.length;
  return {
    products,
    names: products.map((j) => r.names[j]),
    size: k,
    reach: reached,
    reachProp: reached / r.rows,
    frequency: products.reduce((s, j) => s + sums[j], 0),
    penetration: k / fsum(products.map((j) => 1 / sums[j])),
    respondents: r.rows,
    warnings,
  };
}

type Sel = Uint8Array; // 0/1 over the candidates

/**
 * Find the portfolio of `size` products with maximum reach. Ties on reach
 * are broken by `options.tiebreak`, in order. Warnings are returned in
 * `warnings`. The solve itself blocks the JavaScript thread.
 */
export async function turf(reach: ReachMatrix, size: number, options: TurfOptions = {}): Promise<Portfolio> {
  const r = asReach(reach, options.names);
  const tiebreak = checkTiebreak(options.tiebreak);
  checkLimits(options.maxPool ?? 1000, options.maxPoolSeconds ?? 30);
  await solver.getSolver();
  return turfSync(r, size, tiebreak, options.maxPool ?? 1000, options.maxPoolSeconds ?? 30);
}

function turfSync(r: Reach, size: number, tiebreak: Criterion[], maxPool: number,
                  maxPoolSeconds: number): Portfolio {
  const warnings: string[] = [];
  // Section 2: reduction.
  const prodReach = columnSums(r);
  const cand: number[] = [];
  for (let j = 0; j < r.cols; j++) if (prodReach[j] > 0) cand.push(j);
  size = checkSize(size, cand.length);
  const rowsKept: number[] = [];
  for (let i = 0; i < r.rows; i++) {
    if (cand.some((j) => r.data[i * r.cols + j] === 1)) rowsKept.push(i);
  }
  const n = rowsKept.length;
  const m = cand.length;
  // a[i][k] for model respondent i and candidate k, as column bit lists.
  const colRows: number[][] = cand.map(() => []);
  rowsKept.forEach((i, ii) => {
    cand.forEach((j, k) => { if (r.data[i * r.cols + j] === 1) colRows[k].push(ii); });
  });
  const xVars = Int32Array.from({ length: m }, (_, k) => n + k);
  const nVars = n + m + 1;
  const candReach = Float64Array.from(cand, (j) => prodReach[j]);
  const maxR = Math.max(...candReach);
  const penCoef = Float64Array.from(candReach, (x) => maxR / x);

  // Section 3: the model. Respondent row i: z_i + sum_k a_ik x_k >= 1.
  const rowEntries: number[][] = Array.from({ length: n }, (_, i) => [i]);
  colRows.forEach((rows, k) => { for (const i of rows) rowEntries[i].push(n + k); });
  const starts = new Int32Array(n + 3);
  const idx: number[] = [];
  const val: number[] = [];
  rowEntries.forEach((e, i) => {
    idx.push(...e);
    for (let t = 0; t < e.length; t++) val.push(1);
    starts[i + 1] = idx.length;
  });
  for (let k = 0; k < m; k++) { idx.push(n + k); val.push(1); }
  starts[n + 1] = idx.length;
  for (let k = 0; k < m; k++) { idx.push(n + k); val.push(-penCoef[k]); }
  idx.push(nVars - 1); val.push(1);
  starts[n + 2] = idx.length;
  const lower = new Float64Array(n + 2);
  const upper = new Float64Array(n + 2);
  lower.fill(1, 0, n); upper.fill(Infinity, 0, n);
  lower[n] = size; upper[n] = size;
  let model = new solver.Model(nVars, {
    starts, indices: Int32Array.from(idx), values: Float64Array.from(val), lower, upper,
  });

  // Symmetry rows for identical products.
  const lastSeen = new Map<string, number>();
  colRows.forEach((rows, k) => {
    const key = rows.join(",");
    const prev = lastSeen.get(key);
    if (prev !== undefined) model = model.addRow([n + prev, n + k], [1, -1], 0, Infinity);
    lastSeen.set(key, k);
  });

  // Section 4: criteria. `sel` is 0/1 over the candidates.
  const reachValue = (sel: Sel) => {
    const hit = new Uint8Array(n);
    sel.forEach((s, k) => { if (s) for (const i of colRows[k]) hit[i] = 1; });
    return n - hit.reduce((a, b) => a + b, 0);
  };
  type Obj = Objective<Sel> & { coef: Float64Array; row: [Int32Array, Float64Array] };
  const zCoef = new Float64Array(nVars); zCoef.fill(1, 0, n);
  const fCoef = new Float64Array(nVars); fCoef.set(candReach, n);
  const pCoef = new Float64Array(nVars); pCoef[nVars - 1] = 1;
  const objectives: Record<"reach" | Criterion, Obj> = {
    reach: { name: "reach", direction: "min", coef: zCoef,
             row: [Int32Array.from({ length: n }, (_, i) => i), new Float64Array(n).fill(1)],
             value: reachValue },
    frequency: { name: "frequency", direction: "max", coef: fCoef, row: [xVars, candReach],
                 value: (sel) => sel.reduce((s, v, k) => s + (v ? candReach[k] : 0), 0) },
    penetration: { name: "penetration", direction: "min", coef: pCoef,
                   row: [Int32Array.of(nVars - 1), Float64Array.of(1)],
                   value: (sel) => fsum(Array.from(sel, (v, k) => (v ? penCoef[k] : 0))) },
  };

  const addBound = (mod: solver.Model, obj: Obj, rhs: number) =>
    obj.direction === "min" ? mod.addRow(obj.row[0], obj.row[1], -Infinity, rhs)
                            : mod.addRow(obj.row[0], obj.row[1], rhs, Infinity);
  const exclude = (mod: solver.Model, sel: Sel) => {
    const ix: number[] = [];
    sel.forEach((v, k) => { if (v) ix.push(n + k); });
    return mod.addRow(ix, new Float64Array(ix.length).fill(1), -Infinity, size - 1);
  };

  type Status = "ok" | "none" | "time" | "invalid" | "limit";
  // Section 6: one stage with checks.
  const nextValid = (mod: solver.Model, obj: Obj, earlier: Obj[], previous: Sel | null,
                     deadline = Infinity): { status: Status; sel?: Sel; model: solver.Model } => {
    for (let t = 0; t < MAX_SOLVES; t++) {
      const remaining = deadline - performance.now() / 1000;
      if (remaining <= 0) return { status: "time", model: mod };
      const sol = solver.hooks.solve(obj.direction, obj.coef, mod, xVars, obj.name, previous !== null,
                               remaining);
      if (sol === null) return { status: "none", model: mod };
      if (sol === "time") return { status: "time", model: mod };
      const invalid = () => {
        if (previous === null) {
          throw new Error(`HiGHS returned an invalid solution in the ${obj.name} stage.`);
        }
        return { status: "invalid" as Status, model: mod };
      };
      if (sol === "invalid") return invalid();
      const sel = new Uint8Array(m);
      let count = 0;
      let bad = false;
      for (let k = 0; k < m; k++) {
        const x = sol[n + k];
        if (Number.isNaN(x)) bad = true;
        if (x > 0.5) { sel[k] = 1; count++; }
        if (Math.abs(x - sel[k]) > 1e-6) bad = true;
      }
      if (bad || count !== size) return invalid();
      if (previous === null || !worseOnEarlier(earlier, sel, previous, size)) {
        return { status: "ok", sel, model: mod };
      }
      mod = exclude(mod, sel);
    }
    return { status: "limit", model: mod };
  };

  const reason = (status: string) => ({
    limit: `${MAX_SOLVES} solves`,
    time: `time limit of ${formatSeconds(maxPoolSeconds)} seconds`,
    invalid: "HiGHS returned an invalid solution",
    none: "HiGHS found no valid portfolio",
    full: `more than ${maxPool} portfolios are within the solver tolerance`,
  } as Record<string, string>)[status];
  const unfinished = (stage: string, status: string, earlierExact = true) => {
    const middle = earlierExact ? "the earlier criteria but"
                                : "penetration only to within the solver tolerance and";
    warnings.push(`The ${stage} stage did not finish (${reason(status)}). The portfolio is ` +
                  `optimal on ${middle} may not be optimal on ${stage}.`);
  };

  // Section 7: the stage loop.
  const stages: ("reach" | Criterion)[] = ["reach", ...tiebreak];
  let previous: Sel | null = null;
  let selected: Sel | null = null;
  for (let s = 0; s < stages.length; s++) {
    const obj = objectives[stages[s]];
    const earlier = stages.slice(0, s).map((t) => objectives[t]);
    const res = nextValid(model, obj, earlier, previous);
    if (res.status !== "ok") {
      unfinished(stages[s], res.status);
      break;
    }
    model = res.model;
    selected = res.sel!;

    if (stages[s] === "penetration") {
      // Section 8: the penetration stage.
      const withoutPool = model;
      const bound = obj.value(selected);
      const pool: Sel[] = [selected];
      let last = selected;
      model = addBound(model, obj, bound);
      let poolStatus = "full";
      const deadline = performance.now() / 1000 + maxPoolSeconds;
      for (let i = 0; i < maxPool; i++) {
        model = exclude(model, last);
        const r2 = nextValid(model, obj, earlier, previous, deadline);
        model = r2.model;
        if (r2.status !== "ok") {
          poolStatus = r2.status === "none" ? "complete" : r2.status;
          break;
        }
        last = r2.sel!;
        // Skip products that meet the bound only within the solver tolerance.
        if (obj.value(last) <= bound + tolerance(bound, size)) pool.push(last);
      }

      if (poolStatus === "complete") {
        selected = bestOf(pool, stages.slice(s).map((t) => objectives[t]), size);
      } else {
        warnings.push(`The search for the penetration optimum stopped (${reason(poolStatus)}). ` +
                      "The penetration is optimal only to within the solver tolerance (about 1e-9).");
        selected = bestOf(pool, [obj], size);
        if (s + 1 < stages.length) {
          const later = objectives[stages[s + 1]];
          const r3 = nextValid(addBound(withoutPool, obj, obj.value(selected)), later,
                               stages.slice(0, s + 1).map((t) => objectives[t]), selected,
                               performance.now() / 1000 + maxPoolSeconds);
          if (r3.status === "ok") selected = r3.sel!;
          else unfinished(stages[s + 1], r3.status, false);
        }
      }
      break;
    }

    previous = selected;
    if (s + 1 < stages.length) {
      // Fix this criterion at the value the selected products give.
      model = addBound(model, obj, obj.value(selected));
    }
  }

  const products: number[] = [];
  selected!.forEach((v, k) => { if (v) products.push(cand[k]); });
  return portfolio(r, products, warnings);
}

/** Find the smallest portfolio that reaches every reachable respondent. */
export async function turfMinCover(reach: ReachMatrix,
                                   options: { names?: readonly string[] } = {}): Promise<Portfolio> {
  const r = asReach(reach, options.names);
  await solver.getSolver();
  return minCoverSync(r);
}

function minCoverSync(r: Reach): Portfolio {
  const sums = columnSums(r);
  const cand: number[] = [];
  for (let j = 0; j < r.cols; j++) if (sums[j] > 0) cand.push(j);
  if (cand.length === 0) throw new RangeError("No product reaches any respondent.");
  const rowsKept: number[] = [];
  for (let i = 0; i < r.rows; i++) {
    if (cand.some((j) => r.data[i * r.cols + j] === 1)) rowsKept.push(i);
  }
  const n = rowsKept.length;
  const m = cand.length;
  const starts = new Int32Array(n + 1);
  const idx: number[] = [];
  rowsKept.forEach((i, ii) => {
    cand.forEach((j, k) => { if (r.data[i * r.cols + j] === 1) idx.push(k); });
    starts[ii + 1] = idx.length;
  });
  const model = new solver.Model(m, {
    starts, indices: Int32Array.from(idx), values: new Float64Array(idx.length).fill(1),
    lower: new Float64Array(n).fill(1), upper: new Float64Array(n).fill(Infinity),
  });
  const sol = solver.solve("min", new Float64Array(m).fill(1), model,
                           Int32Array.from({ length: m }, (_, k) => k), "set cover") as Float64Array;
  const products = cand.filter((_, k) => sol[k] > 0.5);
  // Section 11: check the cover (the R package does not).
  const covered = rowsKept.every((i) => products.some((j) => r.data[i * r.cols + j] === 1));
  const integral = Array.from(sol).every((x) => Math.abs(x - (x > 0.5 ? 1 : 0)) <= 1e-6);
  if (!covered || !integral) {
    throw new Error("HiGHS returned an invalid solution in the set cover stage.");
  }
  return portfolio(r, products, []);
}

/**
 * Solve `turf` for each size. The default sizes are 1 to the size of the
 * minimum cover.
 */
export async function turfSizes(reach: ReachMatrix, sizes?: readonly number[] | null,
                                options: TurfOptions = {}): Promise<Portfolio[]> {
  const r = asReach(reach, options.names);
  const tiebreak = checkTiebreak(options.tiebreak);
  checkLimits(options.maxPool ?? 1000, options.maxPoolSeconds ?? 30);
  await solver.getSolver();
  const list = sizes ?? Array.from({ length: minCoverSync(r).size }, (_, i) => i + 1);
  return list.map((k) => turfSync(r, k, tiebreak, options.maxPool ?? 1000,
                                  options.maxPoolSeconds ?? 30));
}
