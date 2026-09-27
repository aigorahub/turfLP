// Input checks. Mirrors as_reach_matrix(), check_size(), and check_tiebreak()
// in R/turf.R; the error texts are those of docs/algorithm.md section 1.

export type ReachMatrix = ReadonlyArray<ReadonlyArray<number | boolean>>;
export type Criterion = "frequency" | "penetration";

export interface Reach {
  /** Row-major 0/1 values, `rows * cols` long. */
  readonly data: Uint8Array;
  readonly rows: number;
  readonly cols: number;
  readonly names: string[];
}

const NOT_TABLE = "`reach` must be a numeric or logical matrix or data frame.";

export function asReach(reach: unknown, names?: readonly string[]): Reach {
  if (!Array.isArray(reach) || !reach.every((row) => Array.isArray(row))) {
    throw new TypeError(NOT_TABLE);
  }
  const rows = reach.length;
  const cols = rows > 0 ? (reach[0] as unknown[]).length : 0;
  if (reach.some((row) => (row as unknown[]).length !== cols)) {
    throw new RangeError(NOT_TABLE);
  }
  for (const row of reach as unknown[][]) {
    for (const v of row) {
      if (v !== null && v !== undefined && typeof v !== "number" && typeof v !== "boolean") {
        throw new TypeError(NOT_TABLE);
      }
    }
  }
  if (rows === 0 || cols === 0) {
    throw new RangeError("`reach` must have at least one row and one column.");
  }
  const data = new Uint8Array(rows * cols);
  let missing = false;
  let bad = false;
  (reach as unknown[][]).forEach((row, i) => {
    row.forEach((v, j) => {
      if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) {
        missing = true;
      } else if (v === true || v === 1) {
        data[i * cols + j] = 1;
      } else if (!(v === false || v === 0)) {
        bad = true;
      }
    });
  });
  if (missing) throw new RangeError("`reach` must not contain missing values.");
  if (bad) throw new RangeError("`reach` must contain only 0 and 1, or FALSE and TRUE.");

  let out: string[];
  if (names !== undefined && names !== null) {
    out = Array.from(names, String);
    if (out.length !== cols) {
      throw new RangeError("`names` must have one name per column of `reach`.");
    }
  } else {
    out = Array.from({ length: cols }, (_, j) => `P${j + 1}`);
  }
  return { data, rows, cols, names: out };
}

export function checkSize(size: unknown, maxSize: number): number {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 1 || !Number.isInteger(size)) {
    throw new RangeError("`size` must be a single whole number of 1 or more.");
  }
  if (size > maxSize) {
    throw new RangeError(
      `\`size\` is ${size}, but only ${maxSize} products reach at least one respondent.`,
    );
  }
  return size;
}

export function checkTiebreak(tiebreak: unknown): Criterion[] {
  if (tiebreak === undefined) return ["frequency", "penetration"];
  if (tiebreak === null) return [];
  const list = typeof tiebreak === "string" ? [tiebreak] : tiebreak;
  if (!Array.isArray(list)) {
    throw new RangeError('`tiebreak` must contain only "frequency" and "penetration".');
  }
  const out: Criterion[] = [];
  for (const t of list) {
    if (t !== "frequency" && t !== "penetration") {
      throw new RangeError('`tiebreak` must contain only "frequency" and "penetration".');
    }
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
