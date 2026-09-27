import { describe, expect, it } from "vitest";
import { formatG } from "../src/core.js";
import { fixtures, hasConformance } from "./helpers.js";

describe("formatG", () => {
  it("formats like C's %g", () => {
    expect([0, 0.5, 30, 1e-5, 123456, 1234567, 100000.5, 999999.5].map(formatG))
      .toEqual(["0", "0.5", "30", "1e-05", "123456", "1.23457e+06", "100000", "1e+06"]);
  });

  it.skipIf(!hasConformance)("matches the format fixtures", () => {
    for (const c of fixtures("format")) expect(formatG(c.value), String(c.value)).toBe(c.text);
  });
});
