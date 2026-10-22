// The performance gate of docs/plans/bip-speed.md: the primary workloads,
// solved by a reference build and by this build under named settings, with the
// variants interleaved in every round so that machine load hits them alike.
//
//   npm run build && node scripts/gate.mjs --base <js folder of the reference, built>
//     [--variants name:key=value+key=value,...] [--samples 30] [--warmups 5]
//     [--only case,case] [--out gate.json]
//
// Gate: at least 20% lower median total time on a primary workload, and no
// variant more than 10% slower at p95 on any case. Every variant must return
// the same reach, frequency, and penetration (relative 1e-12) as the reference.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { INPUTS, PRIMARY, stats } from "./bench-inputs.mjs";
import * as current from "../dist/index.js";
import { settings } from "../dist/solver.js";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const SAMPLES = Number(arg("samples", 30));
const WARMUPS = Number(arg("warmups", 5));
const ONLY = arg("only", null)?.split(",") ?? PRIMARY;
const OUT = arg("out", null);
const baseDir = arg("base", null);
if (!baseDir) throw new Error("--base <js folder> is required");
const base = await import(pathToFileURL(`${baseDir}/dist/index.js`).href);

// name:key=value+key=value; the settings of this build that each variant uses.
const defaults = { ...settings };
const variants = arg("variants", "current:")
  .split(",").map((v) => {
    const [name, spec = ""] = v.split(":");
    const set = Object.fromEntries(spec.split("+").filter(Boolean).map((kv) => kv.split("=")));
    for (const k of Object.keys(set)) if (!(k in settings)) throw new Error(`unknown setting ${k}`);
    return { name, set };
  });

const manifest = JSON.parse(readFileSync(new URL("./bench-cases.json", import.meta.url), "utf8"));
await base.loadSolver();
await current.loadSolver();

const cpuMs = (u) => (u.user + u.system) / 1000;
async function once(run, c, input) {
  const cpu = process.cpuUsage();
  const t = performance.now();
  const p = await run.turf(input.a, c.size, { tiebreak: c.tiebreak, fixed: c.fixed, names: input.names });
  return { ms: performance.now() - t, cpu: cpuMs(process.cpuUsage(cpu)), p };
}
const runners = [{ name: "base", turf: base.turf, set: null },
                 ...variants.map((v) => ({ name: v.name, turf: current.turf, set: v.set }))];
const prepare = (r) => { if (r.set) Object.assign(settings, defaults, r.set); };

const same = (a, b) => a.reach === b.reach && a.frequency === b.frequency &&
  Math.abs(a.penetration - b.penetration) <= 1e-12 * Math.max(1, Math.abs(a.penetration));

const report = [];
for (const id of ONLY) {
  const c = manifest.find((m) => m.id === id);
  if (!c) throw new Error(`no case ${id}`);
  const input = INPUTS[c.input]();
  if (input.checksum !== c.checksum) throw new Error(`${id}: the input changed`);
  for (let w = 0; w < WARMUPS; w++) for (const r of runners) { prepare(r); await once(r, c, input); }
  const times = Object.fromEntries(runners.map((r) => [r.name, { ms: [], cpu: [] }]));
  const mismatch = new Set();
  for (let s = 0; s < SAMPLES; s++) {
    // Rotate the order each round.
    for (let k = 0; k < runners.length; k++) {
      const r = runners[(s + k) % runners.length];
      prepare(r);
      const o = await once(r, c, input);
      times[r.name].ms.push(o.ms);
      times[r.name].cpu.push(o.cpu);
      times[r.name].last = o.p;
    }
    for (const r of runners.slice(1)) if (!same(times.base.last, times[r.name].last)) mismatch.add(r.name);
  }
  const b = stats(times.base.ms);
  const row = { id, base: { ...b, cpu: stats(times.base.cpu).median } , variants: {} };
  const line = [`${id.padEnd(36)} base ${b.median.toFixed(1)} ms (p95 ${b.p95.toFixed(1)})`];
  for (const r of runners.slice(1)) {
    const v = stats(times[r.name].ms);
    const gain = 1 - v.median / b.median;
    const p95 = v.p95 / b.p95 - 1;
    row.variants[r.name] = { ...v, cpu: stats(times[r.name].cpu).median, gain, p95Change: p95,
                             same: !mismatch.has(r.name) };
    line.push(`${r.name} ${v.median.toFixed(1)} (${(100 * gain).toFixed(0)}% faster, p95 ${(100 * p95).toFixed(0)}%)` +
              (mismatch.has(r.name) ? " DIFFERENT RESULT" : ""));
  }
  report.push(row);
  console.log(line.join("  "));
}
Object.assign(settings, defaults);
if (OUT) writeFileSync(OUT, JSON.stringify({ samples: SAMPLES, warmups: WARMUPS, variants, report }, null, 1));
