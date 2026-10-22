// B2-A4 of docs/plans/bip-speed.md: the JS 32-bit kernel against a small
// WASM kernel with 64-bit OR and popcount, for |a OR b| over respondent sets.
// The WASM module is assembled here byte by byte (no toolchain needed). The
// sets stay resident in WASM memory for a batch; the copy into that memory is
// timed apart, as the plan asks.
//
//   npm run build && node scripts/bitset-kernel-bench.mjs

import { count, orInto, words } from "../dist/bitset.js";

const leb = (n) => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
const str = (s) => [...leb(s.length), ...Buffer.from(s)];
// orcount(a, b, n64) -> i32: the popcount of a | b over n64 words of 64 bits.
const body = [
  0x02, 0x01, 0x7f, 0x01, 0x7e,                   // locals: i (i32), acc (i64)
  0x02, 0x40, 0x03, 0x40,                          // block, loop
  0x20, 0x03, 0x20, 0x02, 0x4f, 0x0d, 0x01,        // if i >= n64: break
  0x20, 0x04,                                      // acc
  0x20, 0x00, 0x20, 0x03, 0x41, 0x03, 0x74, 0x6a, 0x29, 0x03, 0x00,  // load a[i]
  0x20, 0x01, 0x20, 0x03, 0x41, 0x03, 0x74, 0x6a, 0x29, 0x03, 0x00,  // load b[i]
  0x84, 0x7b, 0x7c, 0x21, 0x04,                    // acc += popcnt(a | b)
  0x20, 0x03, 0x41, 0x01, 0x6a, 0x21, 0x03,        // i += 1
  0x0c, 0x00, 0x0b, 0x0b,                          // continue; end loop, block
  0x20, 0x04, 0xa7, 0x0b,                          // return (i32) acc
];
const bytes = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, [0x01, 0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x01, 0x7f]),
  ...section(2, [0x01, ...str("env"), ...str("mem"), 0x02, 0x00, 0x01]),
  ...section(3, [0x01, 0x00]),
  ...section(7, [0x01, ...str("orcount"), 0x00, 0x00]),
  ...section(10, [0x01, ...leb(body.length), ...body]),
]);

function rng(seed) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const time = (f, reps) => { const t = performance.now(); for (let i = 0; i < reps; i++) f(); return (performance.now() - t) / reps; };

console.log("respondents  pairs  js_ms  wasm_ms  copy_ms  agree");
for (const n of [2_500, 42_000, 1_000_000]) {
  const cols = 40;
  const next = rng(n);
  const nw = words(n);
  const sets = Array.from({ length: cols }, () => {
    const s = new Uint32Array(nw + (nw & 1));
    for (let i = 0; i < n; i++) if (next() < 0.3) s[i >>> 5] |= 1 << (i & 31);
    return s;
  });
  const pairs = (cols * (cols - 1)) / 2;
  // JS: |a | b| for every pair of columns.
  const tmp = new Uint32Array(sets[0].length);
  let jsSum = 0;
  const js = () => {
    jsSum = 0;
    for (let a = 0; a < cols; a++) for (let b = a + 1; b < cols; b++) { tmp.set(sets[a]); orInto(tmp, sets[b]); jsSum += count(tmp); }
  };
  // WASM: copy the sets in once, then one call per pair.
  const memory = new WebAssembly.Memory({ initial: Math.ceil((cols * sets[0].byteLength) / 65536) + 1 });
  const { instance } = await WebAssembly.instantiate(bytes, { env: { mem: memory } });
  const n64 = sets[0].length / 2;
  const copy = () => { const view = new Uint32Array(memory.buffer); sets.forEach((s, j) => view.set(s, j * s.length)); };
  let wasmSum = 0;
  const wasm = () => {
    wasmSum = 0;
    for (let a = 0; a < cols; a++) for (let b = a + 1; b < cols; b++) wasmSum += instance.exports.orcount(a * n64 * 8, b * n64 * 8, n64);
  };
  copy(); js(); wasm();
  const reps = n > 100_000 ? 3 : 20;
  const jsMs = time(js, reps), copyMs = time(copy, reps), wasmMs = time(wasm, reps);
  console.log([n, pairs, jsMs.toFixed(3), wasmMs.toFixed(3), copyMs.toFixed(3), jsSum === wasmSum].join("  "));
}
