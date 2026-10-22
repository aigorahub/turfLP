// Load driver: node load.mjs <url> <route> <concurrency> <requests>. The
// protection bypass token comes from the BYPASS environment variable.
const [url, route, conc, total] = process.argv.slice(2);
const headers = { "x-vercel-protection-bypass": process.env.BYPASS };
const out = [];
let next = 0;
async function one() {
  while (next < Number(total)) {
    next++;
    const t = performance.now();
    try {
      const r = await fetch(url + route, { headers, signal: AbortSignal.timeout(70_000) });
      const body = await r.json().catch(() => ({}));
      out.push({ status: r.status, ms: performance.now() - t, solveMs: body.ms, instance: body.instance,
                 first: body.served === 0, region: body.region });
    } catch (e) {
      out.push({ status: "timeout", ms: performance.now() - t });
    }
  }
}
await Promise.all(Array.from({ length: Number(conc) }, one));
// Warm requests and first requests of an instance are reported apart.
const pick = (rows) => rows.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
const q = (xs, p) => (xs.length ? Math.round(xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]) : null);
const warm = pick(out.filter((r) => !r.first));
const firsts = pick(out.filter((r) => r.first));
const instances = new Set(out.map((r) => r.instance).filter(Boolean));
console.log(JSON.stringify({ route, conc: Number(conc), n: out.length,
  failed: out.filter((r) => r.status !== 200).length, warm: warm.length, median: q(warm, 0.5), p95: q(warm, 0.95),
  first: firsts.length, firstMedian: q(firsts, 0.5), instances: instances.size,
  regions: [...new Set(out.map((r) => r.region).filter(Boolean))], deployment: process.env.DEPLOYMENT ?? null }));
