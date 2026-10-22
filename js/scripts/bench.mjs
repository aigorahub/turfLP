// Benchmark of the frozen cases of docs/plans/bip-speed.md (B1): warm solves
// of the built package, with the phase times of solver.trace.
//
//   npm run build && node scripts/bench.mjs [--out results.json] [--samples 30]
//     [--warmups 5] [--budget 60] [--only name,name] [--set reduce=off] [--list]
//   node scripts/bench.mjs --freeze   (writes scripts/bench-cases.json)
//
// The cases come from scripts/bench-cases.json, frozen once, so that a fixed
// set taken from a minimum cover does not change between runs. --budget caps
// the measured seconds of a case that is not primary: such a case stops early
// and is marked censored, with its sample count. Primary cases always take
// every sample. Results go to --out as JSON, and a table goes to stdout.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { turf, turfMinCover, loadSolver } from "../dist/index.js";
import { settings, trace } from "../dist/solver.js";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const SAMPLES = Number(arg("samples", 30));
const WARMUPS = Number(arg("warmups", 5));
const BUDGET = Number(arg("budget", 60));
const ONLY = arg("only", null)?.split(",");
const OUT = arg("out", null);
// --set name=value,name=value changes solver.settings, to compare variants.
for (const kv of arg("set", "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  if (!(k in settings)) throw new Error(`unknown setting ${k}`);
  settings[k] = v;
}
const MANIFEST = new URL("./bench-cases.json", import.meta.url);
// The declared primary workloads of the performance gate (docs/plans/bip-speed-log.md, B1-A5).
const PRIMARY = ["gen-bench-200x20/k5", "gen-bench-200x40/k3", "cafe/k3", "cafe/k5", "dup-2000x25/k3",
                 "near-42000/k2/penetration-first"];

const root = new URL("../../conformance/inputs/", import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

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

const INPUTS = {
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

const DEFAULT = ["frequency", "penetration"];
const columnReach = (a) => a[0].map((_, j) => a.reduce((s, row) => s + row[j], 0));
const topReach = (a, k) => columnReach(a).map((r, j) => [r, j]).sort((x, y) => y[0] - x[0] || x[1] - y[1])
  .slice(0, k).map(([, j]) => j).sort((x, y) => x - y);

// The case grid: sizes 3, 5, 8 with the default criteria; reach only and the
// reversed order at size 5; two fixed products of high reach at sizes 2 and 5;
// a fixed set that covers everyone; the later identical twin fixed.
async function casesOf(name, input) {
  const m = columnReach(input.a).filter((r) => r > 0).length;
  const out = [];
  const add = (size, tiebreak, fixed, label) => {
    if (size <= m && size >= fixed.length) out.push({ id: `${name}/${label}`, input: name, size, tiebreak, fixed });
  };
  for (const k of [3, 5, 8]) add(k, DEFAULT, [], `k${k}`);
  add(5, [], [], "k5/reach-only");
  add(5, ["penetration", "frequency"], [], "k5/reversed");
  const two = topReach(input.a, 2);
  add(2, DEFAULT, two, "k2/fixed-top2");
  add(5, DEFAULT, two, "k5/fixed-top2");
  if (name === "identical-300") add(2, DEFAULT, [5], "k2/fixed-later-twin");
  // The near-tie penetration search of the regression fixture.
  if (name === "near-42000") add(2, ["penetration", "frequency"], [], "k2/penetration-first");
  if (input.a.length <= 2500) {
    const cover = (await turfMinCover(input.a)).products;
    add(cover.length, DEFAULT, [...cover], "cover/fixed-cover");
    add(cover.length + 1, DEFAULT, [...cover], "cover+1/fixed-cover");
  }
  return out;
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: q(0.5), p95: q(0.95), min: s[0], max: s.at(-1) };
}

await loadSolver();
const env = {
  node: process.version, arch: process.arch, platform: process.platform,
  highs: JSON.parse(readFileSync(new URL("../node_modules/highs/package.json", import.meta.url), "utf8")).version,
  turflp: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
  commit: execSync("git rev-parse HEAD").toString().trim(),
  lockfile: sha(readFileSync(new URL("../package-lock.json", import.meta.url))),
  samples: SAMPLES, warmups: WARMUPS, budget: BUDGET, settings: { ...settings },
};
if (args.includes("--freeze")) {
  const cases = [];
  for (const [name, make] of Object.entries(INPUTS)) {
    const input = make();
    for (const c of await casesOf(name, input)) cases.push({ ...c, checksum: input.checksum, primary: PRIMARY.includes(c.id) });
  }
  writeFileSync(MANIFEST, JSON.stringify(cases, null, 1) + "\n");
  console.log(`${cases.length} cases written`);
  process.exit(0);
}
const MANIFEST_CASES = JSON.parse(readFileSync(MANIFEST, "utf8"));
if (args.includes("--list")) {
  for (const c of MANIFEST_CASES) console.log(c.id, c.checksum, c.primary ? "primary" : "");
  process.exit(0);
}

const results = [];
for (const [name, make] of Object.entries(INPUTS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const input = make();
  for (const c of MANIFEST_CASES.filter((m) => m.input === name)) {
    if (c.checksum !== input.checksum) throw new Error(`${c.id}: the input changed (checksum ${input.checksum})`);
    const run = async () => {
      const events = [];
      trace.sink = (e) => events.push(e);
      const cpu = process.cpuUsage();
      const t = performance.now();
      const p = await turf(input.a, c.size, { tiebreak: c.tiebreak, fixed: c.fixed, names: input.names });
      const ms = performance.now() - t;
      const used = process.cpuUsage(cpu);
      trace.sink = null;
      return { p, ms, cpuMs: (used.user + used.system) / 1000, events };
    };
    for (let w = 0; w < WARMUPS; w++) await run();
    const totals = [], cpus = [], phases = {}, stages = {}, solveCounts = [], poolCounts = [];
    let first = null, last = null, rss = 0, censored = false;
    const start = performance.now();
    for (let s = 0; s < SAMPLES; s++) {
      const r = await run();
      totals.push(r.ms);
      cpus.push(r.cpuMs);
      const sum = {};
      for (const e of r.events) sum[e.phase] = (sum[e.phase] ?? 0) + e.ms;
      for (const [k, v] of Object.entries(sum)) (phases[k] ??= []).push(v);
      // HiGHS run time by stage; penetration runs after the first are pool solves.
      const byStage = {};
      let pen = 0;
      for (const e of r.events.filter((x) => x.phase === "run")) {
        const key = e.stage === "penetration" && pen++ > 0 ? "penetration pool" : e.stage;
        byStage[key] = (byStage[key] ?? 0) + e.ms;
      }
      for (const [k, v] of Object.entries(byStage)) (stages[k] ??= []).push(v);
      solveCounts.push(r.events.filter((e) => e.phase === "run").length);
      poolCounts.push(Math.max(0, pen - 1));
      first ??= r.events.find((e) => e.phase === "csr");
      last = r.p;
      rss = Math.max(rss, process.memoryUsage().rss);
      if (!c.primary && (performance.now() - start) / 1000 > BUDGET && s + 1 < SAMPLES) { censored = true; break; }
    }
    const row = {
      id: c.id, input: name, checksum: input.checksum, size: c.size, tiebreak: c.tiebreak, fixed: c.fixed,
      respondents: input.a.length, products: input.a[0].length,
      total: stats(totals), cpu: stats(cpus),
      primary: c.primary,
      phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, stats(v).median])),
      stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, stats(v).median])),
      solves: stats(solveCounts).median, poolSolves: stats(poolCounts).median,
      model: first && { rows: first.rows, cols: first.cols, nnz: first.nnz },
      rssMB: Math.round(rss / 2 ** 20), censored,
      result: { products: last.products, reach: last.reach, frequency: last.frequency,
                penetration: last.penetration, warnings: last.warnings.length },
    };
    results.push(row);
    const ph = row.phases;
    console.log([row.id.padEnd(36), `n=${row.total.n}${censored ? "*" : ""}`,
      `median ${row.total.median.toFixed(1)} ms`, `p95 ${row.total.p95.toFixed(1)}`,
      `solves ${row.solves} pool ${row.poolSolves}`, `model ${row.model?.rows}x${row.model?.cols}/${row.model?.nnz}`,
      `prep ${(ph.prepare ?? 0).toFixed(1)} csr ${(ph.csr ?? 0).toFixed(1)} pass ${(ph.passModel ?? 0).toFixed(1)} run ${(ph.run ?? 0).toFixed(1)} check ${(ph.check ?? 0).toFixed(1)}`,
      Object.entries(row.stages).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" "),
      `rss ${row.rssMB} MB`].join("  "));
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify({ env, results }, null, 1));
