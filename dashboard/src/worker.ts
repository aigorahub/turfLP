// The solver side of the dashboard. It runs in a worker, so a long solve does
// not block the page. If the browser cannot start the worker, the page loads
// this script and calls handle() itself.

import { loadSolver, turfMinCover, type Criterion, type Portfolio } from "../../js/src/index.js";
import { turfPrepared } from "../../js/src/core.js";
import { asReach } from "../../js/src/input.js";
import { prepare } from "../../js/src/prepare.js";
import { baselines, frontier, stageInfo, type Between, type Point, type StageInfo, type Stop } from "./analysis.js";

export interface Matrix {
  rows: number;
  cols: number;
  /** 0/1 reach values, row by row. */
  data: Uint8Array;
  names: string[];
}

export type Request =
  | { type: "load"; wasm: Uint8Array }
  | { type: "cover"; id: number; matrix: Matrix; fixed?: number[] }
  | { type: "run"; id: number; matrix: Matrix; sizes: number[]; tiebreak: Criterion[]; fixed?: number[] }
  // The deep dive into one portfolio of a run: the simple choices to compare
  // with, the stages, and the reach and frequency trade-off.
  | { type: "analyze"; id: number; matrix: Matrix; products: number[]; tiebreak: Criterion[];
      fixed?: number[]; seconds?: { baselines: number; stages: number; frontier: number }; maxPoints?: number;
      // True when the run found the portfolio with no warning, so it is optimal and the frontier can start from it.
      optimal?: boolean }
  // Stop an analysis at its next solve. Handled at once, not in turn.
  | { type: "cancel"; id: number };

export type Reply =
  | { type: "ready"; seconds: number }
  | { type: "cover"; id: number; portfolio: Portfolio }
  | { type: "start"; id: number; size: number }
  | { type: "size"; id: number; portfolio: Portfolio; seconds: number }
  | { type: "done"; id: number }
  | { type: "baselines"; id: number; mostPopular: Point | null; greedy: Point; stop: Stop }
  | { type: "stages"; id: number; stages: StageInfo[]; stop: Stop }
  | { type: "point"; id: number; point: Point }
  | { type: "frontier"; id: number; points: Point[]; maxFrequency: number; stop: Stop }
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
    respondents: p.respondents, fixed: [...p.fixed], warnings: [...p.warnings],
  };
}

/**
 * Answer one request. `between` runs before each size of a run and each solve
 * of an analysis; it yields so that the page can draw or a cancel can arrive,
 * and it returns false to stop.
 */
export async function handle(msg: Request, post: (reply: Reply) => void,
                             between?: () => Promise<boolean>): Promise<void> {
  const id = msg.type === "load" ? null : msg.id;
  try {
    if (msg.type === "cancel") return;
    if (msg.type === "analyze") {
      const options = { between: between as Between | undefined };
      const size = msg.products.length;
      const base = await baselines(msg.matrix, size, { ...options, seconds: msg.seconds?.baselines, fixed: msg.fixed });
      post({ type: "baselines", id: msg.id, ...base });
      if (base.stop === "cancelled") return;
      const st = await stageInfo(msg.matrix, msg.products, msg.tiebreak,
                                 { ...options, seconds: msg.seconds?.stages, fixed: msg.fixed });
      post({ type: "stages", id: msg.id, ...st });
      if (st.stop === "cancelled") return;
      const fr = await frontier(msg.matrix, size, {
        ...options, seconds: msg.seconds?.frontier, maxPoints: msg.maxPoints, fixed: msg.fixed,
        chosen: msg.optimal ? { products: msg.products, tiebreak: msg.tiebreak } : undefined,
        last: base.mostPopular ?? undefined,
        onPoint: (point) => post({ type: "point", id: msg.id, point }),
      });
      post({ type: "frontier", id: msg.id, ...fr });
      return;
    }
    if (msg.type === "load") {
      const t0 = performance.now();
      await loadSolver({ wasmBinary: msg.wasm });
      post({ type: "ready", seconds: (performance.now() - t0) / 1000 });
    } else if (msg.type === "cover") {
      const p = await turfMinCover(rowsOf(msg.matrix), { names: msg.matrix.names, fixed: msg.fixed });
      post({ type: "cover", id: msg.id, portfolio: plain(p) });
    } else {
      // Prepared once for every size of the run; each size still reports on its own.
      const prepared = prepare(asReach(rowsOf(msg.matrix), msg.matrix.names));
      for (const size of msg.sizes) {
        if (between && !(await between())) return;
        post({ type: "start", id: msg.id, size });
        const t0 = performance.now();
        const p = await turfPrepared(prepared, size, { tiebreak: msg.tiebreak, fixed: msg.fixed });
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
  const cancelled = new Set<number>();
  scope.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "cancel") { cancelled.add(msg.id); return; }
    // A macrotask between solves lets a cancel message in.
    const between = msg.type === "analyze"
      ? () => new Promise<boolean>((res) => setTimeout(() => res(!cancelled.has(msg.id)), 0))
      : undefined;
    queue = queue.then(() => handle(msg, (r) => scope.postMessage(r), between))
      .finally(() => { if (msg.type === "analyze") cancelled.delete(msg.id); });
  };
}
