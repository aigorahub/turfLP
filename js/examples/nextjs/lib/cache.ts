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

/**
 * Omitted, null, and empty fixed sets are one key; a list of whole numbers is
 * keyed sorted and without repeats, as the package reads it.
 */
export function cacheKey(k: CacheKeyInput): string {
  let fixed = k.fixed ?? [];
  if (Array.isArray(fixed) && fixed.every((j) => Number.isInteger(j))) {
    fixed = [...new Set(fixed as number[])].sort((a, b) => a - b);
  }
  const text = JSON.stringify([k.version, k.reach, k.size, fixed, k.tiebreak ?? null, k.names ?? null]);
  return createHash("sha256").update(text).digest("hex");
}

export class ResultCache {
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  // Map order is insertion order: a hit moves its entry to the end.
  private readonly entries = new Map<string, { body: string; at: number }>();
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
      this.bytes -= e.body.length;
      return undefined;
    }
    this.entries.set(key, e);
    return e.body;
  }

  set(key: string, body: string, now = Date.now()): void {
    if (body.length > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key);
      this.bytes -= old.body.length;
    }
    this.entries.set(key, { body, at: now });
    this.bytes += body.length;
    for (const [k, e] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(k);
      this.bytes -= e.body.length;
    }
  }

  get size(): number {
    return this.bytes;
  }
}
