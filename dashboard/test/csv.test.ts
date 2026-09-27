import { describe, expect, it } from "vitest";
import { DataError, defaultThreshold, detectDelimiter, parseDelimited, parseTable, templateCsv,
         toReach } from "../src/csv.js";

const at = (t: ReturnType<typeof parseTable>, i: number, j: number) => t.values[i * t.cols + j];

describe("parseDelimited", () => {
  it("reads quoted fields, doubled quotes, and line breaks inside quotes", () => {
    const r = parseDelimited('a,"b ""x""","c\nd"\r\n1,2,3\n', ",");
    expect(r.map((x) => x.fields)).toEqual([["a", 'b "x"', "c\nd"], ["1", "2", "3"]]);
    expect(r.map((x) => x.line)).toEqual([1, 3]);
  });

  it("drops blank lines and keeps line numbers", () => {
    const r = parseDelimited("a,b\n\n1,0\n  \n0,1", ",");
    expect(r.map((x) => x.line)).toEqual([1, 3, 5]);
  });

  it("keeps records whose values are all missing", () => {
    for (const d of [",", ";", "\t"]) {
      expect(parseDelimited(`a${d}b\n1${d}0\n${d}\n`, d).map((x) => x.fields)).toEqual([["a", "b"], ["1", "0"], ["", ""]]);
    }
    expect(parseDelimited('a\n""\n', ",").map((x) => x.fields)).toEqual([["a"], [""]]);
  });

  it("rejects an open quote", () => {
    expect(() => parseDelimited('a,"b\n1,2', ",")).toThrow(DataError);
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent delimiter of the first line", () => {
    expect(detectDelimiter("a,b,c\n1;2;3;4;5")).toBe(",");
    expect(detectDelimiter("a;b;c\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"x,y";b;c')).toBe(";");
    expect(detectDelimiter("only")).toBe(",");
  });
});

describe("parseTable", () => {
  it("reads 0/1 data", () => {
    const t = parseTable("A,B,C\n1,0,1\n0,0,1\n");
    expect(t).toMatchObject({ names: ["A", "B", "C"], rows: 2, cols: 3, kind: "binary", idColumn: null });
    expect(Array.from(t.values)).toEqual([1, 0, 1, 0, 0, 1]);
  });

  it("reads TRUE/FALSE and yes/no as 0/1, with a byte order mark and CRLF", () => {
    const t = parseTable("﻿A,B\r\nTRUE,false\r\nyes,No\r\n");
    expect(t.kind).toBe("binary");
    expect(Array.from(t.values)).toEqual([1, 0, 1, 0]);
  });

  it("reads ratings and sets the top-2 box as the default threshold", () => {
    const t = parseTable("A,B\n9,3\n7,8\n1,5\n");
    expect(t).toMatchObject({ kind: "ratings", min: 1, max: 9, integer: true });
    expect(defaultThreshold(t)).toBe(8);
    expect(Array.from(toReach(t, 7))).toEqual([1, 0, 1, 1, 0, 0]);
  });

  it("uses the midpoint for ratings that are not whole numbers", () => {
    const t = parseTable("A;B\n2,5;3\n4;1\n");
    expect(at(t, 0, 0)).toBe(2.5);
    expect(t.integer).toBe(false);
    expect(defaultThreshold(t)).toBe(2.5);
  });

  it("finds an ID column from an empty header, as write.csv() writes it", () => {
    const t = parseTable('"","A","B"\n"1",1,0\n"2",0,1\n');
    expect(t.idColumn).toBe("");
    expect(t.names).toEqual(["A", "B"]);
    expect(Array.from(t.values)).toEqual([1, 0, 0, 1]);
  });

  it("finds an ID column from its name or from text values", () => {
    expect(parseTable("Respondent ID,A,B\n1,1,0\n2,0,1\n").idColumn).toBe("Respondent ID");
    expect(parseTable("who,A,B\nann,1,0\nbob,0,1\n").idColumn).toBe("who");
  });

  it("finds an ID column of distinct row numbers larger than the data", () => {
    const rows = Array.from({ length: 12 }, (_, i) => `${101 + i},${(i % 9) + 1},${(i % 5) + 1}`);
    const t = parseTable(["num,A,B", ...rows].join("\n"));
    expect(t.idColumn).toBe("num");
    expect(t.cols).toBe(2);
  });

  it("does not take a product column for an ID column", () => {
    const t = parseTable("A,B\n1,0\n0,1\n1,1\n");
    expect(t.idColumn).toBeNull();
    expect(t.cols).toBe(2);
  });

  it("lets the caller choose the ID column", () => {
    expect(parseTable("A,B,C\n1,0,1\n2,1,0\n", { idColumn: true }).names).toEqual(["B", "C"]);
    expect(parseTable("id,A\n1,0\n0,1\n", { idColumn: false }).names).toEqual(["id", "A"]);
  });

  it("names products with an empty header cell", () => {
    expect(parseTable("A,,C\n1,0,1\n", { idColumn: false }).names).toEqual(["A", "P2", "C"]);
  });

  it("explains each problem with the line and product", () => {
    const err = (text: string) => {
      try { parseTable(text); } catch (e) { expect(e).toBeInstanceOf(DataError); return (e as Error).message; }
      throw new Error("no error");
    };
    expect(err("")).toMatch(/empty/);
    expect(err("A,B\n")).toMatch(/no respondents/);
    expect(err("A,B\n1,0\n1\n")).toMatch(/Line 3 has 1 values, but the header row has 2/);
    expect(err("A,B\n1,\n")).toMatch(/Line 2, product "B": the value is missing/);
    expect(err("A,B\n1,NA\n")).toMatch(/missing/);
    expect(err("A,B\n1,0\n0,x\n")).toMatch(/Line 3, product "B": "x" is not a number/);
    expect(err("A,A\n1,0\n")).toMatch(/"A" appears 2 times/);
    expect(err("A,B\nTRUE,5\n")).toMatch(/mixes TRUE and FALSE with ratings/);
    expect(err("A,B\n1,0\n,\n0,1\n")).toMatch(/Line 3, product "A": the value is missing/);
    expect(err("A;B\n1;0\n;\n")).toMatch(/Line 3, product "A": the value is missing/);
    expect(err("A\tB\n1\t0\n\t\n")).toMatch(/Line 3, product "A": the value is missing/);
    expect(err('A,B\n1,0\n"",""\n')).toMatch(/Line 3, product "A": the value is missing/);
    expect(err("A,B\n1e999,0\n0,1\n")).toMatch(/Line 2, product "A": "1e999" is too large a number/);
    expect(err("A,B\n-1e999,0\n0,1\n")).toMatch(/too large a number/);
    expect(err("A,B\n1,0\noops,1\n")).toMatch(/Line 3, product "A": "oops" is not a number.*name it "id"/);
  });

  it("reads a long ID column without spreading it into arguments", () => {
    const rows = Array.from({ length: 150_000 }, (_, i) => `${i + 1},${i % 2},${(i + 1) % 2}`);
    const t = parseTable(["seq,A,B", ...rows].join("\n"));
    expect(t).toMatchObject({ idColumn: "seq", rows: 150_000, cols: 2 });
  });

  it("reports a file with no records as empty", () => {
    expect(() => parseTable('""')).toThrow(/no respondents|empty/);
  });

  it("reads the template", () => {
    const t = parseTable(templateCsv());
    expect(t).toMatchObject({ rows: 8, cols: 5, kind: "binary", idColumn: "respondent" });
  });
});
