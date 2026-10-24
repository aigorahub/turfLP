import { baselines, frontier, type Between, type Point } from "./analysis.js";
import { asReach, checkFixed, checkFixedReach, checkSize, type ReachMatrix } from "./input.js";

export type { Point as AnalysisPoint, Stop as AnalysisStop } from "./analysis.js";

export interface AnalysisOptions {
  names?: readonly string[];
  fixed?: readonly number[] | null;
  /** Solve budget after input preparation and solver loading; zero permits no solve. */
  seconds?: number;
  /** Called between solves. Return false to stop; synchronous solves cannot be interrupted. */
  between?: Between;
}

export interface TurfFrontierOptions extends AnalysisOptions {
  maxPoints?: number;
  onPoint?: (point: Point) => void;
}

function inputs(reach: ReachMatrix, size: number, options: AnalysisOptions) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Analysis options must be an object.");
  }
  const matrix = asReach(reach, options.names);
  const sums = new Int32Array(matrix.cols);
  for (let i = 0; i < matrix.rows; i++) {
    for (let j = 0; j < matrix.cols; j++) sums[j] += matrix.data[i * matrix.cols + j];
  }
  checkSize(size, sums.filter((n) => n > 0).length);
  const fixed = checkFixedReach(checkFixed(options.fixed, matrix.cols), sums, matrix.names);
  if (fixed.length > size) throw new RangeError("The portfolio size is smaller than the number of fixed products.");
  if (options.seconds !== undefined &&
      (typeof options.seconds !== "number" || Number.isNaN(options.seconds) || options.seconds < 0)) {
    throw new RangeError("seconds must be a number of 0 or more (Infinity for no limit).");
  }
  if (options.between !== undefined && typeof options.between !== "function") {
    throw new TypeError("between must be a function.");
  }
  return { matrix, fixed };
}

/** Greedy and maximum-frequency portfolios; ties on frequency maximize reach. */
export async function turfBaselines(reach: ReachMatrix, size: number, options: AnalysisOptions = {}) {
  const { matrix, fixed } = inputs(reach, size, options);
  return baselines(matrix, size, { fixed, seconds: options.seconds, between: options.between });
}

/** Nondominated reach/frequency points, with the best penetration at each point. */
export async function turfFrontier(reach: ReachMatrix, size: number, options: TurfFrontierOptions = {}) {
  const { matrix, fixed } = inputs(reach, size, options);
  const maxPoints = options.maxPoints === undefined ? 40 : options.maxPoints;
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 1) {
    throw new RangeError("maxPoints must be a positive safe integer.");
  }
  if (options.onPoint !== undefined && typeof options.onPoint !== "function") {
    throw new TypeError("onPoint must be a function.");
  }
  const notify = options.onPoint;
  return frontier(matrix, size, {
    fixed, seconds: options.seconds, maxPoints, between: options.between,
    // Callers must not mutate the search's incumbent through progress callbacks.
    onPoint: notify ? (point) => notify({ ...point, products: [...point.products] }) : undefined,
  });
}
