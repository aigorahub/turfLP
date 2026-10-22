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
      out.push({ status: r.status, ms: performance.now() - t, solveMs: body.ms, instance: body.instance, age: body.ageMs });
    } catch (e) {
      out.push({ status: "timeout", ms: performance.now() - t });
    }
  }
}
await Promise.all(Array.from({ length: Number(conc) }, one));
const ok = out.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
const q = (p) => ok[Math.min(ok.length - 1, Math.floor(p * ok.length))];
const instances = new Set(out.map((r) => r.instance).filter(Boolean));
console.log(JSON.stringify({ route, conc: Number(conc), n: out.length, ok: ok.length,
  failed: out.length - ok.length, median: Math.round(q(0.5)), p95: Math.round(q(0.95)),
  instances: instances.size, fresh: out.filter((r) => r.age !== undefined && r.age < 15000).length }));
