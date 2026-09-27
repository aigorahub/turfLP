// Example data sets, summaries of a reach matrix, and the results file.

import { load, type DatasetName } from "../../js/src/datasets.js";
import type { Portfolio } from "../../js/src/index.js";
import type { Table } from "./csv.js";

export interface Example {
  id: DatasetName;
  title: string;
  description: string;
  /** Reach threshold from the R help pages; null for data that is already 0/1. */
  threshold: number | null;
  source: { text: string; url: string } | null;
}

// Smallest first. Descriptions and thresholds follow R/data.R.
export const EXAMPLES: Example[] = [
  {
    id: "icecream", title: "Ice cream", threshold: 8,
    description: "Simulated liking of 10 flavors by 120 consumers on a 9-point scale.",
    source: null,
  },
  {
    id: "ham", title: "Cured ham", threshold: 7,
    description: "Blind liking of 8 cured hams by 127 Norwegian consumers on a 9-point scale.",
    source: { text: "Berget (2024), Zenodo, CC BY 4.0", url: "https://doi.org/10.5281/zenodo.10996096" },
  },
  {
    id: "coffee", title: "Black coffee", threshold: 8,
    description: "Liking of 27 black coffee brew recipes by 118 consumers on a 9-point scale.",
    source: { text: "Ristenpart, Cotter, and Guinard (2023), Dryad, CC0 1.0", url: "https://doi.org/10.25338/B8993H" },
  },
  {
    id: "chips", title: "Potato chips", threshold: 4,
    description: "Simulated purchase intent for 24 chip flavors from 600 consumers on a 5-point scale.",
    source: null,
  },
  {
    id: "pies", title: "Thanksgiving pies", threshold: null,
    description: "Which of 10 pies 980 US households serve at Thanksgiving dinner.",
    source: { text: "FiveThirtyEight (2015), CC BY 4.0", url: "https://github.com/fivethirtyeight/data/tree/master/thanksgiving-2015" },
  },
  {
    id: "lunchbags", title: "Lunch bags", threshold: null,
    description: "Which of 14 lunch bag designs 1,175 customers of a UK online retailer bought.",
    source: { text: "Chen (2015), UCI Machine Learning Repository, CC BY 4.0", url: "https://doi.org/10.24432/C5BW33" },
  },
  {
    id: "cafe", title: "Cafe drinks", threshold: null,
    description: "Simulated: which of 40 drinks 2,500 customers would order. Sizes of 3 or more take several seconds each.",
    source: null,
  },
];

/** An example data set as a Table. */
export function exampleTable(id: DatasetName): Table {
  const d = load(id);
  const rows = d.values.length;
  const cols = d.columns.length;
  const values = new Float64Array(rows * cols);
  let min = Infinity;
  let max = -Infinity;
  d.values.forEach((row, i) => row.forEach((v, j) => {
    values[i * cols + j] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }));
  const binary = min >= 0 && max <= 1;
  return {
    names: d.columns, rows, cols, values, kind: binary ? "binary" : "ratings", min, max,
    integer: true, idColumn: null, idDetected: false,
  };
}

export interface ReachSummary {
  /** Respondents that each product reaches. */
  productReach: number[];
  /** Respondents that at least one product reaches. */
  reachable: number;
}

export function summarize(reach: Uint8Array, rows: number, cols: number): ReachSummary {
  const productReach = new Array<number>(cols).fill(0);
  let reachable = 0;
  for (let i = 0; i < rows; i++) {
    let any = 0;
    for (let j = 0; j < cols; j++) {
      const v = reach[i * cols + j];
      productReach[j] += v;
      any |= v;
    }
    reachable += any;
  }
  return { productReach, reachable };
}

export interface SizeResult {
  portfolio: Portfolio;
  /** Seconds for this size. */
  seconds: number;
}

function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The results as CSV, one row per size. */
export function resultsCsv(results: SizeResult[]): string {
  const head = "size,reach,reach_percent,frequency,penetration,products,seconds";
  const lines = results.map(({ portfolio: p, seconds }) => [
    p.size, p.reach, (100 * p.reachProp).toFixed(2), p.frequency, p.penetration.toFixed(4),
    csvField(p.names.join("; ")), seconds.toFixed(3),
  ].join(","));
  return [head, ...lines].join("\n") + "\n";
}
