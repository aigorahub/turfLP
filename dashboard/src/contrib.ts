// What each product adds to the reach of a portfolio. The page draws it, so
// this module does not load the solver.

import type { Matrix } from "./worker.js";

/**
 * Each product's share of the reach of a portfolio, in the order a greedy
 * count adds them: first the product that reaches the most respondents, then
 * each time the product that adds the most. The fixed products of the
 * portfolio come first, so that the others show what they add to them. The
 * parts sum to the reach.
 */
export function contributions(matrix: Matrix, products: readonly number[],
                              fixed: readonly number[] = []): { product: number; added: number }[] {
  const { rows, cols, data } = matrix;
  const hit = new Uint8Array(rows);
  const out: { product: number; added: number }[] = [];
  for (const left of [products.filter((j) => fixed.includes(j)), products.filter((j) => !fixed.includes(j))]) {
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
  }
  return out;
}

/** The respondents each product adds when the products are counted in the given order. */
export function addedInOrder(matrix: Matrix, ordered: readonly number[]): number[] {
  const { rows, cols, data } = matrix;
  const hit = new Uint8Array(rows);
  return ordered.map((j) => {
    let gain = 0;
    for (let i = 0; i < rows; i++) {
      if (!hit[i] && data[i * cols + j] === 1) { hit[i] = 1; gain++; }
    }
    return gain;
  });
}

/** Distinct colors for the products; later products share the "other" color. */
export const PRODUCT_COLORS = 8;

export interface StackPart {
  /** Product columns of the segment: one, or several for "other". */
  products: number[];
  added: number;
  /** Color slot: 0 to PRODUCT_COLORS - 1, or PRODUCT_COLORS for "other". */
  slot: number;
}

/**
 * The columns of a run, smallest size first. Each product keeps one color
 * slot in every column: slots go first to the fixed products (in greedy
 * order), then to the others in the order they first join a portfolio as the
 * size grows (within a size, in greedy order). Each column stacks its products
 * by slot, so a product sits at the same place in the order everywhere and the
 * fixed products are at the bottom; a segment is the reach the product adds to
 * those below it. Products past the last color form one "other" segment on top.
 */
export function stackColumns(matrix: Matrix, portfolios: readonly { products: readonly number[] }[],
                             fixed: readonly number[] = []): { slots: Map<number, number>; columns: StackPart[][] } {
  const slots = new Map<number, number>();
  for (const c of contributions(matrix, fixed, fixed)) slots.set(c.product, slots.size);
  for (const p of portfolios) {
    for (const c of contributions(matrix, p.products, fixed)) if (!slots.has(c.product)) slots.set(c.product, slots.size);
  }
  const columns = portfolios.map((p) => {
    const ordered = [...p.products].sort((a, b) => slots.get(a)! - slots.get(b)!);
    const added = addedInOrder(matrix, ordered);
    const parts: StackPart[] = [];
    ordered.forEach((j, k) => {
      const slot = Math.min(slots.get(j)!, PRODUCT_COLORS);
      const last = parts.at(-1);
      if (slot === PRODUCT_COLORS && last?.slot === PRODUCT_COLORS) {
        last.products.push(j);
        last.added += added[k];
      } else {
        parts.push({ products: [j], added: added[k], slot });
      }
    });
    return parts;
  });
  return { slots, columns };
}
