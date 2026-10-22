// The frozen benchmark inputs of docs/plans/bip-speed.md (B1), shared by
// bench.mjs and gate.mjs. Each input carries a checksum, and the case manifest
// (bench-cases.json) records the checksum it was frozen with.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../../conformance/inputs/", import.meta.url);
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

function conformanceInput(name) {
  const text = readFileSync(new URL(`${name}.json`, root));
  const x = JSON.parse(text);
  const a = Array.from({ length: x.rows }, () => new Array(x.cols).fill(0));
  x.columns.forEach((h, j) => {
    for (let d = 0; d < h.length; d++) {
      for (let b = 0; b < 4; b++) {
        const i = d * 4 + b;
        if (i < x.rows && (parseInt(h[d], 16) >> (3 - b)) & 1) a[i][j] = 1;
      }
    }
  });
  return { a, names: x.names, source: `conformance/inputs/${name}.json`, checksum: sha(text) };
}

// Seeded generator, so the synthetic inputs are frozen by their seed.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function synthetic(name, rows, cols, seed, cell) {
  const next = rng(seed);
  const a = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => cell(next, i, j)));
  return { a, names: Array.from({ length: cols }, (_, j) => `P${j + 1}`), source: `synthetic seed ${seed}`,
           checksum: sha(a.map((r) => r.join("")).join("\n")) };
}
// Many respondents that share few distinct patterns.
function duplicated(rows, cols, patterns, seed) {
  const next = rng(seed);
  const pats = Array.from({ length: patterns }, () => Array.from({ length: cols }, () => (next() < 0.25 ? 1 : 0)));
  return synthetic("dup", rows, cols, seed + 1, (r, i, j) => pats[Math.floor(rng(seed + 2 + i)() * patterns)][j]);
}

export const INPUTS = {
  "gen-bench-200x20": () => conformanceInput("gen-bench-200x20"),
  "gen-bench-200x40": () => conformanceInput("gen-bench-200x40"),
  ham: () => conformanceInput("data-ham"),
  icecream: () => conformanceInput("data-icecream"),
  cafe: () => conformanceInput("data-cafe"),
  "identical-300": () => conformanceInput("identical-300"),
  "near-42000": () => conformanceInput("near-42000"),
  "sparse-1000x30": () => synthetic("sparse", 1000, 30, 101, (r) => (r() < 0.05 ? 1 : 0)),
  "dense-1000x30": () => synthetic("dense", 1000, 30, 102, (r) => (r() < 0.5 ? 1 : 0)),
  "dup-2000x25": () => duplicated(2000, 25, 40, 103),
  "unique-500x30": () => synthetic("unique", 500, 30, 104, (r) => (r() < 0.3 ? 1 : 0)),
};

// The declared primary workloads of the performance gate (docs/plans/bip-speed-log.md, B1-A5).
export const PRIMARY = ["gen-bench-200x20/k5", "gen-bench-200x40/k3", "cafe/k3", "cafe/k5", "dup-2000x25/k3",
                        "near-42000/k2/penetration-first"];

export function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: q(0.5), p95: q(0.95), min: s[0], max: s.at(-1) };
}
