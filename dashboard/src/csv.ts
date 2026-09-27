// Read a data file for the dashboard. The format (README.md, "Data format"):
//
// - One row per respondent and one column per product. The first row holds
//   the product names.
// - An optional first column of respondent IDs. It is found from its header
//   (empty, as R's write.csv() writes it, or a name such as "id" or
//   "respondent"), from values that are not data, or from distinct whole
//   numbers larger than any data value. The caller can also say.
// - Commas, semicolons, or tabs between values. Quoted fields. UTF-8, with or
//   without a byte order mark. With semicolons or tabs, a decimal comma is
//   accepted.
// - Cells are 0 and 1, TRUE and FALSE, yes and no, or numeric ratings. Ratings
//   need a reach threshold. Every cell needs a value.

export type Kind = "binary" | "ratings";

export interface Table {
  /** Product names, one per column. */
  names: string[];
  rows: number;
  cols: number;
  /** Values, row by row: 0 and 1 for binary data, the ratings otherwise. */
  values: Float64Array;
  kind: Kind;
  min: number;
  max: number;
  /** True when every value is a whole number. */
  integer: boolean;
  /** Header of the respondent ID column that was left out, or null. */
  idColumn: string | null;
  /** True when the ID column was found, not given by the caller. */
  idDetected: boolean;
}

export class DataError extends Error {
  override name = "DataError";
}

export const MAX_CELLS = 2_000_000;

