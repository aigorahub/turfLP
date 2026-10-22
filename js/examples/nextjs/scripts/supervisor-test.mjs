// The admission, deadline, and crash rules of lib/supervisor.ts and the keys and
// bounds of lib/cache.ts, with a stand-in worker that sleeps, fails, or exits
// on request. scripts/standalone-test.mjs checks the real solver worker.
//
// Run from js/examples/nextjs: node --experimental-strip-types scripts/supervisor-test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, ResultCache } from "../lib/cache.ts";
import { Supervisor } from "../lib/supervisor.ts";

const dir = mkdtempSync(join(tmpdir(), "turflp-supervisor-"));
const script = join(dir, "worker.mjs");
writeFileSync(script, `
import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ id, op, ms }) => {
  if (op === "exit") process.exit(1);
  if (op === "input") return parentPort.postMessage({ id, ok: false, kind: "input", message: "bad size" });
  if (op === "internal") return parentPort.postMessage({ id, ok: false, kind: "internal", message: "HiGHS" });
  // A busy wait: like a solve, it blocks the worker until it ends.
  const end = Date.now() + ms;
  while (Date.now() < end);
  parentPort.postMessage({ id, ok: true, value: ms });
});
`);

const sleep = (ms) => ({ op: "sleep", ms });
let failed = 0;
async function check(name, f) {
  try {
    await f();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${e.stack}`);
  }
}

await check("one active and four queued jobs are admitted; the sixth gets 503", async () => {
  const s = new Supervisor({ script, queueCap: 4, deadlineMs: 10_000 });
  const out = await Promise.all(Array.from({ length: 6 }, () => s.run(sleep(50))));
  assert.deepEqual(out.map((o) => (o.ok ? 200 : o.status)), [200, 200, 200, 200, 200, 503]);
  assert.equal(s.load, 0);
});

await check("a job past the deadline gets 504; its worker is replaced", async () => {
  const s = new Supervisor({ script, queueCap: 4, deadlineMs: 300 });
  const t = performance.now();
  const late = await s.run(sleep(5_000));
  assert.equal(late.ok ? 200 : late.status, 504);
  assert.ok(performance.now() - t < 1_000, "the deadline did not stop the job");
  assert.deepEqual(await s.run(sleep(10)), { ok: true, value: 10 });
});

await check("a queued job past the deadline gets 504 without running", async () => {
  const s = new Supervisor({ script, queueCap: 4, deadlineMs: 300 });
  const [a, b] = await Promise.all([s.run(sleep(5_000)), s.run(sleep(10))]);
  assert.deepEqual([a, b].map((o) => (o.ok ? 200 : o.status)), [504, 504]);
  assert.deepEqual(await s.run(sleep(10)), { ok: true, value: 10 });
});

await check("a worker that exits fails only its own job", async () => {
  const s = new Supervisor({ script, queueCap: 4, deadlineMs: 10_000 });
  const out = await Promise.all([s.run({ op: "exit" }), s.run(sleep(10)), s.run(sleep(20))]);
  assert.deepEqual(out.map((o) => (o.ok ? o.value : o.status)), [500, 10, 20]);
});

await check("input errors get 400 with the message; solver errors get 500", async () => {
  const s = new Supervisor({ script, queueCap: 4, deadlineMs: 10_000 });
  assert.deepEqual(await s.run({ op: "input" }), { ok: false, status: 400, error: "bad size" });
  assert.deepEqual(await s.run({ op: "internal" }), { ok: false, status: 500, error: "the solver failed" });
});

await check("an aborted request leaves the queue; the active job finishes", async () => {
  const s = new Supervisor({ script, queueCap: 4, deadlineMs: 10_000 });
  const ac = new AbortController();
  const a = s.run(sleep(200), ac.signal);
  const b = s.run(sleep(10), ac.signal);
  ac.abort();
  assert.equal((await b).ok ? 200 : (await b).status, 499);
  assert.deepEqual(await a, { ok: true, value: 200 });
});

await check("cache keys: fixed sets as the package reads them; every other field counts", () => {
  const base = { version: "1", reach: [[1, 0], [0, 1]], size: 1, fixed: undefined, tiebreak: undefined, names: undefined };
  const k = cacheKey(base);
  assert.equal(cacheKey({ ...base, fixed: [] }), k);
  assert.equal(cacheKey({ ...base, fixed: null }), k);
  assert.equal(cacheKey({ ...base, fixed: [1, 0, 1] }), cacheKey({ ...base, fixed: [0, 1] }));
  for (const change of [{ version: "2" }, { reach: [[1, 0], [1, 1]] }, { size: 2 }, { fixed: [0] },
                        { tiebreak: ["penetration"] }, { names: ["a", "b"] }]) {
    assert.notEqual(cacheKey({ ...base, ...change }), k, JSON.stringify(change));
  }
});

await check("the cache keeps its byte bound and drops old entries", () => {
  const c = new ResultCache(100, 1_000);
  c.set("a", "x".repeat(60), 0);
  c.set("b", "y".repeat(30), 0);
  assert.equal(c.get("a", 10), "x".repeat(60));
  c.set("c", "z".repeat(30), 10);
  // "b" is the least recently used entry.
  assert.deepEqual([c.get("a", 20), c.get("b", 20), c.get("c", 20)], ["x".repeat(60), undefined, "z".repeat(30)]);
  assert.ok(c.size <= 100);
  c.set("big", "w".repeat(101), 30);
  assert.equal(c.get("big", 30), undefined);
  assert.equal(c.get("c", 2_000), undefined);
});

rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.log(`${failed} supervisor checks failed`);
  process.exit(1);
}
console.log("supervisor test passed");
// Stand-in workers of passed checks have finished; exit without waiting on timers.
process.exit(0);
