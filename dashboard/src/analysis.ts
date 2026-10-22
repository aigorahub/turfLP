// Extra solves for the dashboard, outside the turfLP package: how each stage
// of the optimization narrows the choice, and the trade-off between reach and
// frequency at one portfolio size. The model is the reduced model of
// docs/algorithm.md section 3, built here from the package's prepared data and
// coverage groups so that the published package API does not change.

import * as bits from "../../js/src/bitset.js";
import { groupRows, prepare, type Prepared } from "../../js/src/prepare.js";
import * as solver from "../../js/src/solver.js";
import type { Criterion } from "../../js/src/index.js";
import type { Matrix } from "./worker.js";

/** One portfolio, with its products as column indices of the matrix, ascending. */
export interface Point {
  products: number[];
  reach: number;
  frequency: number;
  penetration: number;
}

export type Stop = "complete" | "time" | "cancelled" | "limit" | "invalid";

export interface StageInfo {
  criterion: "reach" | Criterion;
  /** Value of the chosen portfolio. */
  value: number;
  /** Worst value among portfolios at least as good on the earlier stages; null for reach. */
  worst: number | null;
  /** Portfolios at least as good on this stage and the earlier ones, up to TIE_CAP. */
  ties: number;
  /** True when the count stopped at the cap or the time limit, so `ties` is a lower bound. */
  tiesAtLeast: boolean;
}

export const TIE_CAP = 20;
// Solves per range or count that may return portfolios outside the bounds, before the count stops.
const MAX_REJECTS = 50;
const EPS = 2 ** -52;

/** Pause between solves so that a cancel message can arrive. Returns false to stop. */
export type Between = () => Promise<boolean>;

class Stopped extends Error {
  constructor(readonly reason: Stop) { super(reason); }
}

/**
 * The size-k model of docs/algorithm.md section 3, without the penetration
 * variable, in its reduced form: the respondents that the fixed columns reach
 * leave the model, and respondents reached by the same candidates share one
 * row of weight w_g. Reach values and bounds in the model are uncovered
 * respondents; the public reach is computed from the original data.
 */
class SizeModel {
  /** Number of coverage rows (groups). */
  readonly groupCount: number;
  /** Respondents that some candidate reaches. */
  readonly reachable: number;
  readonly m: number;
  readonly cand: readonly number[];
  readonly candReach: Float64Array;
  readonly xVars: Int32Array;
  readonly reachCoef: Float64Array;
  readonly freqCoef: Float64Array;
  readonly penCoef: Float64Array;
  /** The model with one order kept for identical products; the frontier and the ranges use it. */
  readonly base: solver.Model;
  /** The model without those rows, so that counts include each order of identical products. */
  readonly plain: solver.Model;
  /** Candidate positions of the fixed columns. */
  readonly fixPos: number[];
  private readonly prep: Prepared;
  private readonly weight: Float64Array;

