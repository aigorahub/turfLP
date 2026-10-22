// A solver worker: loads turflp once, then answers { id, input, size, spin } messages.
import { parentPort } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { loadSolver, turf } from "turflp";
const t0 = performance.now();
await loadSolver();
const loadMs = performance.now() - t0;
const inputs = {};
parentPort.on("message", async (m) => {
  inputs[m.input] ??= JSON.parse(readFileSync(new URL(`./${m.input}.json`, import.meta.url), "utf8"));
  const { reach, names } = inputs[m.input];
  const t = performance.now();
  try {
    let p;
    for (let k = 0; k < (m.repeat ?? 1); k++) p = await turf(reach, m.size, { names });
    parentPort.postMessage({ id: m.id, input: m.input, size: m.size, rows: reach.length, ok: true, ms: performance.now() - t, loadMs, reach: p.reach, frequency: p.frequency, products: p.products });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: String(e) });
  }
});
parentPort.postMessage({ ready: true, loadMs });
