// POST /api/turf with JSON { reach: number[][], size: number, tiebreak?: string[],
// names?: string[], fixed?: number[] }. Returns { portfolio, ms, cached }: the
// portfolio (including `warnings`), the solve time in milliseconds, and whether
// the answer came from the result cache. Errors are { error } with the status
// codes listed in the README.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheKey, ResultCache } from "../../../lib/cache";
import { Supervisor } from "../../../lib/supervisor";

// The solver is WebAssembly in a worker thread; the Edge runtime has neither.
export const runtime = "nodejs";
export const maxDuration = 60;

// Admission rule for solving inside a request (see the turflp README). Larger
// problems belong in a background job (for example an Inngest function).
const MAX_CELLS = 200 * 40;
const MAX_SIZE = 8;
const MAX_BYTES = 512 * 1024;
// Whole job, queue time included, with a margin below maxDuration.
const DEADLINE_MS = Number(process.env.TURFLP_JOB_DEADLINE_MS ?? 50_000);

// One supervisor and cache per function instance. globalThis keeps them single
// when Next.js evaluates this module more than once.
const g = globalThis as typeof globalThis & { turflpService?: { supervisor: Supervisor; cache: ResultCache;
                                                                version: string } };
const service = (g.turflpService ??= {
  supervisor: new Supervisor({
    script: join(process.cwd(), "workers", "solve.mjs"), queueCap: 4, deadlineMs: DEADLINE_MS, heapMb: 512,
  }),
  cache: new ResultCache(16 * 1024 * 1024, 10 * 60 * 1000),
  version: (() => {
    try {
      return JSON.parse(readFileSync(join(process.cwd(), "node_modules", "turflp", "package.json"), "utf8")).version;
    } catch {
      return "unknown";
    }
  })(),
});

const fail = (status: number, error: string, headers?: HeadersInit) =>
  Response.json({ error }, { status, headers });

// The body as text, or null when it passes MAX_BYTES. A missing or false
// content-length does not matter: the bytes are counted as they arrive.
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  const text = await readBody(request);
  if (text === null) return fail(413, `the request body is over ${MAX_BYTES} bytes`);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "the request body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "the request body must be a JSON object");
  }
  const { reach, size, tiebreak, names, fixed } = body;
  if (!Array.isArray(reach) || reach.length === 0 || !reach.every(Array.isArray)) {
    return fail(400, "reach must be an array of rows");
  }
  // The sum of the row lengths, so that one long row cannot pass the limit.
  const cells = reach.reduce((s: number, row: unknown[]) => s + row.length, 0);
  if (cells > MAX_CELLS || (typeof size === "number" && size > MAX_SIZE)) {
    return fail(413, "problem too large for a request; use a background job");
  }

  const key = cacheKey({ version: service.version, reach, size, fixed, tiebreak, names });
  const hit = service.cache.get(key);
  if (hit) return new Response(hit, { headers: { "content-type": "application/json" } });

  // Every other check (0 and 1 cells, size, fixed, tiebreak, names) is the
  // package's, in the worker; its message comes back with status 400.
  const outcome = await service.supervisor.run({ reach, size, options: { tiebreak, names, fixed } }, request.signal);
  if (!outcome.ok) {
    return fail(outcome.status, outcome.error, outcome.status === 503 ? { "retry-after": "1" } : undefined);
  }
  const value = outcome.value as { portfolio: { warnings: string[] }; ms: number };
  // Only complete results: a warning means a search stopped at a limit.
  if (value.portfolio.warnings.length === 0) service.cache.set(key, JSON.stringify({ ...value, cached: true }));
  return Response.json({ ...value, cached: false });
}