const ID_NAMES = /^(id|#|row|respondent|resp|panelist|consumer|subject|participant|customer|judge|assessor)([ _.-]?(id|no|nr|number|code))?$/i;
const TRUE_WORDS = new Set(["true", "t", "yes", "y"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n"]);
const MISSING = new Set(["", "na", "n/a", "nan", "null", "."]);
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

type Cell = { kind: "number"; value: number } | { kind: "bool"; value: 0 | 1 } |
  { kind: "missing" } | { kind: "text" };

/** Split delimited text into records. Each record keeps its first line number. */
export function parseDelimited(text: string, delimiter: string): { fields: string[]; line: number }[] {
  const records: { fields: string[]; line: number }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      if (c === "\n") line++;
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === "") { quoted = true; field = ""; i++; continue; }
    if (c === delimiter) { fields.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      fields.push(field);
      records.push({ fields, line: start });
      fields = []; field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++; line++; start = line;
      continue;
    }
    field += c; i++;
  }
  if (quoted) throw new DataError(`Line ${start}: a quoted value has no closing quote.`);
  if (field !== "" || fields.length > 0) { fields.push(field); records.push({ fields, line: start }); }
  // Blank lines carry no respondent.
  return records.filter((r) => r.fields.some((f) => f.trim() !== ""));
}

/** The delimiter of the first line: tab, semicolon, or comma, whichever is most frequent. */
export function detectDelimiter(text: string): string {
  let quoted = false;
  const counts: Record<string, number> = { "\t": 0, ";": 0, ",": 0 };
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  let best = ",";
  for (const d of ["\t", ";", ","]) if (counts[d] > counts[best]) best = d;
  return best;
}

function readCell(raw: string, decimalComma: boolean): Cell {
  const s = raw.trim();
  const lower = s.toLowerCase();
  if (MISSING.has(lower)) return { kind: "missing" };
  if (TRUE_WORDS.has(lower)) return { kind: "bool", value: 1 };
  if (FALSE_WORDS.has(lower)) return { kind: "bool", value: 0 };
  const t = decimalComma && /^[+-]?\d+,\d+$/.test(s) ? s.replace(",", ".") : s;
  if (NUMBER.test(t)) return { kind: "number", value: Number(t) };
  return { kind: "text" };
}

function quote(name: string): string {
  return `"${name.length > 40 ? name.slice(0, 39) + "…" : name}"`;
}

/** Does the first column hold respondent IDs? */
function looksLikeId(header: string, column: Cell[], rest: number): boolean {
  if (header.trim() === "" || ID_NAMES.test(header.trim())) return true;
  if (column.some((c) => c.kind === "text")) return true;
  // Distinct whole numbers larger than every data value: a row number.
  if (column.length < 10 || column.some((c) => c.kind !== "number")) return false;
  const values = column.map((c) => (c as { value: number }).value);
  if (!values.every(Number.isInteger)) return false;
  return new Set(values).size === values.length && Math.max(...values) > rest;
}

/**
 * Read a data file. `idColumn` true or false overrides the detection of a
 * respondent ID column. Throws DataError with a message for the user.
 */
export function parseTable(text: string, options: { idColumn?: boolean } = {}): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.trim() === "") throw new DataError("The file is empty.");
  const delimiter = detectDelimiter(text);
  const records = parseDelimited(text, delimiter);
  const header = records[0].fields.map((f) => f.trim());
  const body = records.slice(1);
  if (body.length === 0) {
    throw new DataError("The file has a header row but no respondents. Add one row per respondent.");
  }
  for (const r of body) {
    if (r.fields.length !== header.length) {
      throw new DataError(
        `Line ${r.line} has ${r.fields.length} values, but the header row has ${header.length}. ` +
        `Every row needs one value for each column.`);
    }
  }
  if (body.length * header.length > MAX_CELLS) {
    throw new DataError(
      `The file has ${body.length.toLocaleString("en-US")} rows and ${header.length} columns. ` +
      `The dashboard reads up to ${MAX_CELLS.toLocaleString("en-US")} values.`);
  }

  const decimalComma = delimiter !== ",";
  const cells = body.map((r) => r.fields.map((f) => readCell(f, decimalComma)));

  let dataMax = -Infinity;
  for (const row of cells) {
    for (let j = 1; j < row.length; j++) {
      const c = row[j];
      if (c.kind === "number" && c.value > dataMax) dataMax = c.value;
      if (c.kind === "bool" && c.value > dataMax) dataMax = c.value;
    }
  }
  const idDetected = options.idColumn === undefined;
  const hasId = header.length > 1 &&
    (options.idColumn ?? looksLikeId(header[0], cells.map((row) => row[0]), dataMax));
  const first = hasId ? 1 : 0;
  const cols = header.length - first;
  if (cols === 0) throw new DataError("The file has no product columns.");

  const names = header.slice(first).map((h, j) => h === "" ? `P${j + 1}` : h);
  const seen = new Map<string, number>();
  for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
  for (const [name, count] of seen) {
    if (count > 1) {
      throw new DataError(
        `The product name ${quote(name)} appears ${count} times in the header row. ` +
        `The first row must hold one unique name for each product.`);
    }
  }

  const rows = body.length;
  const values = new Float64Array(rows * cols);
  let bools = false;
  let numbers = false;
  let binary = true;
  let integer = true;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const c = cells[i][j + first];
      if (c.kind === "missing") {
        throw new DataError(
          `Line ${body[i].line}, product ${quote(names[j])}: the value is missing. ` +
          `Every cell needs a value, for example 0 when the product does not reach the respondent.`);
      }
      if (c.kind === "text") {
        throw new DataError(
          `Line ${body[i].line}, product ${quote(names[j])}: ${quote(body[i].fields[j + first].trim())} ` +
          `is not a number, TRUE or FALSE, or yes or no.`);
      }
      if (c.kind === "bool") bools = true; else numbers = true;
      const v = c.value;
      if (v !== 0 && v !== 1) binary = false;
      if (!Number.isInteger(v)) integer = false;
      if (v < min) min = v;
      if (v > max) max = v;
      values[i * cols + j] = v;
    }
  }
  if (bools && numbers && !binary) {
    throw new DataError(
      "The file mixes TRUE and FALSE with ratings. Use TRUE and FALSE (or 0 and 1) for reach data, " +
      "or numbers for ratings.");
  }
  return {
    names, rows, cols, values, kind: binary ? "binary" : "ratings", min, max, integer,
    idColumn: hasId ? header[0] : null, idDetected,
  };
}

/** The default reach threshold for ratings: the top-2 box on a whole-number scale. */
export function defaultThreshold(t: Table): number {
  if (t.kind === "binary") return 1;
  if (t.integer) return Math.max(t.min, t.max - 1);
  return Math.round(((t.min + t.max) / 2) * 10) / 10;
}

/** The reach matrix: 1 where the value is at least the threshold (binary data: 1). */
export function toReach(t: Table, threshold: number): Uint8Array {
  const out = new Uint8Array(t.rows * t.cols);
  const cut = t.kind === "binary" ? 1 : threshold;
  for (let k = 0; k < out.length; k++) out[k] = t.values[k] >= cut ? 1 : 0;
  return out;
}

/** A small template file with a respondent ID column and 0/1 values. */
export function templateCsv(): string {
  const names = ["Product A", "Product B", "Product C", "Product D", "Product E"];
  const rows = [
    [1, 0, 0, 1, 0], [0, 1, 0, 0, 1], [1, 1, 0, 0, 0], [0, 0, 1, 0, 0],
    [0, 1, 0, 1, 0], [1, 0, 0, 0, 1], [0, 0, 1, 1, 0], [0, 0, 0, 0, 1],
  ];
  return ["respondent," + names.join(","), ...rows.map((r, i) => `${i + 1},${r.join(",")}`)]
    .join("\n") + "\n";
}
