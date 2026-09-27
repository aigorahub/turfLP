// TURF analysis (total unduplicated reach and frequency) with integer linear
// programming. JavaScript port of the turfLP R package; see docs/algorithm.md
// in https://github.com/aigorahub/turfLP for the specification.

export { turf, turfMinCover, turfSizes, type Portfolio, type TurfOptions } from "./core.js";
export { loadSolver, type LoadOptions } from "./solver.js";
export type { ReachMatrix, Criterion } from "./input.js";
