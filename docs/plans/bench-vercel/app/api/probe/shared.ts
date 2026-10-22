import { Worker } from "node:worker_threads";
import { join } from "node:path";
export const instance = globalThis.crypto.randomUUID().slice(0, 8);
export const started = Date.now();
// Requests this instance served before the current one: 0 marks its first request.
let served = 0;
export const nextServed = () => served++;
export const region = process.env.VERCEL_REGION ?? "local";
export function startWorker(): Promise<{ worker: Worker; loadMs: number }> {
  const worker = new Worker(join(process.cwd(), "workers", "solve.mjs"));
  return new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", (m) => resolve({ worker, loadMs: m.loadMs }));
  });
}
export function ask(worker: Worker, msg: object): Promise<any> {
  return new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", resolve);
    worker.postMessage(msg);
  });
}
export const mem = () => Math.round(process.memoryUsage().rss / 2 ** 20);
