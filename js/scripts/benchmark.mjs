// Time a cold solver load and warm solves for fixed inputs, using the built
// package (npm run build first). Run from js/: node scripts/benchmark.mjs
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { turf, loadSolver } from "../dist/index.js";

function input(name) {
  const x = JSON.parse(readFileSync(new URL(`../../conformance/inputs/${name}.json`, import.meta.url), "utf8"));
  const a = Array.from({ length: x.rows }, () => new Array(x.cols).fill(0));
  x.columns.forEach((h, j) => {
    for (let d = 0; d < h.length; d++) {
      for (let b = 0; b < 4; b++) {
        const i = d * 4 + b;
        if (i < x.rows && (parseInt(h[d], 16) >> (3 - b)) & 1) a[i][j] = 1;
      }
    }
  });
  return a;
}

let t = performance.now();
await loadSolver();
console.log(`cold solver load: ${(performance.now() - t).toFixed(0)} ms`);
const cases = [
  ["gen-bench-200x20", 5, ["frequency", "penetration"]],
  ["gen-bench-200x40", 8, ["frequency", "penetration"]],
  ["flood-402", 2, ["penetration", "frequency"]],
];
for (const [name, size, tiebreak] of cases) {
  const a = input(name);
  const times = [];
  for (let i = 0; i < 3; i++) {
    t = performance.now();
    await turf(a, size, { tiebreak, maxPoolSeconds: Infinity });
    times.push(performance.now() - t);
  }
  times.sort((x, y) => x - y);
  console.log(`${name} (${a.length} x ${a[0].length}), size ${size}, ${tiebreak.join(" then ")}: ` +
              `median ${times[1].toFixed(0)} ms`);
}
console.log(`Node.js ${process.version}, ${cpus()[0].model}`);
