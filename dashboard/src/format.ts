// Number formats for the page.

export function percent(prop: number): string {
  return `${(100 * prop).toFixed(1)}%`;
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

export function seconds(s: number): string {
  if (s < 0.1) return "<0.1 s";
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 120) return `${Math.round(s)} s`;
  const t = Math.round(s);
  return `${Math.floor(t / 60)} min ${t % 60} s`;
}

/** One decimal, with thousands separators. */
export function decimal(x: number): string {
  return x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Percentage points, with a sign. */
export function points(delta: number): string {
  const v = (100 * delta).toFixed(1);
  return `${delta >= 0 ? "+" : ""}${v} points`;
}

/** "a, b, and c" */
export function list(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
