// Example data sets, copied from the turfLP R package. The values are the
// raw responses. The R help pages suggest these reach thresholds:
// icecream >= 8, chips >= 4, ham >= 7, coffee >= 8; cafe, pies, and
// lunchbags are already 0/1. See COPYRIGHTS for sources and licenses.

import { DATA } from "./datasets-data.js";

export const datasetNames = ["cafe", "chips", "coffee", "ham", "icecream", "lunchbags", "pies"] as const;
export type DatasetName = (typeof datasetNames)[number];

export interface Dataset {
  readonly columns: string[];
  readonly values: number[][];
}

/** Load a data set as { columns, values } (one row per respondent). */
export function load(name: DatasetName): Dataset {
  const d = DATA[name];
  if (!d || !(datasetNames as readonly string[]).includes(name)) {
    throw new RangeError(`Unknown data set "${name}". Use one of: ${datasetNames.join(", ")}.`);
  }
  return {
    columns: [...d.columns],
    values: d.rows.map((row) => Array.from(row, (ch) => ch.charCodeAt(0) - 48)),
  };
}
