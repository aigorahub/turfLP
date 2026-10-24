// The turfLP algorithm. Mirrors R/turf.R; docs/algorithm.md is the spec.
// Section numbers in comments refer to docs/algorithm.md.

import { asReach, checkFixed, checkFixedReach, checkLimits, checkSize, checkTiebreak, type Criterion, type Reach,
         type ReachMatrix } from "./input.js";
import * as bits from "./bitset.js";
import { groupRows, prepare, uncovered, type Prepared } from "./prepare.js";
import * as solver from "./solver.js";

const EPS = 2 ** -52;
const MAX_SOLVES = 100;

export interface TurfOptions {
  /** Tie-break criteria after reach, in order. Default ["frequency", "penetration"]. */
  tiebreak?: readonly Criterion[] | null;
  /** Product names, one per column. Default P1, P2, .... */
  names?: readonly string[];
  /** 0-based column indices of products that the portfolio must contain. `size` counts them. */
  fixed?: readonly number[] | null;
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
  /** 0-based column indices of the fixed products, ascending. */
  readonly fixed: readonly number[];
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

/** Section 9: the result, computed on the original data. */
function portfolio(p: Prepared, products: number[], warnings: string[], fixed: readonly number[] = []): Portfolio {
  const r = p.r;
  products = [...products].sort((a, b) => a - b);
  const sums = p.colReach;
  const union = new Uint32Array(p.reachable.length);
  for (const j of products) bits.orInto(union, p.sets[p.cand.indexOf(j)]);
  const reached = bits.count(union);
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
    fixed: [...fixed],
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
  const r = timed("validate", () => asReach(reach, options.names));
  const tiebreak = checkTiebreak(options.tiebreak);
  checkLimits(options.maxPool ?? 1000, options.maxPoolSeconds ?? 30);
  await solver.getSolver();
  return turfSync(timed("pack", () => prepare(r)), size, tiebreak, options.fixed, options.maxPool ?? 1000, options.maxPoolSeconds ?? 30);
}

// Time one phase for solver.trace, when a benchmark has set its sink.
function timed<T>(phase: string, f: () => T): T {
  const sink = solver.trace.sink;
  if (!sink) return f();
  const t = performance.now();
  const out = f();
  sink({ phase, ms: performance.now() - t });
  return out;
}

function turfSync(p: Prepared, size: number, tiebreak: Criterion[], fixedIn: unknown, maxPool: number,
                  maxPoolSeconds: number): Portfolio {
  const sink = solver.trace.sink;
  const t0 = sink ? performance.now() : 0;
  const warnings: string[] = [];
  const r = p.r;
  // Section 2: reduction.
  const prodReach = p.colReach;
  const cand = p.cand;
  size = checkSize(size, cand.length);
  const fixed = checkFixedReach(checkFixed(fixedIn, r.cols), prodReach, r.names);
  if (size < fixed.length) {
    throw new RangeError(`\`size\` is ${size}, but ${fixed.length} products are fixed.`);
  }
  const m = cand.length;
  // Candidate positions of the fixed products: they must be selected.
  const fixPos = fixed.map((j) => cand.indexOf(j));
  // Coverage rows (section 3): one per group of respondents, with its weight.
  const groups = groupRows(p, fixPos, solver.settings.reduce === "on", solver.settings.groupRatio);
  const n = groups.weight.length;
  const xVars = Int32Array.from({ length: m }, (_, k) => n + k);
  const nVars = n + m + 1;
  const candReach = Float64Array.from(cand, (j) => prodReach[j]);
  const maxR = Math.max(...candReach);
  const penCoef = Float64Array.from(candReach, (x) => maxR / x);

  // Section 3: the model. Group row g: z_g + sum_k a_gk x_k >= 1.
  const starts = new Int32Array(n + 3);
  const idx: number[] = [];
  const val: number[] = [];
  for (let g = 0; g < n; g++) {
    idx.push(g);
    val.push(1);
    for (let t = groups.start[g]; t < groups.start[g + 1]; t++) { idx.push(n + groups.index[t]); val.push(1); }
    starts[g + 1] = idx.length;
  }
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

  if (fixPos.length) {
    model = model.addRow(fixPos.map((k) => n + k), new Float64Array(fixPos.length).fill(1),
                         fixPos.length, fixPos.length);
  }

  // Symmetry rows for identical free products, by their columns over the full
  // input. A fixed product takes no part, or the row would force its twins
  // into the portfolio, so each free product pairs with its latest earlier
  // free twin.
  const isFixed = new Uint8Array(m);
  for (const k of fixPos) isFixed[k] = 1;
  for (let k = 0; k < m; k++) {
    if (isFixed[k]) continue;
    let prev = p.twinOf[k];
    while (prev >= 0 && isFixed[prev]) prev = p.twinOf[prev];
    if (prev >= 0) model = model.addRow([n + prev, n + k], [1, -1], 0, Infinity);
  }

  sink?.({ phase: "prepare", ms: performance.now() - t0, rows: model.base.lower.length, cols: nVars,
           nnz: model.base.starts[model.base.lower.length] });

  // Section 4: criteria. `sel` is 0/1 over the candidates.
  // In respondents left out among the coverage rows, so in the units of the z objective.
  const reachValue = (sel: Sel) => uncovered(groups, sel);
  type Obj = Objective<Sel> & { coef: Float64Array; row: [Int32Array, Float64Array] };
  const zCoef = new Float64Array(nVars); zCoef.set(groups.weight);
  const fCoef = new Float64Array(nVars); fCoef.set(candReach, n);
  const pCoef = new Float64Array(nVars); pCoef[nVars - 1] = 1;
  const objectives: Record<"reach" | Criterion, Obj> = {
    reach: { name: "reach", direction: "min", coef: zCoef,
             row: [Int32Array.from({ length: n }, (_, i) => i), groups.weight],
             value: reachValue },
    frequency: { name: "frequency", direction: "max", coef: fCoef, row: [xVars, candReach],
                 value: (sel) => sel.reduce((s, v, k) => s + (v ? candReach[k] : 0), 0) },
    penetration: { name: "penetration", direction: "min", coef: pCoef,
                   row: [Int32Array.of(nVars - 1), Float64Array.of(1)],
                   value: (sel) => fsum(Array.from(sel, (v, k) => (v ? penCoef[k] : 0))) },
  };

  const addBound = (mod: solver.Model, obj: Obj, rhs: number) => {
    // With no coverage row left, the reach row is the constant 0: a bound that 0
    // meets is left out; any other stays, and the model is infeasible.
    if (obj.row[0].length === 0 && (obj.direction === "min" ? 0 <= rhs : 0 >= rhs)) return mod;
    return obj.direction === "min" ? mod.addRow(obj.row[0], obj.row[1], -Infinity, rhs)
                                   : mod.addRow(obj.row[0], obj.row[1], rhs, Infinity);
  };
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
      const tc = solver.trace.sink ? performance.now() : 0;
      const sel = new Uint8Array(m);
      let count = 0;
      let bad = false;
      for (let k = 0; k < m; k++) {
        const x = sol[n + k];
        if (Number.isNaN(x)) bad = true;
        if (x > 0.5) { sel[k] = 1; count++; }
        if (Math.abs(x - sel[k]) > 1e-6) bad = true;
      }
      if (bad || count !== size || fixPos.some((k) => !sel[k])) return invalid();
      const better = previous === null || !worseOnEarlier(earlier, sel, previous, size);
      solver.trace.sink?.({ phase: "check", ms: performance.now() - tc });
      if (better) return { status: "ok", sel, model: mod };
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

  // A stage skipped at a proved bound (docs/algorithm.md section 7):
  // reach, when a greedy portfolio of exactly `size` candidates with every
  // fixed product reaches every model respondent; frequency, when the selection
  // entering the stage, after every earlier bound, has the largest frequency
  // that any portfolio with the fixed products can have.
  const greedy = (): Sel => {
    const sel = new Uint8Array(m);
    const hit = new Uint8Array(n);
    const take = (k: number) => { sel[k] = 1; for (const g of groups.colGroups[k]) hit[g] = 1; };
    for (const k of fixPos) take(k);
    for (let left = size - fixPos.length; left > 0; left--) {
      let best = -1;
      let bestGain = -1;
      for (let k = 0; k < m; k++) {
        if (sel[k]) continue;
        let gain = 0;
        for (const g of groups.colGroups[k]) if (!hit[g]) gain += groups.weight[g];
        if (gain > bestGain) { best = k; bestGain = gain; }
      }
      take(best);
    }
    return sel;
  };
  const freeReach = Array.from(candReach).filter((_, k) => !fixPos.includes(k)).sort((a, b) => b - a);
  const maxFrequency = fixPos.reduce((t, k) => t + candReach[k], 0) +
    freeReach.slice(0, size - fixPos.length).reduce((t, x) => t + x, 0);
  const skipped = (stage: "reach" | Criterion, previous: Sel | null): Sel | null => {
    if (solver.settings.skip !== "on") return null;
    if (stage === "reach" && previous === null) {
      const w = greedy();
      return reachValue(w) === 0 ? w : null;
    }
    if (stage === "frequency" && previous !== null && objectives.frequency.value(previous) === maxFrequency) {
      return previous;
    }
    return null;
  };

  // Section 7: the stage loop.
  const stages: ("reach" | Criterion)[] = ["reach", ...tiebreak];
  let previous: Sel | null = null;
  let selected: Sel | null = null;
  for (let s = 0; s < stages.length; s++) {
    const obj = objectives[stages[s]];
    const earlier = stages.slice(0, s).map((t) => objectives[t]);
    const skip = skipped(stages[s], previous);
    const res: { status: Status; sel?: Sel; model: solver.Model } =
      skip ? { status: "ok", sel: skip, model } : nextValid(model, obj, earlier, previous);
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
          const skip = skipped(stages[s + 1], selected);
          const r3 = skip ? { status: "ok" as Status, sel: skip, model: withoutPool }
            : nextValid(addBound(withoutPool, obj, obj.value(selected)), later,
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
  return timed("result", () => portfolio(p, products, warnings, fixed));
}

/**
 * Find the smallest portfolio that reaches every reachable respondent and
 * contains the `fixed` products.
 */
export async function turfMinCover(reach: ReachMatrix,
                                   options: { names?: readonly string[]; fixed?: readonly number[] | null } = {}):
    Promise<Portfolio> {
  const r = asReach(reach, options.names);
  const fixed = checkFixed(options.fixed, r.cols);
  await solver.getSolver();
  return minCoverSync(timed("pack", () => prepare(r)), fixed);
}

function minCoverSync(p: Prepared, fixedIn: readonly number[] = []): Portfolio {
  const cand = p.cand;
  if (cand.length === 0) throw new RangeError("No product reaches any respondent.");
  const fixed = checkFixedReach(fixedIn, p.colReach, p.r.names);
  const m = cand.length;
  const fixPos = fixed.map((j) => cand.indexOf(j));
  // Section 11: one coverage row per group; weights do not matter here.
  // Equal cover rows are one constraint; grouping them has no weights.
  const groups = groupRows(p, fixPos, solver.settings.reduce === "on", 1);
  const n = groups.weight.length;
  const starts = new Int32Array(n + 1);
  for (let g = 0; g < n; g++) starts[g + 1] = groups.start[g + 1];
  let model = new solver.Model(m, {
    starts, indices: groups.index, values: new Float64Array(groups.index.length).fill(1),
    lower: new Float64Array(n).fill(1), upper: new Float64Array(n).fill(Infinity),
  });
  if (fixPos.length) {
    model = model.addRow(fixPos, new Float64Array(fixPos.length).fill(1), fixPos.length, fixPos.length);
  }
  const sol = solver.solve("min", new Float64Array(m).fill(1), model,
                           Int32Array.from({ length: m }, (_, k) => k), "set cover") as Float64Array;
  const products = cand.filter((_, k) => sol[k] > 0.5);
  // Section 11: check the cover on the original data.
  const union = new Uint32Array(p.reachable.length);
  cand.forEach((_, k) => { if (sol[k] > 0.5) bits.orInto(union, p.sets[k]); });
  const covered = bits.count(union) === p.reachableCount;
  const integral = Array.from(sol).every((x) => Math.abs(x - (x > 0.5 ? 1 : 0)) <= 1e-6);
  const hasFixed = fixPos.every((k) => sol[k] > 0.5);
  if (!covered || !integral || !hasFixed) {
    throw new Error("HiGHS returned an invalid solution in the set cover stage.");
  }
  return portfolio(p, products, [], fixed);
}

/**
 * Solve `turf` for each size. The default sizes are 1 (or the number of fixed
 * products) to the size of the minimum cover with the same `fixed`.
 */
export async function turfSizes(reach: ReachMatrix, sizes?: readonly number[] | null,
                                options: TurfOptions = {}): Promise<Portfolio[]> {
  const r = asReach(reach, options.names);
  const tiebreak = checkTiebreak(options.tiebreak);
  checkLimits(options.maxPool ?? 1000, options.maxPoolSeconds ?? 30);
  const fixed = checkFixedReach(checkFixed(options.fixed, r.cols), columnSums(r), r.names);
  await solver.getSolver();
  // Prepared once for the minimum cover and every size.
  const p = timed("pack", () => prepare(r));
  const from = Math.max(1, fixed.length);
  const list = sizes ?? Array.from({ length: minCoverSync(p, fixed).size - from + 1 }, (_, i) => i + from);
  return list.map((k) => turfSync(p, k, tiebreak, fixed, options.maxPool ?? 1000,
                                  options.maxPoolSeconds ?? 30));
}
