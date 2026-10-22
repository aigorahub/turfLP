// HTTP checks against a deployed example: node check-next.mjs <url> <short-deadline-url>.
import { readFileSync } from "node:fs";
const [url, shortUrl] = process.argv.slice(2);
const input = JSON.parse(readFileSync(process.env.INPUT, "utf8"));
const reach = Array.from({ length: input.rows }, () => new Array(input.cols).fill(0));
input.columns.forEach((h, j) => {
  for (let d = 0; d < h.length; d++) for (let b = 0; b < 4; b++) {
    const i = d * 4 + b;
    if (i < input.rows && (parseInt(h[d], 16) >> (3 - b)) & 1) reach[i][j] = 1;
  }
});
const expected = JSON.parse(readFileSync(process.env.FIXTURE, "utf8"))
  .cases.find((c) => c.id === "gen-bench-200x20/k5/frequency+penetration").expected;
const headers = { "x-vercel-protection-bypass": process.env.BYPASS, "content-type": "application/json" };
const post = async (base, body) => {
  const t = performance.now();
  const r = await fetch(base + "/api/turf", { method: "POST", headers,
                                              body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null), ms: Math.round(performance.now() - t) };
};
const small = [[0, 1, 0, 0, 1], [0, 0, 1, 1, 1], [0, 0, 1, 1, 0], [0, 1, 0, 0, 1], [0, 0, 1, 0, 1], [1, 0, 0, 1, 0],
               [1, 1, 0, 0, 0], [0, 1, 1, 0, 1]];
let bad = 0;
const check = (label, cond, detail) => { if (!cond) bad++; console.log(`${cond ? "ok  " : "FAIL"} ${label}: ${detail}`); };
const tag = `${Date.now()}`;
for (const label of ["first", "second (cache)"]) {
  const r = await post(url, { reach, size: 5, names: input.names.map((n) => `${n}-${tag}`) });
  const p = r.body?.portfolio;
  check(label, r.status === 200 && p.reach === expected.reach && p.frequency === expected.frequency &&
        Math.abs(p.penetration - expected.penetration.value) <= 1e-12 * expected.penetration.value,
        `HTTP ${r.status}, ${r.ms} ms, solve ${Math.round(r.body?.ms)} ms, cached ${r.body?.cached}`);
}
const f = await post(url, { reach: small, size: 2, fixed: [0] });
check("fixed", f.status === 200 && f.body.portfolio.products.includes(0), JSON.stringify(f.body.portfolio.products));
for (const [label, body, status] of [["malformed JSON", "{x", 400], ["fixed out of range", { reach: small, size: 2, fixed: [9] }, 400],
                                     ["too many cells", { reach: [new Array(8001).fill(1)], size: 1 }, 413]]) {
  const r = await post(url, body);
  check(label, r.status === status, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
}
// The short deployment has a 2-second deadline; 200 x 20 size 5 takes longer on Vercel.
const late = await post(shortUrl, { reach, size: 5, names: input.names.map((n) => `${n}-late-${tag}`) });
check("past the deadline", late.status === 504 && late.ms < 6_000, `HTTP ${late.status}, ${late.ms} ms`);
const after = await post(shortUrl, { reach: small, size: 2 });
check("after the deadline", after.status === 200, `HTTP ${after.status}, ${after.ms} ms`);
console.log(bad ? `${bad} checks failed` : "all checks passed");
