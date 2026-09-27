import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFORMANCE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "conformance");
export const hasConformance = existsSync(join(CONFORMANCE, "fixtures"));

export const TIE = [
  [0, 1, 0, 0, 1],
  [0, 0, 1, 1, 1],
  [0, 0, 1, 1, 0],
  [0, 1, 0, 0, 1],
  [0, 0, 1, 0, 1],
  [1, 0, 0, 1, 0],
  [1, 1, 0, 0, 0],
  [0, 1, 1, 0, 1],
];

const cache = new Map<string, { a: number[][]; names: string[] }>();

/** Decode a conformance input (hex columns) to rows of 0/1 and names. */
export function readInput(name: string): { a: number[][]; names: string[] } {
  const hit = cache.get(name);
  if (hit) return hit;
  const x = JSON.parse(readFileSync(join(CONFORMANCE, "inputs", `${name}.json`), "utf8"));
  const a = Array.from({ length: x.rows }, () => new Array<number>(x.cols).fill(0));
  x.columns.forEach((h: string, j: number) => {
    for (let d = 0; d < h.length; d++) {
      const v = parseInt(h[d], 16);
      for (let b = 0; b < 4; b++) {
        const i = d * 4 + b;
        if (i < x.rows && (v >> (3 - b)) & 1) a[i][j] = 1;
      }
    }
  });
  const out = { a, names: x.names as string[] };
  cache.set(name, out);
  return out;
}

export function fixtures(kind: string): any[] {
  return JSON.parse(readFileSync(join(CONFORMANCE, "fixtures", `${kind}.json`), "utf8")).cases;
}

/** Exact harmonic mean size / sum(1 / r_j) as a reduced BigInt fraction [p, q]. */
export function exactPenetration(a: number[][], products: readonly number[]): [bigint, bigint] {
  let num = 0n;
  let den = 1n;
  for (const j of products) {
    const r = BigInt(a.reduce((s, row) => s + row[j], 0));
    num = num * r + den;
    den = den * r;
  }
  return reduce(BigInt(products.length) * den, num);
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function reduce(p: bigint, q: bigint): [bigint, bigint] {
  const g = gcd(p, q);
  return [p / g, q / g];
}

export function parseFraction(s: string): [bigint, bigint] {
  const [p, q] = s.split("/");
  return reduce(BigInt(p), BigInt(q));
}
