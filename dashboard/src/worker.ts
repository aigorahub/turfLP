// The solver side of the dashboard. It runs in a worker, so a long solve does
// not block the page. If the browser cannot start the worker, the page loads
// this script and calls handle() itself.

import { loadSolver, turf, turfMinCover, type Criterion, type Portfolio } from "../../js/src/index.js";

export interface Matrix {
  rows: number;
  cols: number;
  /** 0/1 reach values, row by row. */
  data: Uint8Array;
  names: string[];
}

export type Request =
  | { type: "load"; wasm: Uint8Array }
  | { type: "cover"; id: number; matrix: Matrix }
  | { type: "run"; id: number; matrix: Matrix; sizes: number[]; tiebreak: Criterion[] };

export type Reply =
  | { type: "ready"; seconds: number }
  | { type: "cover"; id: number; portfolio: Portfolio }
  | { type: "start"; id: number; size: number }
  | { type: "size"; id: number; portfolio: Portfolio; seconds: number }
  | { type: "done"; id: number }
  | { type: "error"; id: number | null; message: string };

function rowsOf(m: Matrix): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < m.rows; i++) out.push(Array.from(m.data.subarray(i * m.cols, (i + 1) * m.cols)));
  return out;
}

// A structured-clone-safe copy of a portfolio.
function plain(p: Portfolio): Portfolio {
  return {
    products: [...p.products], names: [...p.names], size: p.size, reach: p.reach,
    reachProp: p.reachProp, frequency: p.frequency, penetration: p.penetration,
    respondents: p.respondents, warnings: [...p.warnings],
  };
}

/**
 * Answer one request. `between` runs before each size; on the page it yields
 * so the page can draw, and it returns false to stop.
 */
export async function handle(msg: Request, post: (reply: Reply) => void,
                             between?: () => Promise<boolean>): Promise<void> {
  const id = msg.type === "load" ? null : msg.id;
  try {
    if (msg.type === "load") {
      const t0 = performance.now();
      await loadSolver({ wasmBinary: msg.wasm });
      post({ type: "ready", seconds: (performance.now() - t0) / 1000 });
    } else if (msg.type === "cover") {
      const p = await turfMinCover(rowsOf(msg.matrix), { names: msg.matrix.names });
      post({ type: "cover", id: msg.id, portfolio: plain(p) });
    } else {
      const reach = rowsOf(msg.matrix);
      for (const size of msg.sizes) {
        if (between && !(await between())) return;
        post({ type: "start", id: msg.id, size });
        const t0 = performance.now();
        const p = await turf(reach, size, { tiebreak: msg.tiebreak, names: msg.matrix.names });
        post({ type: "size", id: msg.id, portfolio: plain(p), seconds: (performance.now() - t0) / 1000 });
      }
      post({ type: "done", id: msg.id });
    }
  } catch (e) {
    post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
}

// In a worker, answer requests in order.
declare const WorkerGlobalScope: unknown;
if (typeof WorkerGlobalScope !== "undefined") {
  const scope = globalThis as unknown as {
    onmessage: ((e: { data: Request }) => void) | null;
    postMessage: (reply: Reply) => void;
  };
  let queue = Promise.resolve();
  scope.onmessage = (e) => {
    queue = queue.then(() => handle(e.data, (r) => scope.postMessage(r)));
  };
}
