import { Worker } from "node:worker_threads";
import { join } from "node:path";
export const instance = globalThis.crypto.randomUUID().slice(0, 8);
export const started = Date.now();
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
