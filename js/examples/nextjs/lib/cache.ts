// Complete results by request content, bounded by total bytes and age. The
// example has no callers to tell apart; a service with tenants must add the
// tenant to the key and check access before the lookup.

import { createHash } from "node:crypto";

export interface CacheKeyInput {
  version: string;
  reach: unknown;
  size: unknown;
  fixed: unknown;
  tiebreak: unknown;
  names: unknown;
}

// A text for each value that no other value shares. JSON.stringify is not one:
// it writes Infinity (JSON 1e309 parses to it) as null, and the package reads
// the two differently. Every part carries its type, and strings are quoted.
function canon(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  switch (typeof v) {
    case "number": return `n${String(v)}`;
    case "string": return `s${JSON.stringify(v)}`;
    case "boolean": return `b${v}`;
    case "undefined": return "u";
    case "object":
      return `{${Object.entries(v as object).map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`).join(",")}}`;
    default: return `?${String(v)}`;
  }
}

// The package reads an omitted tiebreak as frequency then penetration and null
// as reach only, so an omitted value has its own text.
const given = (v: unknown) => (v === undefined ? "omitted" : canon(v));

/**
 * Omitted, null, and empty fixed sets are one key; a list of whole numbers is
 * keyed sorted and without repeats, as the package reads it.
 */
export function cacheKey(k: CacheKeyInput): string {
  let fixed = k.fixed ?? [];
  if (Array.isArray(fixed) && fixed.every((j) => Number.isInteger(j))) {
    fixed = [...new Set(fixed as number[])].sort((a, b) => a - b);
  }
  const text = [k.version, k.reach, k.size, fixed].map(canon).concat(given(k.tiebreak), given(k.names)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

export class ResultCache {
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  // Map order is insertion order: a hit moves its entry to the end.
  private readonly entries = new Map<string, { body: string; bytes: number; at: number }>();
  private bytes = 0;

  constructor(maxBytes: number, ttlMs: number) {
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
  }

  get(key: string, now = Date.now()): string | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    if (now - e.at > this.ttlMs) {
      this.bytes -= e.bytes;
      return undefined;
    }
    this.entries.set(key, e);
    return e.body;
  }

  set(key: string, body: string, now = Date.now()): void {
    // UTF-8 bytes, not UTF-16 code units: product names can be any text.
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key);
      this.bytes -= old.bytes;
    }
    this.entries.set(key, { body, bytes, at: now });
    this.bytes += bytes;
    for (const [k, e] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(k);
      this.bytes -= e.bytes;
    }
  }

  get size(): number {
    return this.bytes;
  }
}
