// POST /api/turf with JSON { reach: number[][], size: number, tiebreak?: string[], names?: string[] }.
// Returns the portfolio (including `warnings`) and the solve time in milliseconds.
import { loadSolver, turf, type TurfOptions } from "turflp";

// The solver is WebAssembly; a Node.js function can load it, the Edge runtime cannot.
export const runtime = "nodejs";
// Above the 30-second penetration budget, so a warning is returned instead of a timeout.
export const maxDuration = 60;

// Start loading once per function instance; later requests reuse the solver.
const ready = loadSolver();

// Admission rule for solving inside a request (see the turflp README). Larger
// problems belong in a background job (for example an Inngest function).
const MAX_CELLS = 200 * 40;
const MAX_SIZE = 8;

export async function POST(request: Request) {
  const body = await request.json();
  const reach = body.reach as number[][];
  const size = body.size as number;
  if (!Array.isArray(reach) || reach.length === 0 || !Array.isArray(reach[0])) {
    return Response.json({ error: "reach must be an array of rows" }, { status: 400 });
  }
  if (reach.length * reach[0].length > MAX_CELLS || size > MAX_SIZE) {
    return Response.json({ error: "problem too large for a request; use a background job" },
                         { status: 413 });
  }
  await ready;
  const options: TurfOptions = { tiebreak: body.tiebreak, names: body.names };
  const start = performance.now();
  try {
    // The solve blocks this function instance until it finishes.
    const portfolio = await turf(reach, size, options);
    return Response.json({ portfolio, ms: performance.now() - start });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
