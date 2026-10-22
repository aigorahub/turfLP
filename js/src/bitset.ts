// Respondent sets packed 32 per Uint32 word: bit (i & 31) of word (i >>> 5)
// is respondent i. Bits past the last respondent are always 0, so counts and
// complements never invent respondents.

export function words(n: number): number {
  return (n + 31) >>> 5;
}

/** Number of set bits of one 32-bit word. */
export function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

export function count(a: Uint32Array): number {
  let c = 0;
  for (let w = 0; w < a.length; w++) c += popcount32(a[w]);
  return c;
}

/** a |= b. */
export function orInto(a: Uint32Array, b: Uint32Array): void {
  for (let w = 0; w < a.length; w++) a[w] |= b[w];
}

/** a &= ~b. */
export function andNotInto(a: Uint32Array, b: Uint32Array): void {
  for (let w = 0; w < a.length; w++) a[w] &= ~b[w];
}

/** |a & ~b|: the members of a that b lacks. */
export function countAndNot(a: Uint32Array, b: Uint32Array): number {
  let c = 0;
  for (let w = 0; w < a.length; w++) c += popcount32(a[w] & ~b[w]);
  return c;
}

export function equal(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let w = 0; w < a.length; w++) if (a[w] !== b[w]) return false;
  return true;
}

/** The complement of a within the first n respondents. */
export function complement(a: Uint32Array, n: number): Uint32Array {
  const out = new Uint32Array(a.length);
  for (let w = 0; w < a.length; w++) out[w] = ~a[w];
  const tail = n & 31;
  if (tail && out.length) out[out.length - 1] &= (1 << tail) - 1;
  return out;
}

/** Calls f with each member of a, in ascending order. */
export function forEach(a: Uint32Array, f: (i: number) => void): void {
  for (let w = 0; w < a.length; w++) {
    let x = a[w];
    while (x !== 0) {
      const low = x & -x;
      f((w << 5) + (31 - Math.clz32(low)));
      x ^= low;
    }
  }
}