  constructor(readonly matrix: Matrix, readonly size: number, fixed: readonly number[] = []) {
    const prep = (this.prep = prepare(matrix));
    this.cand = prep.cand;
    if (size < 1 || size > this.cand.length) throw new RangeError(`No portfolio of ${size} products reaches anyone.`);
    this.fixPos = [...new Set(fixed)].map((j) => this.cand.indexOf(j));
    if (this.fixPos.includes(-1)) throw new RangeError("A fixed product reaches no one.");
    if (this.fixPos.length > size) throw new RangeError(`A portfolio of ${size} cannot hold ${this.fixPos.length} fixed products.`);
    const groups = groupRows(prep, this.fixPos, true);
    this.weight = groups.weight;
    this.reachable = prep.reachableCount;
    const n = (this.groupCount = groups.weight.length);
    const m = (this.m = this.cand.length);
    this.candReach = Float64Array.from(this.cand, (j) => prep.colReach[j]);
    const maxR = Math.max(...this.candReach);
    this.xVars = Int32Array.from({ length: m }, (_, k) => n + k);
    const nVars = n + m;
    // Reach: minimize the uncovered respondents. Frequency: maximize. Penetration: minimize.
    this.reachCoef = new Float64Array(nVars);
    this.reachCoef.set(groups.weight);
    this.freqCoef = new Float64Array(nVars);
    this.freqCoef.set(this.candReach, n);
    this.penCoef = new Float64Array(nVars);
    this.penCoef.set(Float64Array.from(this.candReach, (x) => maxR / x), n);

    const starts = new Int32Array(n + 2);
    const idx: number[] = [];
    for (let g = 0; g < n; g++) {
      idx.push(g);
      for (let t = groups.start[g]; t < groups.start[g + 1]; t++) idx.push(n + groups.index[t]);
      starts[g + 1] = idx.length;
    }
    for (let k = 0; k < m; k++) idx.push(n + k);
    starts[n + 1] = idx.length;
    const lower = new Float64Array(n + 1).fill(1);
    const upper = new Float64Array(n + 1).fill(Infinity);
    lower[n] = upper[n] = size;
    let model = new solver.Model(nVars, {
      starts, indices: Int32Array.from(idx), values: new Float64Array(idx.length).fill(1), lower, upper,
    });
    if (this.fixPos.length) {
      model = model.addRow(this.fixPos.map((k) => n + k), new Float64Array(this.fixPos.length).fill(1),
                           this.fixPos.length, this.fixPos.length);
    }
    this.plain = model;
    // Identical free products, by their columns over the full input: keep one
    // order, as the package does. A fixed product takes no part, or the row
    // would force its twins in.
    const isFixed = new Uint8Array(m);
    for (const k of this.fixPos) isFixed[k] = 1;
    for (let k = 0; k < m; k++) {
      if (isFixed[k]) continue;
      let prev = prep.twinOf[k];
      while (prev >= 0 && isFixed[prev]) prev = prep.twinOf[prev];
      if (prev >= 0) model = model.addRow([n + prev, n + k], [1, -1], 0, Infinity);
    }
    this.base = model;
  }

  /** Candidate selection of a portfolio given as matrix columns. */
  selection(products: readonly number[]): Uint8Array {
    const sel = new Uint8Array(this.m);
    for (const j of products) {
      const k = this.cand.indexOf(j);
      if (k < 0) throw new RangeError("The portfolio has a product that reaches no one.");
      sel[k] = 1;
    }
    return sel;
  }

  /** The portfolio's values, from the original data. */
  point(sel: Uint8Array): Point {
    const union = new Uint32Array(this.prep.reachable.length);
    const products: number[] = [];
    let frequency = 0;
    let inverse = 0;
    sel.forEach((v, k) => {
      if (!v) return;
      products.push(this.cand[k]);
      frequency += this.candReach[k];
      inverse += 1 / this.candReach[k];
      bits.orInto(union, this.prep.sets[k]);
    });
    return { products, reach: bits.count(union), frequency, penetration: products.length / inverse };
  }

  penSum(sel: Uint8Array): number {
    let s = 0;
    sel.forEach((v, k) => { if (v) s += this.penCoef[this.groupCount + k]; });
    return s;
  }

  /**
   * Portfolios that reach at least `reach` respondents (covered units): in the
   * model, at most `reachable - reach` weighted respondents uncovered. With no
   * coverage row left, the row is the constant 0, which HiGHS checks.
   */
  atLeastReach(mod: solver.Model, reach: number): solver.Model {
    return mod.addRow(Int32Array.from({ length: this.groupCount }, (_, g) => g), this.weight,
                      -Infinity, this.reachable - reach);
  }

  atLeastFrequency(mod: solver.Model, frequency: number): solver.Model {
    return mod.addRow(this.xVars, this.candReach, frequency, Infinity);
  }

  atMostPenSum(mod: solver.Model, sum: number): solver.Model {
    const tol = 16 * this.size * EPS * Math.max(1, Math.abs(sum));
    return mod.addRow(this.xVars, this.penCoef.subarray(this.groupCount), -Infinity, sum + tol);
  }

  exclude(mod: solver.Model, sel: Uint8Array): solver.Model {
    const ix: number[] = [];
    sel.forEach((v, k) => { if (v) ix.push(this.groupCount + k); });
    return mod.addRow(ix, new Float64Array(ix.length).fill(1), -Infinity, this.size - 1);
  }

