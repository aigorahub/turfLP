// Bit boundaries of the packed respondent sets: a respondent count at, below,
// and above each word edge, the last valid bit, and padding bits that a
// complement must not turn into respondents.
import { describe, expect, it } from "vitest";
import * as bits from "../src/bitset.js";
import { asReach } from "../src/input.js";
import { prepare } from "../src/prepare.js";

const set = (n: number, members: number[]) => {
  const a = new Uint32Array(bits.words(n));
  for (const i of members) a[i >>> 5] |= 1 << (i & 31);
  return a;
};
const list = (a: Uint32Array) => {
  const out: number[] = [];
  bits.forEach(a, (i) => out.push(i));
  return out;
};

describe("bitset", () => {
  for (const n of [31, 32, 33, 63, 64, 65]) {
    it(`keeps ${n} respondents exact at the word edge`, () => {
      const last = set(n, [n - 1]);
      expect(list(last)).toEqual([n - 1]);
      expect(bits.count(last)).toBe(1);
      const none = set(n, []);
      expect(bits.count(none)).toBe(0);
      // The complement of the empty set is every respondent and no padding bit.
      const full = bits.complement(none, n);
      expect(bits.count(full)).toBe(n);
      expect(list(full)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(bits.count(bits.complement(full, n))).toBe(0);
      const a = set(n, [0, n - 1]);
      const b = set(n, [n - 1]);
      expect(bits.countAndNot(a, b)).toBe(1);
      const u = set(n, [0]);
      bits.orInto(u, b);
      expect(bits.equal(u, a)).toBe(true);
      bits.andNotInto(u, b);
      expect(list(u)).toEqual([0]);
    });
  }

  it("counts the sign bit of a word as a respondent", () => {
    const a = set(64, [31, 63]);
    expect(bits.count(a)).toBe(2);
    expect(list(a)).toEqual([31, 63]);
  });

  it("prepares the same column reach, candidates, and twins as the 0/1 data", () => {
    // 33 respondents: column 2 reaches only the last one; column 3 equals column 0;
    // column 4 reaches no one.
    const rows = Array.from({ length: 33 }, (_, i) => [i % 2, i % 3 === 0 ? 1 : 0, i === 32 ? 1 : 0, i % 2, 0]);
    const p = prepare(asReach(rows));
    expect(Array.from(p.colReach)).toEqual([16, 11, 1, 16, 0]);
    expect(p.cand).toEqual([0, 1, 2, 3]);
    expect(Array.from(p.twinOf)).toEqual([-1, -1, -1, 0]);
    expect(p.reachableCount).toBe(rows.filter((r) => r.some((v) => v === 1)).length);
  });
});
