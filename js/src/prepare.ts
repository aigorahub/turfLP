// Data prepared once per validated input and shared by every size of a call
// and the default minimum cover (docs/algorithm.md section 2). Nothing here
// depends on the fixed products; reduce() builds the fixed-specific part in
// its own storage, so the original sets are never changed.

import * as bits from "./bitset.js";
import type { Reach } from "./input.js";

export interface Prepared {
  readonly r: Reach;
  /** Reach of each original column. */
  readonly colReach: Int32Array;
  /** Candidate columns (positive reach), in column order. */
  readonly cand: readonly number[];
  /** Respondent set of each candidate, over all respondents. */
  readonly sets: readonly Uint32Array[];
  /** Respondents that some candidate reaches. */
  readonly reachable: Uint32Array;
  /** Number of reachable respondents. */
  readonly reachableCount: number;
  /**
   * For each candidate position, the latest earlier candidate position with the
   * same respondent set over the full input, or -1.
   */
  readonly twinOf: Int32Array;
}

export function prepare(r: Reach): Prepared {
  const nw = bits.words(r.rows);
  const all = Array.from({ length: r.cols }, () => new Uint32Array(nw));
  for (let i = 0; i < r.rows; i++) {
    const off = i * r.cols;
    const w = i >>> 5;
    const bit = 1 << (i & 31);
    for (let j = 0; j < r.cols; j++) if (r.data[off + j] === 1) all[j][w] |= bit;
  }
  const colReach = Int32Array.from(all, bits.count);
  const cand: number[] = [];
  for (let j = 0; j < r.cols; j++) if (colReach[j] > 0) cand.push(j);
  const sets = cand.map((j) => all[j]);
  const reachable = new Uint32Array(nw);
  for (const s of sets) bits.orInto(reachable, s);
  // A hash finds possible twins; equal() confirms each one.
  const twinOf = new Int32Array(cand.length).fill(-1);
  const seen = new Map<string, number[]>();
  sets.forEach((s, k) => {
    const key = `${colReach[cand[k]]}:${s.length ? s[0] : 0}:${s.length ? s[s.length - 1] : 0}`;
    const list = seen.get(key) ?? [];
    for (let t = list.length - 1; t >= 0; t--) {
      if (bits.equal(sets[list[t]], s)) { twinOf[k] = list[t]; break; }
    }
    list.push(k);
    seen.set(key, list);
  });
  return { r, colReach, cand, sets, reachable, reachableCount: bits.count(reachable), twinOf };
}

/** The coverage rows of one call with its fixed products (docs/algorithm.md section 3). */
export interface Groups {
  /** Respondents that the fixed products reach; their rows are left out. */
  readonly covered: number;
  /** Respondents of each group. */
  readonly weight: Float64Array;
  /** Candidate positions that reach each group, as CSR. */
  readonly start: Int32Array;
  readonly index: Int32Array;
  /** Groups that each candidate position reaches. */
  readonly colGroups: readonly Int32Array[];
}

/**
 * Rows are grouped only when the groups are at most this share of the rows
 * left after the fixed products. Measured on the benchmark inputs
 * (docs/plans/bip-speed-log.md, B3): weighted rows make the reach stage
 * smaller, but the reach bound of the later stages becomes a row with
 * weights, which HiGHS solved several times slower on cafe (2004 groups of
 * 2431 rows) than the row of ones.
 */
export const GROUP_RATIO = 0.6;

/**
 * Coverage rows over the reachable respondents. With `reduce`, respondents
 * that a fixed product reaches are left out (every portfolio reaches them),
 * and, when the groups are at most `maxRatio` of the rows left, respondents
 * reached by the same candidates share one row whose weight is their number.
 * Otherwise each respondent left is its own row of weight 1; without
 * `reduce`, every reachable respondent is, as in the unreduced model.
 */
export function groupRows(p: Prepared, fixPos: readonly number[], reduce: boolean,
                          maxRatio = GROUP_RATIO): Groups {
  const { r, cand } = p;
  const residual = p.reachable.slice();
  let covered = 0;
  if (reduce && fixPos.length) {
    const fixedSet = new Uint32Array(residual.length);
    for (const k of fixPos) bits.orInto(fixedSet, p.sets[k]);
    covered = bits.count(fixedSet);
    bits.andNotInto(residual, fixedSet);
  }
  const rows = (group: boolean) => {
    const weight: number[] = [];
    const start = [0];
    const index: number[] = [];
    const byPattern = new Map<string, number>();
    bits.forEach(residual, (i) => {
      const off = i * r.cols;
      const pattern: number[] = [];
      for (let k = 0; k < cand.length; k++) if (r.data[off + cand[k]] === 1) pattern.push(k);
      if (group) {
        const key = pattern.join(",");
        const g = byPattern.get(key);
        if (g !== undefined) { weight[g]++; return; }
        byPattern.set(key, weight.length);
      }
      weight.push(1);
      index.push(...pattern);
      start.push(index.length);
    });
    return { weight, start, index };
  };
  let built = rows(reduce);
  if (reduce && built.weight.length > maxRatio * bits.count(residual)) built = rows(false);
  const { weight, start, index } = built;
  const per = cand.map(() => [] as number[]);
  for (let g = 0; g < weight.length; g++) {
    for (let t = start[g]; t < start[g + 1]; t++) per[index[t]].push(g);
  }
  return { covered, weight: Float64Array.from(weight), start: Int32Array.from(start),
           index: Int32Array.from(index), colGroups: per.map((l) => Int32Array.from(l)) };
}

/** Weighted respondents of the groups that no selected candidate reaches. */
export function uncovered(groups: Groups, sel: ArrayLike<number>): number {
  const hit = new Uint8Array(groups.weight.length);
  for (let k = 0; k < sel.length; k++) if (sel[k]) for (const g of groups.colGroups[k]) hit[g] = 1;
  let u = 0;
  for (let g = 0; g < hit.length; g++) if (!hit[g]) u += groups.weight[g];
  return u;
}
