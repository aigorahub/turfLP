// Extra solves for the dashboard's deep dive, outside the turfLP package: the
// simple choices to compare with, and the trade-off between reach and
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

// Portfolios searched for the best penetration of one frontier point, as the package's pool.
const MAX_POOL = 1000;
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
  /** The model with one order kept for identical products. */
  readonly base: solver.Model;
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

  /** The fixed products plus the largest reaches of the others; no portfolio has more frequency. */
  maxFrequency(): number {
    const fixedReach = this.fixPos.reduce((s, k) => s + this.candReach[k], 0);
    return fixedReach + [...this.candReach].filter((_, k) => !this.fixPos.includes(k))
      .sort((a, b) => b - a).slice(0, this.size - this.fixPos.length).reduce((a, b) => a + b, 0);
  }

  /**
   * The greedy portfolio: from the fixed products, add the product that adds
   * the most reach, one at a time. Ties go to the larger individual reach,
   * then to the first column. No solve.
   */
  greedy(): Uint8Array {
    const sel = new Uint8Array(this.m);
    const union = new Uint32Array(this.prep.reachable.length);
    for (const k of this.fixPos) {
      sel[k] = 1;
      bits.orInto(union, this.prep.sets[k]);
    }
    for (let t = this.fixPos.length; t < this.size; t++) {
      let best = -1;
      let gain = -1;
      for (let k = 0; k < this.m; k++) {
        if (sel[k]) continue;
        const g = bits.countAndNot(this.prep.sets[k], union);
        if (g > gain || (g === gain && this.candReach[k] > this.candReach[best])) {
          best = k;
          gain = g;
        }
      }
      sel[best] = 1;
      bits.orInto(union, this.prep.sets[best]);
    }
    return sel;
  }

  /**
   * The most popular products: the fixed products plus the others with the
   * largest reach, so the most frequency. When products tie on reach at the
   * cut, one solve picks the tied ones that reach the most respondents. Every
   * such portfolio has the same product reaches, so the same penetration.
   */
  mostPopular(deadline: number): Uint8Array {
    const free = [...this.candReach.keys()].filter((k) => !this.fixPos.includes(k))
      .sort((a, b) => this.candReach[b] - this.candReach[a] || a - b);
    const need = this.size - this.fixPos.length;
    const cut = need > 0 ? this.candReach[free[need - 1]] : Infinity;
    const above = free.filter((k) => this.candReach[k] > cut);
    const at = free.filter((k) => this.candReach[k] === cut);
    if (above.length + at.length === need) {
      const sel = new Uint8Array(this.m);
      for (const k of [...this.fixPos, ...above, ...at]) sel[k] = 1;
      return sel;
    }
    const maxF = this.maxFrequency();
    const sel = this.solve("min", this.reachCoef, this.atLeastFrequency(this.base, maxF), deadline);
    if (!sel || this.point(sel).frequency !== maxF) throw new Stopped("invalid");
    return sel;
  }

  /**
   * The best penetration among the portfolios with this reach and frequency.
   * Called for a frontier point, where no portfolio has more of either, so
   * the bounds hold with equality. The solver meets the penetration optimum
   * only to within its tolerance, so, as the package does (docs/algorithm.md
   * section 8), the portfolios within that tolerance of the first one are
   * searched, up to MAX_POOL of them, and the best is kept exactly.
   * `complete` is false when the search stopped at that limit. `between`
   * runs before each search solve, so a cancel stops the search.
   */
  async bestPenetration(reach: number, frequency: number, deadline: number,
                        between?: Between): Promise<{ sel: Uint8Array; complete: boolean }> {
    let mod = this.atLeastFrequency(this.atLeastReach(this.base, reach), frequency);
    const first = this.solve("min", this.penCoef, mod, deadline);
    if (!first) throw new Stopped("invalid");
    const exact = (sel: Uint8Array) => {
      const q = this.point(sel);
      return q.reach === reach && q.frequency === frequency;
    };
    if (!exact(first)) throw new Stopped("invalid");
    const bound = this.penSum(first);
    const tol = 16 * this.size * EPS * Math.max(1, Math.abs(bound));
    const pool = [first];
    mod = this.atMostPenSum(mod, bound);
    let last = first;
    let complete = false;
    for (let i = 0; i < MAX_POOL; i++) {
      await pause(between);
      mod = this.exclude(mod, last);
      const next = this.solve("min", this.penCoef, mod, deadline);
      if (!next) { complete = true; break; }
      last = next;
      if (exact(next) && this.penSum(next) <= bound + tol) pool.push(next);
    }
    // The least sum of 1/reach terms is the best penetration; the first within rounding of it wins.
    const sums = pool.map((sel) => this.penSum(sel));
    const lo = Math.min(...sums);
    const best = sums.findIndex((v) => v <= lo + 16 * this.size * EPS * Math.max(1, Math.abs(lo)));
    return { sel: pool[best], complete };
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

export interface FrontierOptions {
  seconds?: number;
  maxPoints?: number;
  between?: Between;
  /** Called with each point as it is found, from most reach to most frequency. */
  onPoint?: (p: Point) => void;
  /** Columns that every portfolio contains. */
  fixed?: readonly number[];
  /**
   * The portfolio of the run and its tie-break. It has the most reach; when
   * the tie-break starts with frequency, it also has the most frequency at
   * that reach, and with penetration next, it is the first point.
   */
  chosen?: { products: readonly number[]; tiebreak: readonly Criterion[] };
  /** The most popular portfolio (baselines()), the last point; the search ends at it without solving again. */
  last?: Point;
}

/**
 * The portfolios of `size` products where reach cannot rise without frequency
 * falling, from the most reach to the most frequency. Each step finds the most
 * reach with more frequency than the last point, then the most frequency with
 * that reach, then the best penetration with both. Reach and frequency are
 * whole numbers, so the bounds are exact.
 */
export async function frontier(matrix: Matrix, size: number, options: FrontierOptions = {}):
    Promise<{ points: Point[]; maxFrequency: number; stop: Stop; penetrationLimited: boolean }> {
  await solver.getSolver();
  const sm = new SizeModel(matrix, size, options.fixed);
  const deadline = performance.now() / 1000 + (options.seconds ?? 30);
  const maxPoints = options.maxPoints ?? 40;
  let penetrationLimited = false;
  const maxFrequency = sm.maxFrequency();
  const chosen = options.chosen ? sm.point(sm.selection(options.chosen.products)) : null;
  const through = options.chosen?.tiebreak[0] !== "frequency" ? 0 : options.chosen.tiebreak[1] === "penetration" ? 2 : 1;
  const last = options.last;
  const points: Point[] = [];
  let stop: Stop = "complete";
  try {
    let freqFloor = 0;
    while (points.length < maxPoints) {
      const first = chosen !== null && points.length === 0;
      let reach: number;
      if (first) {
        reach = chosen.reach;
      } else {
        await pause(options.between);
        const a = sm.solve("min", sm.reachCoef, sm.atLeastFrequency(sm.base, freqFloor), deadline);
        if (!a) break;
        reach = sm.point(a).reach;
      }
      let pt: Point;
      if (first && through === 2) {
        pt = chosen;
      } else if (last && reach === last.reach && !(first && through === 1)) {
        // The most popular portfolio has the most frequency of all, and every
        // such portfolio has its penetration.
        pt = last;
      } else {
        let frequency: number;
        if (first && through === 1) {
          frequency = chosen.frequency;
        } else {
          await pause(options.between);
          const b = sm.solve("max", sm.freqCoef, sm.atLeastReach(sm.base, reach), deadline);
          if (!b) throw new Stopped("invalid");
          frequency = sm.point(b).frequency;
        }
        await pause(options.between);
        const best = await sm.bestPenetration(reach, frequency, deadline, options.between);
        if (!best.complete) penetrationLimited = true;
        pt = sm.point(best.sel);
      }
      const prev = points.at(-1);
      if (pt.reach !== reach || pt.frequency < freqFloor || (prev && !(pt.reach < prev.reach && pt.frequency > prev.frequency))) {
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
  return { points, maxFrequency, stop, penetrationLimited };
}

/**
 * Two simple ways to choose `size` products, to compare with the optimum:
 * the most popular products (the most frequency, the last point of the
 * frontier) and the greedy portfolio. `mostPopular` is null when its solve
 * stopped.
 */
export async function baselines(matrix: Matrix, size: number,
                                options: { seconds?: number; between?: Between; fixed?: readonly number[] } = {}):
    Promise<{ mostPopular: Point | null; greedy: Point; stop: Stop }> {
  await solver.getSolver();
  const sm = new SizeModel(matrix, size, options.fixed);
  const greedy = sm.point(sm.greedy());
  const deadline = performance.now() / 1000 + (options.seconds ?? 10);
  try {
    await pause(options.between);
    return { mostPopular: sm.point(sm.mostPopular(deadline)), greedy, stop: "complete" };
  } catch (e) {
    if (!(e instanceof Stopped)) throw e;
    return { mostPopular: null, greedy, stop: e.reason };
  }
}
