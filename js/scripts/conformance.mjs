// Run the shared conformance fixtures (conformance/README.md) and the large
// regression cases against the built package, with presolve on and off.
// Plain Node.js, because each solve blocks the thread for a long time on the
// largest inputs, which a test runner's worker messages do not tolerate.
//
// Run from js/ after `npm run build`: node scripts/conformance.mjs
import { readFileSync } from "node:fs";
import { turf, turfMinCover, turfSizes } from "../dist/index.js";
import { worseOnEarlier } from "../dist/core.js";
import { loadedSolver, settings } from "../dist/solver.js";

const root = new URL("../../conformance/", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const inputs = new Map();
function input(name) {
  if (inputs.has(name)) return inputs.get(name);
  const x = read(`inputs/${name}.json`);
  const a = Array.from({ length: x.rows }, () => new Array(x.cols).fill(0));
  x.columns.forEach((h, j) => {
    for (let d = 0; d < h.length; d++) {
      for (let b = 0; b < 4; b++) {
        const i = d * 4 + b;
        if (i < x.rows && (parseInt(h[d], 16) >> (3 - b)) & 1) a[i][j] = 1;
      }
    }
  });
  const out = { a, names: x.names };
  inputs.set(name, out);
  return out;
}

const failures = [];
const check = (ok, id, msg) => { if (!ok) failures.push(`${id}: ${msg}`); };

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; }
function exactPenetration(a, products) {
  let num = 0n, den = 1n;
  for (const j of products) {
    const r = BigInt(a.reduce((s, row) => s + row[j], 0));
    num = num * r + den; den *= r;
  }
  const p = BigInt(products.length) * den, g = gcd(p, num);
  return `${p / g}/${num / g}`;
}
function reduced(s) {
  const [p, q] = s.split("/").map(BigInt), g = gcd(p, q);
  return `${p / g}/${q / g}`;
}

function checkFields(id, a, names, p) {
  const sel = [...p.products];
  const r = sel.map((j) => a.reduce((s, row) => s + row[j], 0));
  const reached = a.filter((row) => sel.some((j) => row[j] === 1)).length;
  const h = sel.length / r.reduce((s, x) => s + 1 / x, 0);
  const ok = new Set(sel).size === sel.length && p.size === sel.length &&
    JSON.stringify(p.names) === JSON.stringify(sel.map((j) => names[j])) &&
    p.reach === reached && p.respondents === a.length && p.reachProp === reached / a.length &&
    p.frequency === r.reduce((s, x) => s + x, 0) && Math.abs(p.penetration - h) <= 1e-12 * h;
  check(ok, id, "reported fields do not match the selected products");
}
function checkExpected(id, a, p, e) {
  check(p.reach === e.reach, id, `reach ${p.reach}, expected ${e.reach}`);
  if ("frequency" in e) check(p.frequency === e.frequency, id, `frequency ${p.frequency}, expected ${e.frequency}`);
  if ("penetration" in e) {
    const got = exactPenetration(a, p.products);
    check(got === reduced(e.penetration.fraction), id, `penetration ${got}, expected ${e.penetration.fraction}`);
  }
}

const counts = {};
const count = (k) => { counts[k] = (counts[k] ?? 0) + 1; };

for (const presolve of ["on", "off"]) {
  settings.presolve = presolve;
  for (const c of read("fixtures/turf.json").cases) {
    const { a, names } = input(c.input);
    const p = await turf(a, c.size, { tiebreak: c.tiebreak, names, maxPoolSeconds: Infinity });
    check(p.warnings.length === 0, c.id, `warnings ${JSON.stringify(p.warnings)}`);
    checkFields(c.id, a, names, p);
    checkExpected(c.id, a, p, c.expected);
    count(`turf (presolve ${presolve})`);
  }
  for (const c of read("fixtures/min_cover.json").cases) {
    const { a, names } = input(c.input);
    const p = await turfMinCover(a, { names });
    checkFields(c.id, a, names, p);
    check(p.size === c.expected.size && p.reach === c.expected.reachable, c.id,
          `cover size ${p.size} reach ${p.reach}`);
    count(`min_cover (presolve ${presolve})`);
  }
  for (const c of read("fixtures/sizes.json").cases) {
    const { a, names } = input(c.input);
    const rows = await turfSizes(a, c.sizes, { tiebreak: c.tiebreak, names, maxPoolSeconds: Infinity });
    check(JSON.stringify(rows.map((p) => p.size)) === JSON.stringify(c.expected.map((e) => e.size)),
          c.id, "sizes");
    rows.forEach((p, i) => { checkFields(c.id, a, names, p); checkExpected(`${c.id}[${i}]`, a, p, c.expected[i]); });
    count(`sizes (presolve ${presolve})`);
  }
  for (const c of read("fixtures/bounded.json").cases) {
    const { a, names } = input(c.input);
    const p = await turf(a, c.size, { tiebreak: c.tiebreak, names, maxPool: c.max_pool,
                                      maxPoolSeconds: c.max_pool_seconds ?? Infinity });
    check(JSON.stringify(p.warnings) === JSON.stringify(c.warnings), c.id,
          `warnings ${JSON.stringify(p.warnings)}`);
    checkFields(c.id, a, names, p);
    checkExpected(c.id, a, p, c.expected);
    count(`bounded (presolve ${presolve})`);
  }
}
settings.presolve = "on";

const obj = { name: "x", direction: "min", value: (v) => v };
for (const c of read("fixtures/comparator.json").cases) {
  check(worseOnEarlier([obj], c.new, c.old, c.size) === c.worse, JSON.stringify(c), "comparator");
  count("comparator");
}

// Large regression cases from tests/testthat/test-turf.R.
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
let p = await turf(input("stage-40000").a, 2, { tiebreak: ["penetration", "frequency"] });
check(same(p.products, [0, 1]) && p.penetration === 20000, "stage-40000", JSON.stringify(p.products));
p = await turf(input("retry-35043").a, 2, { tiebreak: ["penetration", "frequency"] });
check(same(p.products, [2, 3]) && p.frequency === 42720, "retry-35043", JSON.stringify(p.products));
p = await turf(input("near-42000").a, 2, { tiebreak: ["penetration", "frequency"] });
check(same(p.products, [0, 1]), "near-42000", JSON.stringify(p.products));
p = await turf(input("flood-402").a, 2, { tiebreak: ["penetration", "frequency"], maxPoolSeconds: Infinity });
check(same(p.products, [400, 401]) && p.warnings.length === 0, "flood-402", JSON.stringify(p));
p = await turf(input("flood-402").a, 2, { tiebreak: ["penetration", "frequency"], maxPool: 50,
                                           maxPoolSeconds: Infinity });
check(same(p.products, [400, 401]) && /penetration optimum stopped/.test(p.warnings.join(" ")),
      "flood-402 max_pool 50", JSON.stringify(p));
counts.regression = 5;

const v = loadedSolver().version;
console.log(`highs ${v.string} (${v.gitHash})`);
for (const [k, n] of Object.entries(counts)) console.log(`${k}: ${n} cases`);
if (failures.length) {
  console.log(`${failures.length} failures`);
  console.log(failures.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log("all conformance fixtures pass");
