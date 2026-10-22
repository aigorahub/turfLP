// One solver worker per function instance, one solve at a time, a short
// first-in first-out queue, and a deadline per job that terminates the worker.
// On Vercel, two solves in one instance share its CPU, so a second active
// solve only makes both slower. A timer cannot interrupt a solve on the request
// thread; terminating the worker can.
//
// Only node: imports here, so scripts/supervisor-test.mjs runs this file in
// plain Node.js.

import { Worker } from "node:worker_threads";

export type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 499 | 500 | 503 | 504; error: string };

export interface SupervisorOptions {
  /** Path of the worker script. */
  script: string;
  /** Jobs that may wait behind the active one. */
  queueCap: number;
  /** Time from admission to result, queue time included. */
  deadlineMs: number;
  /** Heap limit of the worker in MB. */
  heapMb?: number;
}

interface Job {
  id: number;
  msg: Record<string, unknown>;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (o: Outcome) => void;
}

export class Supervisor {
  private readonly opts: SupervisorOptions;
  private worker: Worker | null = null;
  private active: Job | null = null;
  private readonly queue: Job[] = [];
  private nextId = 1;

  constructor(opts: SupervisorOptions) {
    this.opts = opts;
  }

  /** Jobs running or waiting. */
  get load(): number {
    return this.queue.length + (this.active ? 1 : 0);
  }

  /**
   * Runs one job. A queued job whose signal aborts leaves the queue; an active
   * job runs to its end, because only a worker restart could stop it and the
   * result may still serve a later request.
   */
  run(msg: Record<string, unknown>, signal?: AbortSignal): Promise<Outcome> {
    if (this.active && this.queue.length >= this.opts.queueCap) {
      return Promise.resolve({ ok: false, status: 503, error: "the solver is busy; try again" });
    }
    return new Promise<Outcome>((resolve) => {
      const job: Job = { id: this.nextId++, msg, settled: false, timer: null, resolve };
      job.timer = setTimeout(() => this.expire(job), this.opts.deadlineMs);
      signal?.addEventListener("abort", () => {
        const at = this.queue.indexOf(job);
        if (at >= 0) {
          this.queue.splice(at, 1);
          this.settle(job, { ok: false, status: 499, error: "request aborted" });
        }
      }, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private settle(job: Job, outcome: Outcome): void {
    if (job.settled) return;
    job.settled = true;
    if (job.timer) clearTimeout(job.timer);
    job.resolve(outcome);
  }

  private expire(job: Job): void {
    const timeout: Outcome = { ok: false, status: 504, error: "the solve passed the service deadline" };
    if (this.active === job) {
      this.active = null;
      this.stopWorker();
      this.settle(job, timeout);
      this.pump();
      return;
    }
    const at = this.queue.indexOf(job);
    if (at >= 0) this.queue.splice(at, 1);
    this.settle(job, timeout);
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.active = job;
    this.ensureWorker().postMessage({ ...job.msg, id: job.id });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.opts.script, {
      resourceLimits: this.opts.heapMb ? { maxOldGenerationSizeMb: this.opts.heapMb } : undefined,
    });
    let lastError = "";
    w.on("message", (m: { id: number; ok: boolean; value?: unknown; kind?: string; message?: string }) => {
      const job = this.active;
      if (!job || m.id !== job.id || this.worker !== w) return;
      this.active = null;
      if (m.ok) this.settle(job, { ok: true, value: m.value });
      else if (m.kind === "input") this.settle(job, { ok: false, status: 400, error: m.message ?? "invalid input" });
      else this.settle(job, { ok: false, status: 500, error: "the solver failed" });
      this.pump();
    });
    // An uncaught error or a heap limit ends the worker; "exit" follows.
    w.on("error", (e) => { lastError = String(e); });
    w.on("exit", () => {
      if (this.worker !== w) return;
      this.worker = null;
      const job = this.active;
      this.active = null;
      if (job) {
        if (lastError) console.error(`turflp worker failed: ${lastError}`);
        this.settle(job, { ok: false, status: 500, error: "the solver failed" });
      }
      this.pump();
    });
    this.worker = w;
    return w;
  }

  private stopWorker(): void {
    const w = this.worker;
    this.worker = null;
    // The exit handler ignores a worker that is no longer current.
    void w?.terminate();
  }
}
