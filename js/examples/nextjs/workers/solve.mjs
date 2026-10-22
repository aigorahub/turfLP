// The solver worker of lib/supervisor.ts: loads turflp once, then answers one
// { id, reach, size, options } message at a time. Input errors of the package
// are TypeError or RangeError; every other error is a solver failure.
import { parentPort } from "node:worker_threads";
import { loadSolver, turf } from "turflp";

const ready = loadSolver();

parentPort.on("message", async ({ id, reach, size, options }) => {
  try {
    await ready;
    const t = performance.now();
    const portfolio = await turf(reach, size, options);
    // The JSON form the route returns, so the reply clones without loss.
    parentPort.postMessage({ id, ok: true, value: { portfolio: JSON.parse(JSON.stringify(portfolio)),
                                                     ms: performance.now() - t } });
  } catch (e) {
    const input = e instanceof TypeError || e instanceof RangeError;
    parentPort.postMessage({ id, ok: false, kind: input ? "input" : "internal", message: String(e?.message ?? e) });
  }
});
