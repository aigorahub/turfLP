import { nextServed, region, ask, instance, mem, started, startWorker } from "../shared";
export const runtime = "nodejs";
export const maxDuration = 60;
// Start a long solve in a worker, terminate it after 300 ms, then prove the
// capacity comes back: a new worker solves the small case.
export async function GET() {
  const served = nextServed();
  const before = mem();
  const { worker } = await startWorker();
  const long = ask(worker, { id: 1, input: "bench-200x20", size: 5, repeat: 50 }).then((m) => ({ finished: m }), (e) => ({ error: String(e) }));
  await new Promise((r) => setTimeout(r, 300));
  const t = performance.now();
  const code = await worker.terminate();
  const terminateMs = performance.now() - t;
  const outcome = await Promise.race([long, new Promise((r) => setTimeout(() => r("pending"), 50))]);
  const during = mem();
  const next = await startWorker();
  const r = await ask(next.worker, { id: 2, input: "bench-200x20", size: 5 });
  await next.worker.terminate();
  return Response.json({ instance, served, region, ageMs: Date.now() - started, exitCode: code, terminateMs, longOutcome: outcome,
                         rssBeforeMB: before, rssAfterTerminateMB: during, rssEndMB: mem(), next: r });
}
