// Build this example against the packed turflp package, copy the traced
// standalone output to a folder outside the checkout, start it there, and
// check the fixed 200 x 20 benchmark (conformance input gen-bench-200x20,
// size 5) against the exact expected values.
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
for (const f of ["package.json", "next.config.mjs", "tsconfig.json", "app"]) {
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

const port = 3000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ["server.js"], {
  cwd: serveDir, env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" }, stdio: "inherit",
});
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 200));
    ready = await fetch(`http://127.0.0.1:${port}/api/turf`, { method: "HEAD" }).then(() => true, () => false);
  }
  if (!ready) throw new Error("server did not start");
  for (const label of ["cold", "warm"]) {
    const t = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/turf`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reach, size: 5, names: input.names }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
    const p = body.portfolio;
    const ok = p.reach === expected.reach && p.frequency === expected.frequency &&
      Math.abs(p.penetration - expected.penetration.value) <= 1e-12 * expected.penetration.value &&
      p.warnings.length === 0;
    console.log(`${label}: reach ${p.reach}, frequency ${p.frequency}, penetration ${p.penetration}, ` +
                `solve ${body.ms.toFixed(0)} ms, request ${(performance.now() - t).toFixed(0)} ms`);
    if (!ok) throw new Error(`unexpected result; expected ${JSON.stringify(expected)}`);
  }
  console.log("standalone test passed");
} finally {
  server.kill();
  rmSync(serveDir, { recursive: true, force: true });
  rmSync(packDir, { recursive: true, force: true });
}
