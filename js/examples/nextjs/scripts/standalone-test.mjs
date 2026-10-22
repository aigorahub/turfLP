// Build this example against the packed turflp package, copy the traced
// standalone output to a folder outside the checkout, start it there, and
// check the fixed 200 x 20 benchmark (conformance input gen-bench-200x20,
// size 5) against the exact expected values. Then check the HTTP rules: fixed
// products, the 400 and 413 answers, a burst past the queue (503), and, on a
// second server with a short deadline, 504 and recovery.
//
// Run from js/examples/nextjs: node scripts/standalone-test.mjs
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const jsDir = join(here, "..", "..");
const conformance = join(jsDir, "..", "conformance");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

// 1. Pack turflp.
const packDir = mkdtempSync(join(tmpdir(), "turflp-pack-"));
run(npm, ["run", "build"], jsDir);
run(npm, ["pack", "--pack-destination", packDir], jsDir);
const tarball = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz")));

// 2. Build a copy of the example with the tarball installed.
const buildDir = mkdtempSync(join(tmpdir(), "turflp-next-build-"));
for (const f of ["package.json", "next.config.mjs", "tsconfig.json", "app", "lib", "workers"]) {
  cpSync(join(here, f), join(buildDir, f), { recursive: true });
}
run(npm, ["install", "--no-audit", "--no-fund"], buildDir);
run(npm, ["install", "--no-audit", "--no-fund", "--no-save", tarball], buildDir);
run(npm, ["run", "build"], buildDir);

// 3. Copy only the traced output to a fresh folder and delete the build.
const serveDir = mkdtempSync(join(tmpdir(), "turflp-next-serve-"));
// Keep relative symlinks as they are: Turbopack links .next/node_modules/<pkg>-<hash>
// to ../../node_modules/<pkg>, which must still resolve after the copy.
cpSync(join(buildDir, ".next", "standalone"), serveDir, { recursive: true, verbatimSymlinks: true });
cpSync(join(buildDir, ".next", "static"), join(serveDir, ".next", "static"), { recursive: true });
if (!process.env.KEEP_BUILD) rmSync(buildDir, { recursive: true, force: true });
else console.log(`build kept at ${buildDir}`);
const wasm = join(serveDir, "node_modules", "highs", "build", "highs.wasm");
if (!existsSync(wasm)) throw new Error("highs.wasm is not in the traced output");
if (!existsSync(join(serveDir, "workers", "solve.mjs"))) throw new Error("workers/solve.mjs is not in the traced output");
console.log(`traced highs.wasm: ${statSync(wasm).size} bytes`);

// 4. Start the traced server and send the benchmark twice (cold, then warm).
const input = JSON.parse(readFileSync(join(conformance, "inputs", "gen-bench-200x20.json"), "utf8"));
const reach = Array.from({ length: input.rows }, () => new Array(input.cols).fill(0));
input.columns.forEach((h, j) => {
  for (let d = 0; d < h.length; d++) {
    for (let b = 0; b < 4; b++) {
      const i = d * 4 + b;
      if (i < input.rows && (parseInt(h[d], 16) >> (3 - b)) & 1) reach[i][j] = 1;
    }
  }
});
const expected = JSON.parse(readFileSync(join(conformance, "fixtures", "turf.json"), "utf8"))
  .cases.find((c) => c.id === "gen-bench-200x20/k5/frequency+penetration").expected;

// Starts the traced server; resolves to its URL and a stop function.
async function start(env = {}) {
  const port = 3000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: serveDir, env: { ...process.env, ...env, PORT: String(port), HOSTNAME: "127.0.0.1" }, stdio: "inherit",
  });
  const url = `http://127.0.0.1:${port}/api/turf`;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await fetch(url, { method: "HEAD" }).then(() => true, () => false)) return { url, stop: () => server.kill() };
  }
  server.kill();
  throw new Error("server did not start");
}
const post = async (url, body) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
                                 body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const expectStatus = (label, res, status) => {
  console.log(`${label}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 100)}`);
  if (res.status !== status) throw new Error(`${label}: expected HTTP ${status}`);
};
// The README example: 8 respondents, 5 products.
const small = [[0, 1, 0, 0, 1], [0, 0, 1, 1, 1], [0, 0, 1, 1, 0], [0, 1, 0, 0, 1], [0, 0, 1, 0, 1], [1, 0, 0, 1, 0],
               [1, 1, 0, 0, 0], [0, 1, 1, 0, 1]];

