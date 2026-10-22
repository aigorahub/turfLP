import { ask, instance, mem, started, startWorker } from "../shared";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  const t0 = performance.now();
  const { worker, loadMs } = await startWorker();
  const startMs = performance.now() - t0;
  const r = await ask(worker, { id: 1, input: "bench-200x20", size: 5 });
  await worker.terminate();
  return Response.json({ instance, ageMs: Date.now() - started, startMs, loadMs, ...r, rssMB: mem() });
}
