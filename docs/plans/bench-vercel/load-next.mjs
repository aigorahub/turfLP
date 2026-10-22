// Load driver for the Next.js example route: node load-next.mjs <url> <concurrency> <requests>.
// Body: conformance input gen-bench-200x20, size 5. Each request gets its own
// product names, so no request is answered from the result cache. The
// protection bypass token comes from the BYPASS environment variable.
import { readFileSync } from "node:fs";
const [url, conc, total] = process.argv.slice(2);
const input = JSON.parse(readFileSync(process.env.INPUT, "utf8"));
const reach = Array.from({ length: input.rows }, () => new Array(input.cols).fill(0));
input.columns.forEach((h, j) => {
  for (let d = 0; d < h.length; d++) for (let b = 0; b < 4; b++) {
    const i = d * 4 + b;
    if (i < input.rows && (parseInt(h[d], 16) >> (3 - b)) & 1) reach[i][j] = 1;
  }
});
const headers = { "x-vercel-protection-bypass": process.env.BYPASS, "content-type": "application/json" };
const out = [];
let next = 0;
async function one() {
  while (next < Number(total)) {
    const k = next++;
    const t = performance.now();
    try {
      const r = await fetch(url + "/api/turf", { method: "POST", headers, signal: AbortSignal.timeout(70_000),
        body: JSON.stringify({ reach, size: 5, names: input.names.map((n) => `${n}-${process.pid}-${k}`) }) });
      const body = await r.json().catch(() => ({}));
      out.push({ status: r.status, ms: performance.now() - t, solveMs: body.ms, reach: body.portfolio?.reach });
    } catch {
      out.push({ status: "timeout", ms: performance.now() - t });
    }
  }
}
await Promise.all(Array.from({ length: Number(conc) }, one));
const ok = out.filter((r) => r.status === 200);
const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
const solve = ok.map((r) => r.solveMs).sort((a, b) => a - b);
const q = (xs, p) => (xs.length ? Math.round(xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]) : null);
const statuses = {};
for (const r of out) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
console.log(JSON.stringify({ conc: Number(conc), n: out.length, statuses, median: q(ms, 0.5), p95: q(ms, 0.95),
  max: q(ms, 1), solveMedian: q(solve, 0.5), reach: [...new Set(ok.map((r) => r.reach))],
  deployment: process.env.DEPLOYMENT ?? null }));
