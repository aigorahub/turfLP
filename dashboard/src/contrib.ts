// What each product adds to the reach of a portfolio. The page draws it, so
// this module does not load the solver.

import type { Matrix } from "./worker.js";

/**
 * Each product's share of the reach of a portfolio, in the order a greedy
 * count adds them: first the product that reaches the most respondents, then
 * each time the product that adds the most. The parts sum to the reach.
 */
export function contributions(matrix: Matrix, products: readonly number[]): { product: number; added: number }[] {
  const { rows, cols, data } = matrix;
  const hit = new Uint8Array(rows);
  const left = [...products];
  const out: { product: number; added: number }[] = [];
  while (left.length) {
    let best = -1;
    let bestGain = -1;
    for (const j of left) {
      let gain = 0;
      for (let i = 0; i < rows; i++) if (!hit[i] && data[i * cols + j] === 1) gain++;
      // Ties go to the earlier column, so the order is stable.
      if (gain > bestGain || (gain === bestGain && j < best)) { best = j; bestGain = gain; }
    }
    for (let i = 0; i < rows; i++) if (data[i * cols + best] === 1) hit[i] = 1;
    out.push({ product: best, added: bestGain });
    left.splice(left.indexOf(best), 1);
  }
  return out;
}