const servers = [];
try {
  const main = await start();
  servers.push(main);
  // Cold, then the same request again from the result cache.
  for (const label of ["cold", "cached"]) {
    const t = performance.now();
    const res = await post(main.url, { reach, size: 5, names: input.names });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    const p = res.body.portfolio;
    const ok = p.reach === expected.reach && p.frequency === expected.frequency &&
      Math.abs(p.penetration - expected.penetration.value) <= 1e-12 * expected.penetration.value &&
      p.warnings.length === 0 && res.body.cached === (label === "cached");
    console.log(`${label}: reach ${p.reach}, frequency ${p.frequency}, penetration ${p.penetration}, ` +
                `solve ${res.body.ms.toFixed(0)} ms, request ${(performance.now() - t).toFixed(0)} ms`);
    if (!ok) throw new Error(`unexpected result; expected ${JSON.stringify(expected)}`);
  }

  // fixed reaches the package: product 0 is in the portfolio although the best pair leaves it out.
  const free = await post(main.url, { reach: small, size: 2 });
  const fixed = await post(main.url, { reach: small, size: 2, fixed: [0] });
  expectStatus("fixed", fixed, 200);
  if (free.body.portfolio.products.includes(0) || !fixed.body.portfolio.products.includes(0)) {
    throw new Error(`fixed was not applied: ${JSON.stringify([free.body, fixed.body])}`);
  }
  expectStatus("malformed JSON", await post(main.url, "{reach:"), 400);
  // JSON 1e309 is Infinity: a cached answer for null must not answer it.
  expectStatus("tiebreak null", await post(main.url, { reach: [[1]], size: 1, tiebreak: null }), 200);
  expectStatus("tiebreak 1e309", await post(main.url, '{"reach": [[1]], "size": 1, "tiebreak": 1e309}'), 400);
  await post(main.url, { reach: [[1]], size: 1, names: [null] });
  const inf = await post(main.url, '{"reach": [[1]], "size": 1, "names": [1e309]}');
  if (inf.status !== 200 || inf.body.portfolio.names[0] !== "Infinity") {
    throw new Error(`names [1e309]: ${JSON.stringify(inf)}`);
  }
  expectStatus("fixed out of range", await post(main.url, { reach: small, size: 2, fixed: [9] }), 400);
  expectStatus("a cell that is not 0 or 1", await post(main.url, { reach: [[0, 2]], size: 1 }), 400);
  expectStatus("too many cells", await post(main.url, { reach: [new Array(8001).fill(1)], size: 1 }), 413);
  expectStatus("size over the request limit", await post(main.url, { reach: small, size: 9 }), 413);
  expectStatus("body over the byte limit", await post(main.url, `{"reach": [[1]], "pad": "${"x".repeat(600_000)}"}`), 413);

  // One active and four queued requests; the sixth is turned away.
  const burst = await Promise.all(Array.from({ length: 6 }, (_, k) =>
    post(main.url, { reach, size: 3 + (k % 3), tiebreak: k < 3 ? ["frequency", "penetration"] : ["penetration"] })));
  const codes = burst.map((r) => r.status).sort();
  console.log(`burst of 6: ${codes.join(" ")}`);
  if (codes.join(" ") !== "200 200 200 200 200 503") throw new Error("expected five answers and one 503");

  // A short deadline: the solve is stopped with 504, and a new worker answers the next request.
  const short = await start({ TURFLP_JOB_DEADLINE_MS: "250" });
  servers.push(short);
  expectStatus("past the deadline", await post(short.url, { reach, size: 3 }), 504);
  expectStatus("after the deadline", await post(short.url, { reach: small, size: 2 }), 200);
  console.log("standalone test passed");
} finally {
  for (const s of servers) s.stop();
  rmSync(serveDir, { recursive: true, force: true });
  rmSync(packDir, { recursive: true, force: true });
}
