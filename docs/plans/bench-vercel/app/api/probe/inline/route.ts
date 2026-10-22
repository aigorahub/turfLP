import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSolver, turf } from "turflp";
import { nextServed, region, instance, mem, started } from "../shared";
export const runtime = "nodejs";
export const maxDuration = 60;
const ready = loadSolver();
export async function GET() {
  const served = nextServed();
  const t0 = performance.now();
  await ready;
  const { reach, names } = JSON.parse(readFileSync(join(process.cwd(), "workers", "bench-200x20.json"), "utf8"));
  const t = performance.now();
  const p = await turf(reach, 5, { names });
  return Response.json({ instance, served, region, ageMs: Date.now() - started, waitMs: t - t0, ms: performance.now() - t,
                         reach: p.reach, frequency: p.frequency, rssMB: mem() });
}