  /** One solve. Returns the selection, or null when no portfolio fits. Throws Stopped. */
  solve(direction: "min" | "max", coef: Float64Array, mod: solver.Model, deadline: number): Uint8Array | null {
    const remaining = deadline - performance.now() / 1000;
    if (remaining <= 0) throw new Stopped("time");
    const sol = solver.solve(direction, coef, mod, this.xVars, "analysis", true, remaining);
    if (sol === null) return null;
    if (sol === "time") throw new Stopped("time");
    if (sol === "invalid") throw new Stopped("invalid");
    const sel = new Uint8Array(this.m);
    let count = 0;
    for (let k = 0; k < this.m; k++) {
      const x = sol[this.groupCount + k];
      if (!(Math.abs(x) <= 1e-6 || Math.abs(x - 1) <= 1e-6)) throw new Stopped("invalid");
      if (x > 0.5) { sel[k] = 1; count++; }
    }
    if (count !== this.size || this.fixPos.some((k) => !sel[k])) throw new Stopped("invalid");
    return sel;
  }
}

async function pause(between: Between | undefined): Promise<void> {
  if (between && !(await between())) throw new Stopped("cancelled");
}

/**
 * For the chosen portfolio, the value of each stage, the worst value of each
 * tie-break stage among portfolios at least as good on the earlier stages,
 * and how many portfolios are at least as good up to each stage.
 */
export async function stageInfo(matrix: Matrix, products: readonly number[], tiebreak: readonly Criterion[],
                                options: { seconds?: number; between?: Between; fixed?: readonly number[] } = {}):
    Promise<{ stages: StageInfo[]; stop: Stop }> {
  await solver.getSolver();
  const sm = new SizeModel(matrix, products.length, options.fixed);
  const chosen = sm.selection(products);
  const p = sm.point(chosen);
  const deadline = performance.now() / 1000 + (options.seconds ?? 20);
  const criteria: ("reach" | Criterion)[] = ["reach", ...tiebreak];
  const stages: StageInfo[] = criteria.map((c) => ({
    criterion: c, value: c === "reach" ? p.reach : c === "frequency" ? p.frequency : p.penetration,
    worst: null, ties: 0, tiesAtLeast: true,
  }));
  // Models with the bounds of the stages up to s, with and without the rows for identical products.
  const penBound = sm.penSum(chosen);
  const penTol = 16 * sm.size * 2 ** -52 * Math.max(1, Math.abs(penBound));
  const bound = (mod: solver.Model, c: "reach" | Criterion) =>
    c === "reach" ? sm.atLeastReach(mod, p.reach)
      : c === "frequency" ? sm.atLeastFrequency(mod, p.frequency) : sm.atMostPenSum(mod, penBound);
  const upTo: solver.Model[] = [];
  const plainUpTo: solver.Model[] = [];
  let mod = sm.base;
  let plain = sm.plain;
  for (const c of criteria) {
    mod = bound(mod, c); upTo.push(mod);
    plain = bound(plain, c); plainUpTo.push(plain);
  }
  // The solver meets a bound only to within its tolerance, so check each portfolio
  // exactly, with the comparison tolerance of the package for penetration.
  const meets = (sel: Uint8Array, through: number) => {
    const q = sm.point(sel);
    return criteria.slice(0, through + 1).every((c) =>
      c === "reach" ? q.reach >= p.reach
        : c === "frequency" ? q.frequency >= p.frequency : sm.penSum(sel) <= penBound + penTol);
  };
  let stop: Stop = "complete";
  try {
    // Ranges first: they cost one solve each.
    for (let s = 1; s < criteria.length; s++) {
      const c = criteria[s];
      let m1 = upTo[s - 1];
      let worst: Uint8Array | null = null;
      for (let t = 0; t < MAX_REJECTS && !worst; t++) {
        await pause(options.between);
        const sel = c === "frequency"
          ? sm.solve("min", sm.freqCoef, m1, deadline)
          : sm.solve("max", sm.penCoef, m1, deadline);
        // The chosen portfolio meets the bounds, so a solve that finds none is wrong.
        if (!sel) throw new Stopped("invalid");
        if (meets(sel, s - 1)) worst = sel;
        else m1 = sm.exclude(m1, sel);
      }
      if (!worst) throw new Stopped("limit");
      const w = sm.point(worst);
      stages[s].worst = c === "frequency" ? w.frequency : w.penetration;
    }
    // Then the counts, which stop at the cap.
    for (let s = 0; s < criteria.length; s++) {
      // A later stage keeps no more portfolios than the one before it.
      if (s > 0 && stages[s - 1].ties === 1 && !stages[s - 1].tiesAtLeast) {
        stages[s].ties = 1;
        stages[s].tiesAtLeast = false;
        continue;
      }
      let m2 = plainUpTo[s];
      let count = 0;
      let rejects = 0;
      stages[s].tiesAtLeast = true;
      while (count < TIE_CAP && rejects < MAX_REJECTS) {
        await pause(options.between);
        const sel = sm.solve("min", new Float64Array(sm.base.nVars), m2, deadline);
        if (!sel) { stages[s].tiesAtLeast = false; break; }
        if (meets(sel, s)) {
          count++;
          stages[s].ties = count;
        } else {
          rejects++;
        }
        m2 = sm.exclude(m2, sel);
      }
      stages[s].ties = Math.max(count, 1);
    }
  } catch (e) {
    if (!(e instanceof Stopped)) throw e;
    stop = e.reason;
    for (const st of stages) st.ties = Math.max(st.ties, 1);
  }
  return { stages, stop };
}

export interface FrontierOptions {
  seconds?: number;
  maxPoints?: number;
  between?: Between;
  /** Called with each point as it is found, from most reach to most frequency. */
  onPoint?: (p: Point) => void;
  /** Columns that every portfolio contains. */
  fixed?: readonly number[];
}

/**
 * The portfolios of `size` products where reach cannot rise without frequency
 * falling, from the most reach to the most frequency. Each step finds the most
 * reach with more frequency than the last point, then the most frequency with
 * that reach. Reach and frequency are whole numbers, so the bounds are exact.
 */
export async function frontier(matrix: Matrix, size: number, options: FrontierOptions = {}):
    Promise<{ points: Point[]; maxFrequency: number; stop: Stop }> {
  await solver.getSolver();
  const sm = new SizeModel(matrix, size, options.fixed);
  const deadline = performance.now() / 1000 + (options.seconds ?? 30);
  const maxPoints = options.maxPoints ?? 40;
  // The most frequency is the reach of the fixed columns plus the largest
  // column sums of the others; no solve needed.
  const fixedReach = sm.fixPos.reduce((s, k) => s + sm.candReach[k], 0);
  const maxFrequency = fixedReach + [...sm.candReach].filter((_, k) => !sm.fixPos.includes(k))
    .sort((a, b) => b - a).slice(0, size - sm.fixPos.length).reduce((a, b) => a + b, 0);
  const points: Point[] = [];
  let stop: Stop = "complete";
  try {
    let freqFloor = 0;
    while (points.length < maxPoints) {
      await pause(options.between);
      const a = sm.solve("min", sm.reachCoef, sm.atLeastFrequency(sm.base, freqFloor), deadline);
      if (!a) break;
      const reach = sm.point(a).reach;
      await pause(options.between);
      const b = sm.solve("max", sm.freqCoef, sm.atLeastReach(sm.base, reach), deadline);
      if (!b) throw new Stopped("invalid");
      const pt = sm.point(b);
      const last = points.at(-1);
      if (pt.reach !== reach || pt.frequency < freqFloor || (last && !(pt.reach < last.reach && pt.frequency > last.frequency))) {
        throw new Stopped("invalid");
      }
      points.push(pt);
      options.onPoint?.(pt);
      if (pt.frequency >= maxFrequency) break;
      freqFloor = pt.frequency + 1;
    }
    if (points.length >= maxPoints && points.at(-1)!.frequency < maxFrequency) stop = "limit";
  } catch (e) {
    if (!(e instanceof Stopped)) throw e;
    stop = e.reason;
  }
  return { points, maxFrequency, stop };
}
